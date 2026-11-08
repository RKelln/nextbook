# Prior art

Patterns this app borrowed, and the ones it deliberately did not. Taking a pattern from a working project is cheaper
than inventing one, and naming where it came from is the price.

## searchdesk

A job-search desk that runs from plain files in a browser: features as single files behind a small contract, a folder
copy that works with an agent, a built single file for hosting, and a test suite that skips loudly when a file is
missing. Public: [github.com/RKelln/searchdesk](https://github.com/RKelln/searchdesk), running at
[searchdesk.ryankelln.com](https://searchdesk.ryankelln.com).

**Take:** the per-feature contract with its own check file (here, the mode contract), classic scripts that open from
`file://`, a standard-library build that packs one file, the in-browser self-test, the "paste packet" idea for people
with only a chat window, the example feature nobody was asked to build, and the read-me-first `AGENTS.md` with its
rules for small models.

**Do not take:** its size. Search Desk is a platform; nextbook is one screen and a shortlist.

Note: Search Desk keeps its data in `data/*.js` files that set globals, not in `application/json` script blocks. Here
the JSON-block pattern is used only in the built single file.

## The pattern set, without the projects

Three shapes came from earlier tools of the same kind, and each is small enough to describe rather than link:

- **An events feed with traps.** A finder built for a town hall reads the library's events feed, computes travel times
  and hands a filtered list to a model. Taken: the event adapter, its traps, and the "ids only, checked against the
  list" guard that has to go with any model that picks. Not taken: its Python runtime.
- **Interview, then brief.** A tool that interviews a small organisation and writes down how it works. Taken: the
  shape, if a mode ever needs to ask a reader questions (a club season, a ladder). Not needed in the thin build.
- **A scripted test reader.** A harness where one model plays a person so a conversation can be tested. Taken: the
  idea of a fixed reader, if the model seam ever needs proving end to end. A fixed shelf and a fixed shortlist
  already cover most of it.

## What we borrow from the library itself

The catalogue's own subject headings, its search and record pages, and its event listings, read within its
`robots.txt` and at a person's pace. `docs/DATA.md` has every measurement and every trap, with the URL and the date.

**Do not take:** the "You may also like" list on a record page. It is licensed to the library, and it is linked to,
never copied.
