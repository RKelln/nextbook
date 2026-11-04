# Measurements

Taken from a development machine against the live services, with `curl`, a browser user agent, or the probes in
`research/probes/`. Every line here is something we checked, not something we assumed. When a re-check moves a
number, the line is corrected in place and says what changed.

## Toronto Public Library catalogue

| What | URL | Result |
|---|---|---|
| A record page | `tpl.bibliocommons.com/v2/record/S234C4805630` | 200, 581 KB, catalogue record in an embedded JSON block (re-checked 2026-11-03: was 596 KB earlier the same day; fields unchanged) |
| A search | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=le+guin` | 200, 945 KB, 63 bibs, **20 works**, 42 with subjects, 34 with descriptions (re-checked 2026-11-03: was 969 KB; counts unchanged) |
| Search-page fields | same, with `search_fields.py` (2026-11-03) | of 63 bibs: callNumber 47, genreForm 46, series 36, subjectHeadings 42; formats BK 45, EBOOK 9, EAUDIOBOOK 8, LPRINT 1; 55 distinct headings, 6 of them BISAC |
| Author spellings on one page | same page, parsed with the adapter (2026-11-03) | 20 `groupKey`s but **12 distinct titles**: TPL files some Le Guin editions under `Guin, Ursula K. Le` and some under `Le Guin, Ursula K., 1929-2018`, so one book lands in two `groupKey`s and neither the merge nor the section carries across. 7 of the 20 works have no call number, because their print sibling is in the other group. `author_key()` folds the trailing particle so both spellings give `le guin, u` |
| New and on-order | `tpl.bibliocommons.com/v2/browse/titles/new` | 200, 712 KB, 18 bibs per page, 51,458 items total |
| Library read-alikes | `tpl.bibliocommons.com/v2/record/S234C4805630/recommendations` | 200, 807 KB, HTML, "provided by NoveList", **no CORS**. Fetched once to confirm the licence line; never again |
| `robots.txt` | `tpl.bibliocommons.com/robots.txt` (2026-11-03) | **`Crawl-delay: 120`** for `*`; disallows `/item/read_alike_list/`, `/v2/availability/`, `/item/full_record/`, `/item/syndetics_reviews`, `/bib/match/` among others; `Allow: /*` otherwise |
| Old catalogue search | `torontopubliclibrary.ca/search.jsp?Ntt=<q>` | **403**, and the host redirects to `tpl.ca` |
| Live search route | `tpl.bibliocommons.com/v2/search?searchType=keyword&query=<title>+<author>` | 200, and it is what the library's own header search uses |

| App state on a public page | same search page, with `saved_page_shape.py` (2026-11-03) | top-level `shelves`, `borrowing`, `user`, `auth` keys beside `entities`. `shelves.shelfSearch.shelf` has `userId`, `name`, `privateByDefault`, `items`, `pagination`, empty when signed out; `shelves.importResult` matches the account page's "Import Content from Previous Catalogue". Signed in: see the next row |
| A saved signed-in shelf page | "Completed" shelf, saved by hand with the browser's Save Page, read with `saved_page_shape.py` (2026-11-03; shapes and codes only, no titles left that page) | **server-rendered, items filled.** `entities.shelves.<userId>.<itemId>` = `{id, metadataId, shelf, privateItem, dateAdded, authors, title, rating}`; `metadataId` is the record id and is a key of `entities.bibs`, whose `briefInfo` carries `groupKey` and subject headings. `shelf` codes `for_later`, `in_progress`, `completed`. `rating` is out of 10: a 4-star rating is `8`, unrated is `0`. The shelf's size is **not** in the state: the re-check of 2026-11-04 found no `shelfSearch` and no `meta`, only the rendered line `1 to 2 of 2 items` (D39). The same page also carries the card barcode, name, email, a session id and an auth token |
| A saved signed-in shelf page, re-checked (2026-11-04) | the same page type, saved by hand, read with a shape-only probe in this repo | **no totals and no pagination.** `entities.shelves.<userId>` maps item id to the same eight fields, `entities.bibs[id].briefInfo` carries `groupKey`, `genreForm`, `callNumber`, `authors`, `audiences`, `contentType`, `compositeSubjectHeadings`, `series`, `jacket` — and there is **no `shelfSearch` and no `meta`**, so neither the count nor the page number is in the file. The barcode, name, email, session id and token are still in it |
| A saved signed-in search page | same probe (2026-11-03, re-checked 2026-11-04) | the user and account entities are filled; no shelf state for the results (`shelves` empty). Nothing to read there |
| The account links in the site header | a cached public search page, `.cache/tpl/`, fetched 2026-11-03, read 2026-11-04 with grep (no new request) | the header's account menu links `/user/login`, `/holds`, `/checkedout`, `/collection/show/my/library/for_later` (and `in_progress`, `completed`), `/account/pickup_location` and `/account`, all on `tpl.bibliocommons.com`. The header's sign-in link carries no return address, but the page takes one: `/user/login?destination=%2Fholds` signs in and lands on the holds page, and `/user/login?destination=%2Fv2%2Frecord%2FS234C4805630` signs in and lands on that record page (Ryan, by hand, 2026-11-04). Signed in already, the same link goes straight to the page with no sign-in form (same day). `destination` is a path on the same host, URL-encoded. `robots.txt` disallows `/user/login` and `/holds/select_hold/` to robots; a link a person presses is not a robot, and the adapter never requests either |

**CORS:** none of the catalogue pages send `access-control-allow-origin`. A page on another origin, or opened from a
file, cannot fetch them. This is the single fact that decides the architecture.

**Crawl-delay:** 120 seconds, applied to the batch slice build; on-demand searches are paced per D27. A slice of about 600 works from search pages is roughly 30 to 40 requests, so about an
hour and a quarter, run once and cached. The same slice from record pages would take about twenty hours.

## TPL events feed

| What | URL | Result |
|---|---|---|
| Events RSS | `gateway.bibliocommons.com/v2/libraries/tpl/rss/events` | 200, XML, keyless |
| With a branch filter | `...?locations=CL&startDate=2026-11-03&endDate=2026-11-24` | 104 events at North York Central (re-checked 2026-11-03 when the snapshot was built: 103 records, one cancelled, **102 kept**) |
| Wrong branch code | `...?locations=NY` or `NYCL` | 200 with **zero** events, silently |
| Events robots.txt | `gateway.bibliocommons.com/robots.txt` | **404** on 2026-11-03, so the feed's host states no rules. It is read at batch pace, through the same fetcher, and only that one path is ever requested |

**CORS:** none. A browser page cannot fetch this either.

Other traps (measured for an events finder built earlier): the date filter is mandatory, past the last page the feed
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

## Related, found earlier

- The catalogue link format and the dead `search.jsp` were found while preparing the first run.
- The events feed, its branch codes and its traps were measured for a town-hall demo. `CL` is North York Central.
- TPL's Z39.50 endpoint (`symphony.tpl.ca:2200`, db `unicorn`) is live and official open data, returns MARC21, and has no
  holdings tags. It is the route to bibliographic metadata without scraping, and the fallback if the search pages
  change or the crawl delay grows.

## What we did not manage to check

- Whether the payload is stable across record types (a DVD, a magazine). The slice builder keeps books and e-books
  only, and says how many others it skipped.
- How many works a broad subject search yields per page compared with an author search (20 for "le guin"). The
  first slice build reports it per query.
- Whether a catalogue link opens correctly in an ordinary browser profile: the headless browser used here is refused
  by the catalogue.
