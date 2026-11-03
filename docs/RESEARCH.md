# Measurements

Taken from Ryan's workstation against the live services, with `curl`, a browser user agent, or the probes in
`research/probes/`. Every line here is something we checked, not something we assumed. When a re-check moves a
number, the line is corrected in place and says what changed.

## Toronto Public Library catalogue

| What | URL | Result |
|---|---|---|
| A record page | `tpl.bibliocommons.com/v2/record/S234C4805630` | 200, 581 KB, catalogue record in an embedded JSON block (re-checked 2026-11-03: was 596 KB earlier the same day; fields unchanged) |
| A search | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=le+guin` | 200, 945 KB, 63 bibs, **20 works**, 42 with subjects, 34 with descriptions (re-checked 2026-11-03: was 969 KB; counts unchanged) |
| Search-page fields | same, with `search_fields.py` (2026-11-03) | of 63 bibs: callNumber 47, genreForm 46, series 36, subjectHeadings 42; formats BK 45, EBOOK 9, EAUDIOBOOK 8, LPRINT 1; 55 distinct headings, 6 of them BISAC |
| New and on-order | `tpl.bibliocommons.com/v2/browse/titles/new` | 200, 712 KB, 18 bibs per page, 51,458 items total |
| Library read-alikes | `tpl.bibliocommons.com/v2/record/S234C4805630/recommendations` | 200, 807 KB, HTML, "provided by NoveList", **no CORS**. Fetched once to confirm the licence line; never again |
| `robots.txt` | `tpl.bibliocommons.com/robots.txt` (2026-11-03) | **`Crawl-delay: 120`** for `*`; disallows `/item/read_alike_list/`, `/v2/availability/`, `/item/full_record/`, `/item/syndetics_reviews`, `/bib/match/` among others; `Allow: /*` otherwise |
| Old catalogue search | `torontopubliclibrary.ca/search.jsp?Ntt=<q>` | **403**, and the host redirects to `tpl.ca` |
| Live search route | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=<title>+<author>` | 200, and it is what the library's own header search uses |

**CORS:** none of the catalogue pages send `access-control-allow-origin`. A page on another origin, or opened from a
file, cannot fetch them. This is the single fact that decides the architecture.

**Crawl-delay:** 120 seconds. A slice of about 600 works from search pages is roughly 30 to 40 requests, so about an
hour and a quarter, run once and cached. The same slice from record pages would take about twenty hours.

## TPL events feed

| What | URL | Result |
|---|---|---|
| Events RSS | `gateway.bibliocommons.com/v2/libraries/tpl/rss/events` | 200, XML, keyless |
| With a branch filter | `...?locations=CL&startDate=2026-11-03&endDate=2026-11-24` | 104 events at North York Central |
| Wrong branch code | `...?locations=NY` or `NYCL` | 200 with **zero** events, silently |

**CORS:** none. A browser page cannot fetch this either.

Other traps (from the residency repo's DDT finder notes): the date filter is mandatory, past the last page the feed
answers 200 with an empty body, virtual events carry no location, and a misspelled parameter is ignored rather than
rejected.

## Fallback enrichment

| Source | Result |
|---|---|
| Open Library search | `openlibrary.org/search.json` 200, CORS `*`, subjects, years, cover ids, edition counts |
| Open Library work | `/works/<id>.json` timed out repeatedly under load; descriptions unreliable |
| Wikipedia REST summary | 200, CORS `*`, description plus a paragraph extract, CC BY-SA |
| Wikipedia search | returned the **author's page** for The Dispossessed and The Marrow Thieves; 429 after about eight requests, sticky for minutes |
| Google Books | 429 on the first unauthenticated call; 1,000 a day with a key |
| Project Gutenberg / Gutendex | public-domain texts, not summaries; gutendex.com timed out from here |

## Related, already in the residency repo

- The catalogue link format and the dead `search.jsp` were found while preparing W13.
- The events feed, its branch codes and its traps were measured for the DDT town hall demo. `CL` is North York Central.
- TPL's Z39.50 endpoint (`symphony.tpl.ca:2200`, db `unicorn`) is live and official open data, returns MARC21, and has no
  holdings tags. It is the route to bibliographic metadata without scraping, and the fallback if the search pages
  change or the crawl delay grows.

## What we did not manage to check

- Whether the payload is stable across record types (a DVD, a magazine). The slice builder keeps books and e-books
  only, and says how many others it skipped.
- How many works a broad subject search yields per page compared with an author search (20 for "le guin"). The
  first slice build reports it per query.
- Whether a catalogue link opens correctly in a browser on a workshop MacBook; this machine's headless browser is
  refused by the catalogue.
