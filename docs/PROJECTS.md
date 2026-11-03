# Sibling projects

All of these live in `~/Documents/Projects` unless noted, and all are MIT except where stated. Borrow the pattern, not
the code, and say where it came from.

## searchdesk

A job-search desk that runs from plain files in a browser: features as single files behind a small contract, a folder
copy that works with an agent, a built single file for hosting, and a test suite that skips (loudly) when a file is
missing.

**Take:** the per-feature contract with its own check file (here, the mode contract), classic scripts that open from
`file://`, a stdlib build that packs one file, the in-browser self-test, the "paste packet" route for people with only a
chat window, the example feature nobody was asked to build, and the read-me-first `AGENTS.md` with its rules for small
models. This repo's app should feel like a smaller cousin.

Note: Search Desk keeps its data in `data/*.js` files that set globals, not in `application/json` script blocks. An
earlier version of this repo's `AGENTS.md` said otherwise. The JSON-block pattern is the residency starter's (below),
and here it is used only in the built single file.
**Do not take:** its size. Search Desk is a platform; nextbook is one screen and a shortlist.

## tpl-finder

A demo built for a town hall: what is on at the library that I can get to and am I free for. Reads the events feed,
computes travel times from a pre-built distance map, reads a calendar, writes a ranked HTML page, and can hand the
filtered list to a small model to pick from.

Location: `~/Documents/Projects/tpl-finder-1` (and two earlier variants).

**Take:** the events adapter and its traps, the travel-time cache keyed by branch and hour, and the "ids only, checked
against the list" guard that goes with any model picking.
**Do not take:** its Python runtime. The workshop app is a file in a browser; the finder is a program for a projector.

## The W13 starter (residency repo)

`~/Documents/work/tpl/applied_ai_2026/events/W13-personal-library-app/seed_src/`. A working single-file shelf app built
from a template, with a 30-book reading pack (mood, pace, themes, a note in our own words) and an events snapshot.
It runs the first W13 session as it is.

**Take:** the pack, which becomes `data/tags.json` and the practice shelf (D15); the rating weights; the
`profile`/`score`/`explain` shape in its `discovery.js`; the template-builds-starter-and-demo idea; `fetch_events.py`
for the P1 events snapshot.
**Do not take:** the hand-tagged genres and themes as facets (the catalogue's subjects replace them), or search-page
links for books that have a record id.

## get2know and standin

An AI interviewer that writes down how a small organisation actually works, and a tool that lets an AI work on files
without seeing private values.

**Take:** the interview-then-brief shape if a mode ever needs to ask a reader questions (a club season, a ladder), and
Standin's shape-and-restore idea if a future version ever handles anything private. Neither is needed in the thin build.

## rehearse

A harness where one model plays a person so an AI conversation can be tested.

**Take:** the idea of a scripted test reader, if we ever need to prove the model seam behaves. A fixed shelf and a fixed
shortlist already cover most of it.

## The residency repo

`~/Documents/work/tpl/applied_ai_2026`. Event files, the workshop kits, the payload pipeline, and the research wiki
behind every measurement in this repo. The workshop's own source of truth is `events/W13-personal-library-app/W13.md`;
`docs/W13.md` here only states the boundary.
