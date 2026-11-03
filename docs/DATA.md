# The catalogue data

Everything here was measured on 2026-11-03 from this machine, against the live Toronto Public Library catalogue, with
`curl` and a normal browser user agent. Re-check before trusting: the markup and the payload keys change without
notice, and the probe in `research/probes/record_fields.py` prints what is actually there.

## The four surfaces

**A record.** `https://tpl.bibliocommons.com/v2/record/<recordId>`, for example `S234C4805630`. About 596 KB of HTML,
most of it application shell, with one `<script type="application/json">` block carrying the whole catalogue record.

**A search.** `https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=<words>&page=<n>`. About 970 KB. One
fetch returned **63 bibs**, 42 of them with subject headings and 34 with a description.

**New and on-order titles.** `https://tpl.bibliocommons.com/v2/browse/titles/new`. About 712 KB, **18 bibs per page**,
all 18 with subject headings and a description. The list holds **51,458 items**, so the whole thing is 2,859 pages.

**The library's own read-alikes.** `https://tpl.bibliocommons.com/v2/record/<recordId>/recommendations`. About 807 KB of
server-rendered HTML, "Recommendations provided by NoveList". **No JSON, no CORS, licensed content. Link only.**

## The record, field by field

The JSON block is large and nested. The record you want is at:

```
entities.bibs.<recordId>.briefInfo
```

and it carries, for the sampled record:

| Field | Example | Notes |
|---|---|---|
| `id`, `metadataId` | `S234C4805630` | the record id, the cache key |
| `groupKey` | `turbulent_sun_..._golub_l_text_eng` | **dedupe on this**, not on title |
| `title`, `subtitle` | The Turbulent Sun / A Natural History of Our Cosmic Origins and Future | |
| `authors` | `["Golub, L. (Leon)"]` | last name first, as catalogued |
| `isbns` | `["9780674292444", "0674292448"]` | |
| `format` | `BK` | code, not a word |
| `superFormats` | `["BOOKS", "MODERN_FORMATS"]` | coarse grouping |
| `contentType` | `NONFICTION` | or `FICTION` |
| `consumptionFormat` | `READ` | `LISTEN` exists |
| `audiences` | `["ADULT"]` | also `TEEN`, `JUVENILE` |
| `subjectHeadings` | `["Heliosphere (Astrophysics)", "Solar activity.", ...]` | LCSH, with `fast` variants and both cases |
| `compositeSubjectHeadings` | same, plus display forms | |
| `genreForm` | `["History"]` | **often empty**; do not build on it alone |
| `series` | `[]` | |
| `primaryLanguage` | `eng` | |
| `publicationDate` | `2026` | year only here |
| `callNumber` | `523.58 GOL` | |
| `jacket` | `{type: SYNDETICS, small: ...}` | cover, externally hosted |
| `rating` | `{}` | community ratings, usually absent |
| `description` | "Astronomer and science writer Leon Golub presents ..."-- Provided by publisher. | **the publisher's blurb** |

## The traps, each found the hard way

- **The description is HTML-escaped in some payloads.** One search result contained `&lt;p&gt;` inside the description
  string. Strip tags and unescape once, never twice.
- **`genreForm` is frequently empty**, even when the subject headings clearly say Fiction and Science Fiction. Use
  `subjectHeadings` as the primary facet source and `genreForm` as a bonus.
- **Author names appear among the subject headings** ("Kimmerer, Robin Wall, 1953-"), and "fast" variants duplicate
  headings ("Solar activity fast"). Normalise before counting anything.
- **Three vocabularies arrive in one field.** `subjectHeadings` mixes Library of Congress terms, LC "fast" variants, and
  BISAC trade categories written as `FICTION / Science Fiction / Action & Adventure bisacsh`. All three are useful and
  none is a clean facet until you decide how to map them, which is a job for the adapter, not the app.
- **The same work appears several times** across editions and formats on one search page. Dedupe on `groupKey`, and pick
  the manifestation you want to show.
- **There is no CORS header on any catalogue page.** A browser app opened from a file, or served from another origin,
  cannot fetch these. Whatever the app shows has to be fetched by a build step or a server, or be seen on the library's
  own page.
- **The "new titles" list is 2,859 pages.** A crawl of it is a few gigabytes. Slice it, never mirror it.
- **`search.jsp` is dead.** `torontopubliclibrary.ca/search.jsp?Ntt=` answers 403 and the host redirects to `tpl.ca`.
  Build catalogue links as `tpl.bibliocommons.com/v2/search?searchType=keyword&query=<title>+<author>`.

## What we may and may not do with it

- **Catalogue records** (title, author, subjects, genre, audience, year, ISBN) are the library's bibliographic data,
  published openly through Z39.50 under the City of Toronto Open Government Licence. Using them to rank and to link is
  the intended use.
- **The publisher blurb** is copyrighted marketing copy, shown by the library with "Provided by publisher". In the thin
  build we do not store or display it; the library's page does. If a thicker build ever shows it, it is one record at a
  time with the credit and the link, never a searchable corpus.
- **NoveList** is licensed to the library. Do not read it with code, do not copy the list, do not cache it. A link is
  fine.

## Fallback sources, for books the library does not hold

Measured the same day, because a reader's shelf is not limited to what TPL stocks.

- **Open Library** `https://openlibrary.org/search.json?q=<words>` answers with `access-control-allow-origin: *`, fast,
  and returns title, author, first publish year, subjects, cover id, edition count. Good for identity and coarse
  subjects. The per-work endpoint (`/works/<id>.json`, where the description lives) timed out repeatedly under load, so
  treat descriptions as unreliable from there.
- **Wikipedia** REST summary (`/api/rest_v1/page/summary/<page>`) answers with CORS `*`, a description and a paragraph
  extract, CC BY-SA. Two problems: a title-plus-author search returns the **author's page** about a quarter of the time
  (measured: The Dispossessed, The Marrow Thieves), and the search endpoint throttled after roughly eight requests
  (429, sticky for minutes). So: resolve identity first, then fetch the page, at build time, slowly.
- **Google Books** is the best description and category source, but unauthenticated it answered 429 on the first call.
  With a key it is 1,000 requests a day free. Optional, and a good thing for someone else to build.

## Re-checking

```sh
python3 research/probes/record_fields.py S234C4805630   # prints the briefInfo fields that exist now
python3 research/probes/search_bibs.py "le guin"        # how many bibs, how many with subjects, per search page
```

Both write nothing and print what they find. If a field named in this document has gone, correct this document in place
and say so in `docs/RESEARCH.md`.
