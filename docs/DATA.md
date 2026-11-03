# The catalogue data

Measured against the live Toronto Public Library catalogue with `curl` and the probes in `research/probes/`. First
measured 2026-11-03; re-checked the same day (record size, search-page fields, `robots.txt`). Re-check before
trusting: the markup and the payload keys change without notice.

## The rules of the house: `robots.txt`

`https://tpl.bibliocommons.com/robots.txt`, read 2026-11-03, for `User-agent: *`:

- **`Crawl-delay: 120`.** One request every two minutes. This decides how the slice is built: a record page gives
  one work per request, a search page gives about twenty, so **the slice is built from search pages**, not record
  pages.
- `Disallow` includes `/item/read_alike_list/` (the NoveList panel), `/v2/availability/`, `/item/full_record/`,
  `/item/syndetics_reviews` and `/bib/match/`. The adapter fetches only `/v2/search` and `/v2/browse/titles/new`, and
  refuses any other path.
- `Allow: /*` otherwise.

The adapter reads `robots.txt` at the start of every run and stops if `/v2/search` is disallowed or the delay has gone
up.

### Pacing (D27)

`Crawl-delay` is addressed to robots that walk a site to index it. Two kinds of request here, paced differently:

| Kind | What | Pace |
|---|---|---|
| **Batch** | `build_slice.py` fetching its query list, unattended | the full `Crawl-delay` (120 s), one at a time |
| **On demand** | `tools/find.py`, one search a person asked for through their agent | one request at a time, at least 5 s apart, at most 3 pages per command, every page cached by URL |

Both send the identifying user agent, both refuse disallowed paths, and neither ever runs in a loop on its own.

## The four surfaces

**A record.** `https://tpl.bibliocommons.com/v2/record/<recordId>`, for example `S234C4805630`. About 581 KB of HTML,
with one `<script type="application/json">` block carrying the record. **This is where the app links people.** The
adapter does not fetch it (one work per two minutes is too slow), except a human spot check in a browser.

**A search.** `https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=<words>&page=<n>`. About 945 KB. One
page for "le guin" carried **63 bibs, 20 distinct works** (`groupKey`), 42 with subject headings, 47 with a call
number, 46 with `genreForm`. **This is the adapter's source.**

**New and on-order titles.** `https://tpl.bibliocommons.com/v2/browse/titles/new`. About 712 KB, 18 bibs per page,
51,458 items. Many are on order, and nobody has read them yet, so they are a poor seed for a shelf. A page or two
for freshness at most.

**The library's own read-alikes.** `.../v2/record/<recordId>/recommendations`. Server-rendered HTML, "Recommendations
provided by NoveList". **Licensed. Link only. Never fetch.**

## The record, field by field

The JSON block is large and nested. A record is at `entities.bibs.<recordId>.briefInfo`, on record pages and search
pages alike.

| Field | Example | On a search page (63 bibs) | Notes |
|---|---|---|---|
| `id`, `metadataId` | `S234C4805630` | all | the record id; the link and the cache key |
| `groupKey` | `turbulent_sun_..._golub_l_text_eng` | all | **dedupe on this**, not on title. Contains a non-ASCII separator: keep it as a string, do not split it |
| `title`, `subtitle` | The Turbulent Sun / A Natural History of ... | all | a collection can have the author as its title ("Ursula K. Le Guin", Library of America) |
| `authors` | `["Golub, L. (Leon)"]` | 62 | last name first, sometimes with dates or a fuller form in brackets |
| `isbns` | `["9780674292444"]` | | |
| `format` | `BK` | all | seen: `BK`, `EBOOK`, `EAUDIOBOOK`, `LPRINT` |
| `contentType` | `NONFICTION` | all | or `FICTION` |
| `audiences` | `["ADULT"]` | all | also `TEEN`, `JUVENILE` |
| `subjectHeadings` | `["Wizards Juvenile fiction.", ...]` | 42 | three vocabularies mixed; see below |
| `genreForm` | `["Juvenile fiction", "Science fiction"]` | 46 | **often empty** on e-formats; a bonus, not a base |
| `series` | `[{name: "Earthsea ", volume: "2.", volumeNumber: 2}]` | 36 | names carry trailing spaces; the same series under two names ("Earthsea", "Earthsea cycle") |
| `publicationDate` | `2026` | all | year only |
| `callNumber` | `523.58 GOL`, `SCIENCE FICTION LEG`, `ON ORDER` | 47 | Dewey for non-fiction, shelf words for fiction, absent on e-formats |
| `primaryLanguage` | `eng` | | |
| `jacket` | `{type: SYNDETICS, ...}` | | cover, licensed, **not kept** |
| `rating` | `{}` | | usually empty, **not kept** |
| `description` | "... -- Provided by publisher." | 34 | **the publisher's blurb. Never kept.** |

## From headings to facets

This is the most load-bearing piece of the adapter, because two books can only be compared through shared facets. Raw
headings almost never match exactly: "Wizards Juvenile fiction." and "Wizards Fiction." are the same subject. The
normaliser, `adapters/bibliocommons/normalise.py`, applies these in order, each one a pure function with a test:

1. **Drop author headings.** A heading that matches one of the work's authors, or the pattern `<Last>, <First>,
   <year>-`, is dropped ("Kimmerer, Robin Wall, 1953-").
2. **Drop "fast" duplicates.** A heading ending in ` fast` duplicates another; drop it.
3. **BISAC.** A heading ending in ` bisacsh` is `TOP / Second / Third.`. Keep the second level only, as
   `bisac:<slug>` with the label in lower case ("FICTION / Science Fiction / Action & Adventure" →
   `bisac:science-fiction`, "science fiction"). Drop a second level of `General`; then keep the top level instead
   (`bisac:juvenile-fiction`).
4. **Form subdivisions.** Strip trailing form words, longest first, from this list (in `adapters/bibliocommons/config.json`, so
   it can grow): `Juvenile fiction`, `Juvenile literature`, `Comic books, strips, etc`, `Fiction`, `History`,
   `Biography`, `Drama`, `Poetry`, `Criticism and interpretation`. The rest is the topic: `topic:<slug>`, label in
   lower case ("Wizards Juvenile fiction." → `topic:wizards`, "wizards").
5. **Genre words.** A heading that is exactly a known genre ("Fiction", "Science Fiction", "Fantasy", "Thriller",
   "Mythology", "Young Adult Fiction", "Literature", "Comic and Graphic Books", ...; the list is in the config) becomes
   `genre:<slug>`, and so does every `genreForm` value. `Fiction` and `Literature` alone are dropped: everything in
   a fiction slice has them, so they explain nothing.
6. **Section.** From `callNumber`: three leading digits give `section:<hundreds>` with the Dewey class label ("the
   science shelves (500s)"); leading words before the author mark give the fiction shelf (`SCIENCE FICTION LEG` →
   `section:science-fiction`, "the science fiction shelves"). `ON ORDER` and absent call numbers give no section. A
   work takes the section of any manifestation that has one.
7. **Series.** Each series name, trimmed and lower-cased, gives `series:<slug>`, label "the <Name> series".
8. **Merge across manifestations.** A work's facets are the union over every bib with its `groupKey` on any fetched
   page.
9. **Drop singletons.** After the whole slice is built, a facet on only one work is removed, and the report says how
   many were.

The report `build_slice.py` prints is the acceptance test for this: works, facets kept, singletons dropped, the
median facets per work, the share of works with at least three facets, and the share with at least one section. A
slice where most works have fewer than three facets will give thin reasons; widen the queries before tuning the
weights.

## The traps, each found the hard way

- **The description is HTML-escaped in some payloads** (`&lt;p&gt;`). Moot for us, because it is never kept, but a
  probe that prints it should unescape once, never twice.
- **`genreForm` is frequently empty**, even when the headings plainly say Fiction and Science Fiction.
- **Author names appear among the subject headings.** Rule 1 above.
- **Three vocabularies arrive in one field:** Library of Congress headings, their "fast" twins, and BISAC trade
  categories. Rules 2 to 5 above.
- **The same work appears several times on one page**, across editions and formats: 63 bibs, 20 works. Dedupe on
  `groupKey`.
- **The same series under two names**, with trailing spaces. Trim; do not try to merge names.
- **There is no CORS header on any catalogue page.** Nothing at run time can fetch the catalogue.
- **`Crawl-delay: 120`.** A careless loop over record pages would take hours and break the house rules.
- **`search.jsp` is dead.** `torontopubliclibrary.ca/search.jsp?Ntt=` answers 403 and the host redirects to `tpl.ca`.
  Search links are `tpl.bibliocommons.com/v2/search?searchType=keyword&query=<title>+<author>`.

## What we may and may not do with it

- **Catalogue records** (title, author, subjects, genre, audience, year, ISBN, call number) are the library's
  bibliographic data, published openly through Z39.50 under the City of Toronto Open Government Licence. Using them
  to rank and to link is the intended use.
- **The publisher blurb** is copyrighted marketing copy. Not stored, not shown, not in fixtures.
- **Covers** (Syndetics) are licensed. Not stored, not shown.
- **NoveList** is licensed to the library. Not fetched, not copied, not cached. A link to the record page is fine.

## A person's own shelf page (measured 2026-11-03, not used yet)

What a signed-in "Completed" shelf page carries when the person saves it from their browser. For the later import
(D20, D23); nothing in the first release reads it.

- `entities.shelves.<userId>` maps a shelf item id to `{id, metadataId, shelf, privateItem, dateAdded, authors,
  title, rating}`.
- `shelf` is `for_later`, `in_progress` or `completed`.
- `rating` is **out of 10**: stars times two (4 stars is `8`). `0` means not rated.
- `metadataId` is the record id, and the page's `entities.bibs` carries that record's `briefInfo`: `groupKey`,
  subject headings, call number, the lot. So a shelf brought in this way gives **facets for the person's own books**,
  even ones outside the slice.
- 25 items a page. A long shelf is several saved pages.
- **The same file also holds the person's card barcode, name, email, a session id and an auth token.** A reader must
  take `entities.shelves` and the matching `briefInfo` (without `description`, `jacket` and `rating`) and nothing
  else, never keep the file, and tell the person to delete it.
- A signed-in search page carries no shelf state for its results.

## Fallback sources, for books the library does not hold

Measured 2026-11-03. Not used in the first release; recorded so nobody re-measures.

- **Open Library** `openlibrary.org/search.json?q=<words>`: CORS `*`, fast; title, author, first year, subjects,
  edition count. Its subjects are a different vocabulary, so they would need their own mapping. `/works/<id>.json`
  timed out repeatedly.
- **Wikipedia** REST summary: CORS `*`, CC BY-SA. A title-plus-author search returned the author's page about a quarter
  of the time, and the search endpoint returned 429 after about eight requests.
- **Google Books**: 429 on the first unauthenticated call; 1,000 a day with a key.

## Re-checking

```sh
python3 research/probes/record_fields.py S234C4805630   # the briefInfo fields on one record page
python3 research/probes/search_bibs.py "le guin"        # bibs, works, subjects and descriptions on one search page
python3 research/probes/search_fields.py "le guin"      # which fields are filled on a search page, and heading counts
```

Each makes one request and writes nothing. Leave two minutes between them. If a field named here has gone, correct
this document in place and say so in `docs/RESEARCH.md`.
