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

The page is a snapshot; the catalogue changes. The counts and the fields it
carries are recorded in `docs/DATA.md` and `docs/RESEARCH.md`.
