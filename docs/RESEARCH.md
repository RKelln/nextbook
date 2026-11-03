# Measurements

Taken 2026-11-03 from Ryan's workstation against the live services, with `curl` and a browser user agent. Every line
here is something we checked, not something we assumed. Re-check anything load-bearing before building on it.

## Toronto Public Library catalogue

| What | URL | Result |
|---|---|---|
| A record page | `tpl.bibliocommons.com/v2/record/S234C4805630` | 200, 596 KB, catalogue record in an embedded JSON block |
| A search | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=le+guin` | 200, 969 KB, 63 bibs, 42 with subjects, 34 with descriptions |
| New and on-order | `tpl.bibliocommons.com/v2/browse/titles/new` | 200, 712 KB, 18 bibs per page, 51,458 items total |
| Library read-alikes | `tpl.bibliocommons.com/v2/record/S234C4805630/recommendations` | 200, 807 KB, HTML, "provided by NoveList", **no CORS** |
| Old catalogue search | `torontopubliclibrary.ca/search.jsp?Ntt=<q>` | **403**, and the host redirects to `tpl.ca` |
| Live search route | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=<title>+<author>` | 200, and it is what the library's own header search uses |

**CORS:** none of the catalogue pages send `access-control-allow-origin`. A page on another origin, or opened from a
file, cannot fetch them. This is the single fact that decides the architecture.

## TPL events feed

| What | URL | Result |
|---|---|---|
| Events RSS | `gateway.bibliocommons.com/v2/libraries/tpl/rss/events` | 200, XML, keyless |
| With a branch filter | `...?locations=CL&startDate=2026-11-03&endDate=2026-11-24` | 104 events at North York Central |
| Wrong branch code | `...?locations=NY` or `NYCL` | 200 with **zero** events, silently |

**CORS:** none. A browser page cannot fetch this either.

Traps recorded in full in the residency repo's `events/DDT-town-hall/DDT_the-finder.md`: the date filter is mandatory,
past the last page the feed answers 200 with an empty body, virtual events carry no location, and a misspelled
parameter is ignored rather than rejected.

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

  and was corrected on 2026-11-03 (commit in the research repo).
- The events feed, its branch codes and its traps were measured for the DDT town hall demo. `CL` is North York Central.
- TPL's Z39.50 endpoint (`symphony.tpl.ca:2200`, db `unicorn`) is live and official open data, returns MARC21, and has no
  holdings tags. It is the route to bibliographic metadata without scraping, and it is not needed while the catalogue
  pages answer.

## What we did not manage to check

- Whether the catalogue payload is stable across record types (a DVD, a large-print edition, a magazine). Sample more
  before building a normaliser that assumes books.
- The per-branch availability fields inside `availabilityDetail`; the structure was present but empty on the sampled
  record because the item is "in-library use only".
- Whether NoveList content appears on any endpoint with a permissive CORS header. Assumed not, and the licence answer
  makes it moot.
