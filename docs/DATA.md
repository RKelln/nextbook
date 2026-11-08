# The catalogue data

Measured against the live Toronto Public Library catalogue with `curl` and the probes in `research/probes/`. First
measured 2026-11-03; re-checked the same day (record size, search-page fields, `robots.txt`). Re-check before
trusting: the markup and the payload keys change without notice.

## The rules of the house: `robots.txt`

`https://tpl.bibliocommons.com/robots.txt`, read 2026-11-03, for `User-agent: *`:

- **`Crawl-delay: 120`.** One request every two minutes. This decides how the slice is built: a record page gives
  one work per request, a search page gives about twenty, so **the adapter reads search pages** (for a person's find,
  and for a batch slice if one is ever built, T8.11), not record
  pages.
- `Disallow` includes `/item/read_alike_list/` (the NoveList panel), `/v2/availability/`, `/item/full_record/`,
  `/item/syndetics_reviews` and `/bib/match/`. The adapter fetches only `/v2/search` and `/v2/browse/titles/new`, and
  refuses any other path.
- `Allow: /*` otherwise.

The adapter reads `robots.txt` at the start of every run and stops if `/v2/search` is disallowed or the delay has gone
up. The events feed lives on another host, `gateway.bibliocommons.com`, whose `robots.txt` answered **404** on
2026-11-03 (`RESEARCH.md`): it states no rules, so the feed is read at batch pace through the same fetcher and only
the one events path is ever requested. That 404 is checked by hand when the snapshot is rebuilt, not on every run —
the adapter does not ask that host for its rules — so `RESEARCH.md` carries the date it was last checked.

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
page for "le guin" carried **63 bibs, 20 works** (`groupKey`), 42 with subject headings, 47 with a call
number, 46 with `genreForm`. Those 20 `groupKey`s were 12 distinct titles: the catalogue files some editions under a
second author spelling (`Guin, Ursula K. Le` beside `Le Guin, Ursula K., 1929-2018`), so one book can land in two
groups (`RESEARCH.md`). **This is the adapter's source.**

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

The same rules turn a found book's record into facets (`tools/find.py`). For a batch slice (T8.11), the report
`build_slice.py` prints is the acceptance test: works, facets kept, singletons dropped, the
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

- **Catalogue records** (title, author, subjects, genre, audience, year, ISBN, call number) are bibliographic facts.
  Reading them to rank books for one person and link to the library is the use the catalogue is for. **We have not
  verified a licence for republishing them in bulk.** TPL's Z39.50 server is a protocol, not a dataset on the City's
  open data portal, so the City's Open Government Licence cannot be assumed to cover it, and the repo's MIT licence
  does not grant data it does not own. That is why there is no batch slice in the repo for now (D28): the pack is our
  own, and found records live only in the person's own copy (`data/found.json` is gitignored). Decide before
  committing any catalogue data (T8.11).
- **The publisher blurb** is copyrighted marketing copy. Not stored, not shown, not in fixtures.
- **A person's found books** (`data/found.json`) carry the words they searched for. They stay in their copy: the
  file is gitignored and the starter ships without one.
- **Event text** is the library's own description of its own event, kept short (`summary`, at most 300 characters)
  beside a link to the event page, with the date the list was made. The latest list is held in the person's browser
  only, trimmed to that shape, and never written into the repo.
- **Covers** (Syndetics) are licensed. Not stored, not shown.
- **NoveList** is licensed to the library. Not fetched, not copied, not cached. A link to the record page is fine.

## The library account's own pages (measured 2026-11-04)

The site header's account menu, read from a cached public search page (`docs/RESEARCH.md`). Each is a page a person
opens in their own browser, signed in as themselves; the app links to them and never requests them.

| Page | Path on `tpl.bibliocommons.com` |
|---|---|
| Sign in | `/user/login`, or `/user/login?destination=<path>` to land on a page after signing in: `?destination=%2Fholds` and `?destination=%2Fv2%2Frecord%2F<recordId>` were tried by hand (2026-11-04) and land on the holds page and the record page; signed in already, there is no form, it goes straight there |
| Holds | `/holds` |
| Checked out | `/checkedout` |
| For Later, In Progress, Completed shelves | `/collection/show/my/library/for_later`, `in_progress`, `completed` |
| Pickup branch | `/account/pickup_location` |
| Account | `/account` |

Placing a hold starts from the record page's own button. Its path, `/holds/select_hold/`, is disallowed to robots, and
the app neither links into it nor builds one.

## A person's own On Hold page (measured 2026-11-04)

One real saved page (`/holds`, signed in, one hold), read for shape only with `research/probes/saved_page_shape.py`
and two scripts that printed booleans and codes, kept outside the repo, never committed. The made-up
`tests/fixtures/tpl/holds-page.html` has the same shape.

| Where | What | Read by the app |
|---|---|---|
| `entities.holds[<holdsId>]` | `metadataId` (the record id, `S…C…`), `holdPlacedDate`, `expiryDate`, `status` (`NOT_YET_AVAILABLE` seen), `holdsPosition`, `pickupLocation {code, name}`, `itemId`, `holdsId`, `materialType`, `actions`, `bibTitle` | `metadataId` and `holdPlacedDate` only |
| `entities.bibs[<metadataId>].briefInfo` | the book, as on a shelf page (`groupKey`, title, authors, …) | yes, as for a shelf |
| `borrowing.holds.pagination` | `{count, page, limit: 25, pages}`; `{}` on a shelf page and a search page | the numbers |
| `borrowing.holds.items`, `.summary` | the holds ids on this page; `totalOperative`, a count per status, quotas | no |
| `entities.shelves` | the shelf each held book is on (the held book was on For Later), **not** a shelf listing | no |
| page text | "1 to 1 of 1 items", the holds count, in the same words as a shelf's count line (D39); with no holds, "You have no items on hold" and no count line | yes, and it wins over the state: never as a shelf line, which would call For Later whole |
| `users`, `accounts`, `auth` | name, email, barcode, session, token, as on every signed-in page | never |

Cancelled and expired holds are not in the list (`borrowing.inactiveHolds`, separate pages).

**The state can be stale.** A second save of the same page, made after its one hold was cancelled on the page without
a reload, showed "You have no items on hold" and no count line, while the state still carried the hold with
`pagination.count` 1 (2026-11-04). The state is the page as it was opened; the words are what it showed when saved.
A shelf page is presumably the same (a book moved on the page, then saved), which has not been tested.

Not yet seen: a page of more than 25 holds, and any status but `NOT_YET_AVAILABLE`.

## A person's own shelf page (measured 2026-11-03, re-checked on two saved pages 2026-11-04)

What a signed-in "Completed" shelf page carries when the person saves it from their browser. Read by
`app/core/library-shelf.js` (T8.8, D20/D23); the reader takes `entities.shelves` and the matching `briefInfo` and
nothing else.

- `entities.shelves.<userId>` maps a shelf item id to `{id, metadataId, shelf, privateItem, dateAdded, authors,
  title, rating}`.
- `shelf` is `for_later`, `in_progress` or `completed`.
- `rating` is **out of 10**: stars times two (4 stars is `8`). `0` means not rated.
- `metadataId` is the record id, and the page's `entities.bibs` carries that record's `briefInfo`: `groupKey`,
  subject headings, call number, the lot. So a shelf brought in this way gives **facets for the person's own books**,
  even ones outside the slice.
- **No totals and no page numbers.** A saved page carries `entities.shelves.<userId>` and `entities.bibs` and no
  `shelfSearch` and no `meta` (measured 2026-11-04), so the file never says how many books the shelf holds or which
  page of it this is. "Is this the whole shelf?" cannot be answered from the file: the reader says the shelf is
  **unknown** rather than claiming it was partly saved, and nothing is marked gone from it. A page that does state a
  count is short only if the count is bigger than the items read.
- 25 items a page. A long shelf is several saved pages, and each is saved by hand.
- **The same file also holds the person's card barcode, name, email, a session id and an auth token.** A reader must
  take `entities.shelves` and the matching `briefInfo` (without `description`, `jacket` and `rating`) and nothing
  else, never keep the file, and tell the person to delete it.
- A signed-in **search** page carries the same `entities` with its results in `entities.bibs` and nothing under
  `shelves`. It is refused by name rather than read as an empty shelf (seen 2026-11-04).

## The latest events list (measured 2026-11-08)

The events service is a Togather instance (`library.events` in the slice names it). Measured against
`https://staging.toronto.togather.foundation/api/v1/events`: it answers `access-control-allow-origin: *`, so a browser on
any origin, `file://` included, can read it. Parameters used: `startDate`, `endDate` (dates), `limit` (200 at most), `after`
(the previous answer's `next_cursor`), `context=document`, `organizerId`. The answer is `{items, next_cursor, timeZone}`.
An item has `@id` (`https://<host>/events/<ULID>`), `name`, `description`, `keywords[]`, `startDate`, `endDate` (with the
library's offset), and `location`: a `Place` with `name`, `address{streetAddress, addressLocality}` and `geo{latitude,
longitude}`, or a `VirtualLocation` whose `url` is the library's own page for the event. **The list has no source
link**; the detail does, but a browser cannot afford one request per event, so `url` is the service's own page (`@id`)
for an in-person event and the `VirtualLocation`'s `url` for an online one.

The library appears under **three organiser ids** (duplicates that may be merged later, so one failing or empty must not
sink the rest, and a repeat id is kept once). For 21 days from 2026-11-08 they gave 2400, 37 and 67 events: **2576 events
after removing repeats, 97 distinct place names**, about 5 seconds in all (12 pages for the large one), and 37 of them
online. Place names are mostly the plain branch name; the feed's old habits are handled anyway: a name that arrives as
"MalvernEvent location: Malvern" keeps the part after the label, and a branch that is closed is written "<name> - Closed".
Text can still be HTML-encoded and is decoded and shown as text. Descriptions can begin "More info: <address> ..."; that
pointer is dropped from `summary`, and nothing else is cut from the front.

**Matching places to branches** (`data/branches.json`, 92 branches with code, name, street and position): the place and the
branch name are lowercased, punctuation becomes a space, a trailing " - Closed" and a trailing "Library" are dropped, and
the two must be equal (or equal to a listed `aliases` entry). Nothing is matched by similarity. Of the 2539 in-person
events measured, **2469 (97.2%) matched**. The 70 that did not are at three places: Cedarbrae (24, and 25 more written
"Cedarbrae - Closed"), Amesbury Park (19) and Sanderson - Closed (2); none is in the branch list (the feed the list was
made from leaves closed branches out), so those events are kept and say they have no travel time. 93 of the 97 place names
matched.

## A person's travel times (`data/distance-map.json`)

Made by `tools/distance-map.py` for one start point, rounded to 3 decimals (about 100 m) before any request. Never
committed, never packed into a build, never in a shelf export. `{origin, label, built, note, transit_slots, routers,
branches: [{code, name, street, lat, lon, aliases?, straight_km, walk_s, bike_s, car_s, transit_weekday_s,
transit_weekday_route, transit_weekend_s, transit_weekend_route}]}`. **Any time can be null, and null is never 0.** Reading
rules: `transit` is the lesser of transit and walking; `any` is the least of walk, bike and transit, never the car; the
weekend transit time is used for a Saturday or Sunday event, the weekday one otherwise. Walk, bike and car are free-flow
times with no parking. Transit is one query at each of two times (a weekday at 18:00 and a Saturday at 13:00, from
Transitous, `api.transitous.org`, which knows about three weeks ahead), so it is a rough guide and goes stale after about
three weeks. The routers (checked 2026-10-23): `router.project-osrm.org` ignores its profile and answers with driving time,
so it is used for the car only; `routing.openstreetmap.de/routed-foot` and `/routed-bike` give walking and cycling. The page
file `app/data/distance.js` is the same without `origin`.

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
