# AGENTS.md

Read this before changing anything. This repo is design-first: the documents are the product right now, and code
arrives in the order `docs/BUILD.md` gives.

## What you are building

A single-file web app that helps one person decide what to read next from their public library's catalogue, then links
them to the library's record page. Read `docs/DESIGN.md` for the shape and `docs/ARCHITECTURE.md` for the mechanics.

## Rules that come from the project, not from taste

1. **The person's shelf never leaves their browser.** No accounts, no server storage, no analytics, no telemetry.
2. **Never scrape or republish NoveList.** The "You may also like" content on a record page is licensed to the library.
   A link out is allowed; copying the list is not.
3. **Never build a catalogue mirror.** Query the library, read the records that come back, cache by record id. Do not
   crawl the catalogue to own a copy of it.
4. **Do not store publisher blurbs** in the app or in any data file that ships. In the thin build the blurb is only
   ever seen on the library's own page.
5. **A model only ever chooses among ids that exist** and its answer is checked against the shortlist before display.
   Anything it invents is dropped and named.
6. **Every suggestion carries a reason in words** the person can argue with. A score with no sentence is a bug.
7. **The app works offline** from a file, and says so when it cannot do something.

## How to work here

- Read `docs/BUILD.md` before writing code. It is ordered, and each step has an acceptance check.
- Measurements belong in `docs/RESEARCH.md` with the URL and the date. If you re-check something and it moved, correct
  the line in place and say what changed. Do not append a correction underneath.
- Probes live in `research/probes/` and never ship. They are how a claim got checked, not part of the product.
- The app itself is one HTML file with its data in its own `application/json` script blocks, parsed inside `try`/`catch`
  with a plain sentence on failure. `projects/searchdesk` is the working example of that pattern.
- Keep user-facing words at about grade 6, plain sentences, no jargon.
- Commit in small steps with a message that says why. Do not push.

## What not to do

- Do not add a build step, a framework, or a dependency to the app. It is one file on purpose.
- Do not invent catalogue fields. `docs/DATA.md` lists what the library actually returns.
- Do not turn the workshop material into repo content or the reverse. The boundary is in `docs/W13.md`.
