# nextbook

A reading-life tool that helps a person decide what to read next from their **public library's own catalogue**, and then
sends them to the library's page to borrow it.

Working name. The product name and the domain are Ryan's call, not this file's.

## The shape in five lines

1. The person keeps a shelf: what they have read, are reading, want, and how they rated it.
2. A mode narrows the library's list to six candidates with a cheap rule, and says why for each.
3. A model argues for two of the six, in one sentence each, using only the six it was given.
4. The person decides.
5. Every candidate links out to the library's record page, where availability, formats, the hold button and the
   library's own read-alike suggestions live.

The app is a decision layer and a router. It is not a catalogue, not a recommender service, and not a reading tracker
in the cloud.

## What is here

| Path | What it holds |
|---|---|
| `README.md` | this file: the promise and the boundaries |
| `AGENTS.md` | read this first if you are an agent building here |
| `docs/DESIGN.md` | the product: three jobs, the mode menu, the output contract, what we refuse |
| `docs/ARCHITECTURE.md` | the shapes: data files, shelf, scoring, reasons, modes, model seam, packing |
| `docs/DATA.md` | what the library catalogue actually gives you, measured, with the traps and the facet rules |
| `docs/CONTRACT.md` | how to write a mode: the one file a participant's agent needs |
| `docs/modes/` | the mode menu, one buildable brief per mode |
| `docs/BUILD.md` | the task list for building the foundation, with checks |
| `docs/DECISIONS.md` | the calls already made, with dates and provenance |
| `docs/RESEARCH.md` | the measurements: URLs, statuses, sizes, licences |
| `docs/PROJECTS.md` | sibling projects to borrow from, and what not to borrow |
| `docs/W13.md` | how the Toronto workshop uses this repo (pointer, not a copy) |
| `research/probes/` | the throwaway scripts that produced the measurements. Not the product. |

## Boundaries that are not negotiable

- **No tracking, no accounts, no server-side shelf.** A person's reading history stays in their browser. Export is a
  file they hold.
- **No ingestion of NoveList.** The library's "You may also like" is licensed editorial content. Link to it, never copy
  it.
- **No bulk mirror of the catalogue.** Query and cache what a person looked at. Never crawl 51,000 records so we own a
  copy.
- **No publisher blurbs in our own pages** in the thin build. Our words, the library's page, the library's blurb.
- **No model in the search path.** Models argue between finalists; arithmetic narrows the field.

## Status

Design and plan, 2026-11-03. No application code yet. The foundation is built task by task from `docs/BUILD.md`;
the modes are left as briefs for people to build. Every measurement in `docs/` carries its URL and date so it can be
re-checked.

## Licence

MIT. See `LICENSE`.
