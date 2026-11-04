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
