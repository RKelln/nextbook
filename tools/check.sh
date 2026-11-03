#!/bin/bash
# Ported from searchdesk/checks/check.sh (MIT, same author).
# Check one mode on a Mac with no Node:    bash tools/check.sh <id>
# Every mode the app lists:                bash tools/check.sh --all
# Every mode in a folder (name order):     bash tools/check.sh --all --dir reference/modes
# A folder of modes, one mode:             bash tools/check.sh --dir reference/modes <id>
# It runs tools/check-mode.js through osascript (JavaScript for Automation), so it has the same checks,
# the same lines and the same exit codes as `node tools/check-mode.js`: 0 ok, 1 a check failed, 2 STOP.
# Written for bash 3.2 and BSD tools: no associative arrays, no ${var,,}, no sed -i '', no grep -P, no
# timeout. A hash, if one is ever needed here, is `shasum -a 256`.

stop() {
  echo "STOP: $1"
  exit 2
}

id=""
dir=""
all=""
want_dir=""
dir_given=""

for arg in "$@"; do
  if [ -n "$want_dir" ]; then
    # The folder cannot be another option. Say which folder was looked for, never eat --all.
    case "$arg" in
      -*) stop "I cannot find the folder $arg. It has to be a folder in this repo." ;;
    esac
    dir="$arg"
    want_dir=""
    continue
  fi
  case "$arg" in
    --all) all=1 ;;
    --dir) want_dir=1; dir_given=1 ;;
    --dir=*)
      dir=${arg#--dir=}
      dir_given=1
      if [ -z "$dir" ]; then
        stop '--dir needs a folder, for example: --dir reference/modes'
      fi
      ;;
    -*) stop "I do not know the option \"$arg\". Use a mode id, --all, or --dir <folder>." ;;
    *)
      if [ -n "$id" ]; then stop 'Give one mode id.'; fi
      id="$arg"
      ;;
  esac
done

[ -z "$want_dir" ] || stop '--dir needs a folder, for example: --dir reference/modes'
if [ -n "$dir_given" ] && [ -z "$dir" ]; then
  stop '--dir needs a folder, for example: --dir reference/modes'
fi
if [ -n "$all" ] && [ -n "$id" ]; then stop 'Use either a mode id or --all, not both.'; fi
if [ -z "$all" ] && [ -z "$id" ]; then
  stop 'Give the mode id, for example: bash tools/check.sh more-by'
fi

# Same rule as check-mode.js and docs/CONTRACT.md section 2: letters a-z, single hyphens between words.
if [ -n "$id" ]; then
  if ! printf '%s\n' "$id" | grep -E '^[a-z]+(-[a-z]+)*$' >/dev/null 2>&1; then
    stop 'The mode id must use only the letters a-z and hyphens, for example "more-by".'
  fi
fi

# Go to the folder above tools/, so paths work from anywhere.
here=$(dirname "$0")
cd "$here/.." || stop 'I cannot open the app folder.'
[ -f tools/check-mode.js ] || stop 'I cannot find tools/check-mode.js.'

mode_dir=${dir:-app/modes}
mode_dir=${mode_dir%/}

if [ -z "$all" ]; then
  [ -f "$mode_dir/$id.js" ] || stop "I cannot find $mode_dir/$id.js."
  [ -f "$mode_dir/$id.check.js" ] || stop "I cannot find $mode_dir/$id.check.js. Write it first: docs/CONTRACT.md section 6."
fi

# The honest fallback: this script is the Mac's way, and osascript only exists on a Mac.
if ! command -v osascript >/dev/null 2>&1; then
  if [ -n "$all" ]; then
    if [ -n "$dir" ]; then
      stop "This needs osascript, which only a Mac has. On this computer, run: node tools/check-mode.js --all --dir \"$dir\""
    fi
    stop 'This needs osascript, which only a Mac has. On this computer, run: node tools/check-mode.js --all'
  fi
  if [ -n "$dir" ]; then
    stop "This needs osascript, which only a Mac has. On this computer, run: node tools/check-mode.js --dir \"$dir\" $id"
  fi
  stop "This needs osascript, which only a Mac has. On this computer, run: node tools/check-mode.js $id"
fi

if [ -n "$all" ]; then
  if [ -n "$dir" ]; then set -- --all --dir "$dir"; else set -- --all; fi
else
  if [ -n "$dir" ]; then set -- --dir "$dir" "$id"; else set -- "$id"; fi
fi

# Keep the output so a failure still counts if osascript's exit code is lost.
out=$(osascript -l JavaScript tools/check-mode.js "$@" 2>&1)
rc=$?
printf '%s\n' "$out"
# The documented exit codes only. A launcher that dies (127, 130, 143) is a STOP, not itself.
if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
  exit 2
fi
if printf '%s\n' "$out" | grep -E '^STOP: ' >/dev/null; then exit 2; fi
if [ "$rc" -ne 0 ]; then exit 1; fi
if printf '%s\n' "$out" | grep -E '^FAILED ' >/dev/null; then exit 1; fi
exit 0
