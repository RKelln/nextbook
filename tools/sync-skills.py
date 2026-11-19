#!/usr/bin/env python3
"""Keep the agent skills in one place.

.agents/skills/<name>/SKILL.md is the only source (OpenCode, Codex and other agents read it there). This script
writes the Claude Code copies from it:

  .claude/skills/<name>/SKILL.md   an exact copy
  .claude/commands/<name>.md       a thin wrapper, so /<name> works in Claude Code

    python3 tools/sync-skills.py            rewrite the copies
    python3 tools/sync-skills.py --check    change nothing; exit 1 and list the files that differ

Standard library only. A skill has only `name` and `description` frontmatter, which every agent accepts.
Never edit the generated files by hand.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".agents" / "skills"
SKILL_COPY = ROOT / ".claude" / "skills"
COMMANDS = ROOT / ".claude" / "commands"

# Claude Code shows this beside the command; the skills themselves carry no arguments.
HINTS = {
    "check": "<mode id>",
    "distance-map": "<a nearby intersection or corner>",
    "find-books": "<the words to search for>",
    "new-mode": "<mode id or the brief's name>",
    "use-nextbook": "<what to read or change>",
}


def description(text, name):
    m = re.match(r"---\nname: (.+)\ndescription: (.+)\n---\n", text)
    if not m or m.group(1) != name:
        sys.exit("%s: frontmatter must be exactly `name` and `description`, in that order, and name must match the folder" % name)
    return m.group(2)


def expected():
    """{path: text} for every generated file."""
    out = {}
    for src in sorted(SOURCE.glob("*/SKILL.md")):
        name = src.parent.name
        text = src.read_text(encoding="utf-8")
        desc = description(text, name)
        out[SKILL_COPY / name / "SKILL.md"] = text
        hint = HINTS.get(name)
        head = "---\ndescription: %s\n" % desc
        if hint:
            head += "argument-hint: %s\n" % hint
        out[COMMANDS / (name + ".md")] = (
            head + "---\n\nFollow the `%s` skill (`.agents/skills/%s/SKILL.md`) for this request: $ARGUMENTS\n" % (name, name))
    return out


def stale():
    """Generated files nothing in .agents/skills/ asks for."""
    want = expected()
    found = list(SKILL_COPY.glob("*/SKILL.md")) + list(COMMANDS.glob("*.md"))
    return [p for p in found if p not in want]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; exit 1 if a generated file differs")
    args = ap.parse_args(argv)
    want = expected()
    if not want:
        sys.exit("no skills in %s" % SOURCE)
    drift = []
    for path, text in want.items():
        have = path.read_text(encoding="utf-8") if path.is_file() else None
        if have != text:
            drift.append(path)
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8", newline="\n")
    extra = stale()
    if args.check:
        for p in drift:
            print("differs or missing: %s" % p.relative_to(ROOT))
        for p in extra:
            print("not in .agents/skills/: %s" % p.relative_to(ROOT))
        if drift or extra:
            print("run: python3 tools/sync-skills.py")
            return 1
        print("OK: %d skills, copies and commands match .agents/skills/" % (len(want) // 2))
        return 0
    for p in drift:
        print("wrote %s" % p.relative_to(ROOT))
    for p in extra:
        p.unlink()
        if p.parent != COMMANDS and not any(p.parent.iterdir()):
            p.parent.rmdir()
        print("removed %s" % p.relative_to(ROOT))
    print("OK: %d skills synced" % (len(want) // 2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
