# TODO

## Harness-agnostic

Done (2026-11-19):
- `.agents/skills/` is the one source of the skills: `check`, `distance-map`, `find-books`, `new-mode`,
  `use-nextbook`. Only `name` and `description` frontmatter; no `$ARGUMENTS`; written to the agent, not "me".
- `tools/sync-skills.py` writes `.claude/skills/` (copies) and `.claude/commands/` (thin wrappers, so `/check` and the
  rest still work in Claude Code). `python3 tools/sync-skills.py --check` exits 1 on drift; `tests/test_sync_skills.py`
  runs it. Edit `.agents/skills/`, then run the script.
- `tools/commands/` (old command sources) removed. `AGENTS.md`, `README.md`, `docs/` and `tools/build.py` say "the
  `use-nextbook` skill", not a `.claude/` path. The starter build carries `.agents/skills/` too.
- The `check` skill names both routes: `node tools/check-mode.js <id>`, and on a Mac with no Node
  `bash tools/check.sh <id>` (osascript); on other computers it says Node is needed and offers to help install it.
  `tools/check.sh` is unchanged.

Left:
- `docs/modes/README.md` talks about workshop sizing. That is general guidance, left as it is on purpose.
- `CLAUDE.md` is just `@AGENTS.md`; other agents read `AGENTS.md` directly. Nothing to do unless one needs its own file.
- `opencode.jsonc` has no allow rule for `python3 tools/sync-skills.py`; add one if OpenCode users should run it
  without a prompt.
- Other agents' commands (Gemini CLI `.toml` etc.) are not generated; they read the skills. Add them to
  `tools/sync-skills.py` if someone needs them.
