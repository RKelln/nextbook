# Real-format import samples

`goodreads.csv` and `storygraph.csv` are hand-written small cases, one per site, six rows each:
they say what a reader must decide, not what a site writes. The two `-real.csv` files are the
other half: a published, real export, cut down and checked so the reader is measured against the
text a site actually produces.

Nothing here is anyone's reading history taken from a blog or a profile, and no file was fetched
through a sign-in. Both came from a project's test suite, where an export is already published as
test data, and both repositories state a licence.

## goodreads-real.csv

- Source: https://github.com/bayang/jelu/blob/main/src/test/resources/csv-import/goodreads1.csv
- Project: jelu (a book cataloguing app), licence MIT (https://github.com/bayang/jelu/blob/main/LICENSE)
- Commit: `2aba1840c9d8`, fetched 2026-11-04
- Header: 31 columns, the current Goodreads export, `Book Id` through `BCID`
- Rows: 10 books, all ten kept. No rows were removed: the file was already under the twelve-row
  cap.
- What was changed: one cell. The last column (`BCID`) on *La vie des arbres* held a
  BookCrossing label id, which can lead to a stranger's public journal entry, so it was emptied.
  Nothing else was touched: no reader's name, review or note text, profile link or email is in
  the file to begin with. The custom shelf `test-aad` in the `Bookshelves` column is a development
  shelf name in the source project, and it is kept because a comma inside a quoted shelf list is
  one of the things this sample is here to exercise.

What it brings that the hand-written file cannot: the full 31-column header, `="..."` wrappers
on both ISBN columns, an empty ISBN written as `=""""`, an ISBN-10 ending in `X`, a `Bookshelves`
cell that is several shelves separated by commas inside quotes, `Date Read` and `Number of Pages`
filled, non-ASCII authors and titles, and one row on a custom exclusive shelf (`waiting`) that
this app has no state for.

## storygraph-real.csv

- Source: https://github.com/nperez0111/bookhive/blob/main/src/workers/import/import-simulation.test.ts
  (the `STORYGRAPH_CSV_12_ROWS` constant)
- Project: bookhive, licence MIT (https://github.com/nperez0111/bookhive/blob/main/LICENSE)
- Commit: `475c10b9d435`, fetched 2026-11-04
- Header: 23 columns, the StoryGraph export, `Title` through `Owned?`
- Rows: 12 books, all twelve kept. The constant was already twelve rows, so nothing was cut.
- What was changed: the constant lives inside a TypeScript template literal, where an apostrophe
  is escaped (`Assassin\'s Apprentice`); in the CSV it is the plain `'`. No cell value was
  otherwise touched. There is no review text in the file and nothing that names a person.

What it brings: the 23-column header, `Dates Read` as a range (`2024/12/01-2024/12/12`),
`Last Date Read`, contributors in their own column, `ISBN/UID` holding an ISBN-10
(`042504355X`), `to-read` and `read` rows, empty `Star Rating` cells (this export has no ratings
at all), and `Owned?` answered for every row.

## Samples used for a check but not kept here

- `bookwyrm-social/bookwyrm`, `bookwyrm/tests/data/goodreads.csv` and `storygraph.csv` — real
  format, but the repository's licence is AGPL-3.0/NOASSERTION, so no copy is kept. Both were
  run through the reader while this task was done.
- `FuzzyGrim/Yamtrack`, `src/integrations/tests/mock_data/import_goodreads.csv` — real format,
  AGPL-3.0, so no copy is kept; the reader was run against it.
- `Project-Books/book-project`, `goodreadsBooksImportSample.csv` — 560 rows with personal review
  text. It reads like one person's actual library, so it was not fetched.
- `bayang/jelu`, `goodreads_library_export-2022.csv` and `goodreads_library_export_one_line_modified_review.csv`
  — MIT and usable, but the first repeats the same shelf words as the file kept above, and the
  second is a modified (not real) export. Both were run through the reader while checking.
