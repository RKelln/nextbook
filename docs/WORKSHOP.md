# The workshop

This repository is the tool. A workshop is a separate thing that uses it, and this repo never holds the workshop's
material: dates, room, participants, teaching plan, or its own briefs. The session that this app was built for is one
of the workshops in Toronto Public Library's AI residency; the [residency page](https://www.ryankelln.com/tpl_2026/)
is the public place that lists them.

## The boundary

Two rules, both taken from the residency's own practice:

- **This repo describes the tool.** It names the library where the adapter needs it, because an adapter is a library:
  its data sources, URLs and vocabulary. It says nothing about a session.
- **A workshop describes the session.** Its brief, its timings and its files live with the workshop, and it points
  here for the tool rather than restating the architecture.

Neither describes the other's arrangements. Anyone opening this repo outside a workshop should never need to know one
happened.

## What a workshop takes from here

- `python3 tools/build.py --starter` → `dist/starter/`: the app, the practice shelf, the contract, the mode briefs and
  the check tool, in a folder a beginner can open on a library machine with nothing installed.
- An optional **agent connection**: `python3 tools/serve.py --workshop --mirror`,
  `tools/read-shelf.py`, and `/use-nextbook`. The included skill gives the privacy notice before reads
  or writes; both expose the titles and details the agent handles to the AI. Sharing is off by default.
- A **practice shelf** that fills with example books and clears in one click, so a shared machine can be tested and
  wiped without touching anything real.
- A **contract** a person's agent can follow: one page, one loop, and the rule that anything a model picks is checked
  against the list.
- A **menu of modes** as buildable briefs (`docs/modes/`), plus three reference builds for a projector. The room
  chooses; the show-and-tell compares mechanisms, not winners.

The exact promise the starter makes to anything built on it is in `docs/BUILD.md`, "What the starter guarantees".

## What this repo does not need from a workshop

Participant data, accounts, or any record of what a room did. A workshop copy shows the practice shelf only; importing
a real reading history is off in a starter.

## Using it outside a workshop

Nothing above is required. The app opens from a folder, the contract is one page, `tools/check-mode.js` checks a mode
you write, and `docs/modes/` is there if you want a brief to build from. The only things a workshop adds are people in
a room and a deadline.

## Ending an agent-sharing session

Stop the mirror server, remove `nextbook-live.json` and any temporary shelf files, and clear the practice
shelf using the host workshop's cleanup process. The mirror stays on disk after the server stops.
Never distribute live mirror or inbox files. Builds exclude them; workshop packaging should do the same.
