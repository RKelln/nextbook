# Catalogue fixtures

`robots.txt` and `briefs-le-guin.json` were both read on **2026-11-03** with
`adapters/bibliocommons/fetch.py` (user agent `nextbook/1.0 (+https://github.com/RKelln/nextbook)`).

- `robots.txt` — `https://tpl.bibliocommons.com/robots.txt`, fetched once and saved
  as-is (1,867 bytes). `Crawl-delay: 120`, the disallow list, and `Allow: /*`.
- `briefs-le-guin.json` — the cleaned `briefInfo` of every bib on
  `https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=le%20guin&page=1`,
  one on-demand request: **63 briefs, 20 distinct `groupKey`s** (42 with subject
  headings, 47 with a call number, 46 with `genreForm`). No `description`,
  `jacket` or `rating`: the parser drops them before anything is written.

## Events

- `events-page.xml` — one real page of the events feed,
  `gateway.bibliocommons.com/v2/libraries/tpl/rss/events?locations=CL&startDate=2026-11-03&endDate=2026-11-24&page=1`,
  read once through `fetch.Fetcher` (batch kind) on 2026-11-03 and saved as it
  came: 71,528 bytes, **25 items**, all at North York Central. The feed puts 25
  items on a page, oldest first, and sends no "next" link; an empty body is the
  stop signal.
- `events-edge.xml` — three items of that same page, rearranged so the tests can
  see the branches the live page did not happen to carry: the first marked
  `bc:is_cancelled` true, the second made virtual with its `bc:location`
  removed, the third given a long tag-laden `<description>`. Same element order
  and namespaces as the feed; no event was invented.

The pages are snapshots; the catalogue changes. The counts and the fields they
carry are recorded in `docs/DATA.md` and `docs/RESEARCH.md`.

## Shelf pages

`shelf-page.html` and `shelf-page-2.html` are **made up**. No library page was saved,
and no account was read: they are written in the shape `docs/DATA.md` measured
("A person's own shelf page", 2026-11-03), with an invented person (`N0TPERS0N`),
an invented barcode, and decoys — a name, an email, a session id and a token — that
exist only so `tests/library-shelf.test.js` can prove the reader never returns them.

- `shelf-page.html` — page 1. Four shelf items across three shelves; two of them are
  editions of one work (same `groupKey`, different record id), so they make one entry.
  The page states 2 Completed (both here: whole), 1 of 2 In Progress, and page 1 of 2
  for For Later, so one shelf is complete and two are not. Its briefs carry
  `description`, `jacket` and `rating` on purpose, to prove those are dropped.
- `shelf-page-2.html` — page 2 of the same For Later shelf, one book. With the first
  page it covers the shelf (pages 1 and 2 of 2, 2 of 2 books), which is what
  `Nextbook.libraryShelf.combine()` is for.

Both pages carry the library's own count line (`1 to 2 of 2 items`, `2 to 2 of 2 items`) in a
header and a footer, because a real saved page carries it: the state has no totals, but the page's
words do (D39, measured on two real pages 2026-11-04). The first page holds items from three
shelves -- the case a real shelf page never has -- so its line is deliberately not attributed;
the second holds one shelf's items, so its line is. The line is the only reason those numbers are
in the fixtures, and the reader is not told about them any other way.
