# Sibling projects

All of these live in `~/Documents/Projects` unless noted, and all are MIT except where stated. Borrow the pattern, not
the code, and say where it came from.

## searchdesk

A job-search desk that runs from plain files in a browser: features as single files behind a small contract, a folder
copy that works with an agent, a built single file for hosting, and a test suite that skips (loudly) when a file is
missing.

**Take:** the single-file app pattern, the per-feature contract with its own check file, the "paste packet" route for
people with only a chat window, and the read-me-first `AGENTS.md`. This repo's app should feel like a smaller cousin.
**Do not take:** its size. Search Desk is a platform; nextbook is one screen and a shortlist.

## tpl-finder

A demo built for a town hall: what is on at the library that I can get to and am I free for. Reads the events feed,
computes travel times from a pre-built distance map, reads a calendar, writes a ranked HTML page, and can hand the
filtered list to a small model to pick from.

Location: `~/Documents/Projects/tpl-finder-1` (and two earlier variants).

**Take:** the events adapter and its traps, the travel-time cache keyed by branch and hour, and the "ids only, checked
against the list" guard that goes with any model picking.
**Do not take:** its Python runtime. The workshop app is a file in a browser; the finder is a program for a projector.

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
