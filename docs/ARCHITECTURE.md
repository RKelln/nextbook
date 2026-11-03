# Architecture

Thin on purpose. The app decides and routes; the library owns the record.

## The pieces

```
  shelf.json (the person)      slice.json (the catalogue)        prompt + paste (the model)
        |                              |                                  |
        +--------------+---------------+----------------------------------+
                       |
               nextbook.html  (one file, offline, no tracking)
                       |
                 a link out to tpl.bibliocommons.com/v2/record/<id>
```

## The app

One HTML file. Style in `<style>`, code in `<script>`, data in its own `<script type="application/json">` blocks parsed
inside `try`/`catch`, with a plain sentence shown on failure. It opens from a folder, works with the network off, and
keeps the person's shelf in `localStorage`.

Two shelves, never mixed:

- `reading-life-v1` is the person's own shelf.
- `reading-life-practice-v1` is the practice shelf, pre-filled with the example books, with a banner, a switch and a
  reset button.

Practice mode is prebuilt, not a participant exercise. It exists so a person can try something destructive without
risking their real shelf, and so a workshop can be tested and cleared without touching anyone's data.

## The slice

`slice.json` is the catalogue, cut down to what the app can carry: one entry per work, keyed by `groupKey`, holding the
record id, title, author, year, format, audience, content type, normalised subject facets, and our own one-liner where
we wrote one. **No publisher blurb, no covers.**

A slice is a build artifact with a `fetched` date, and the app shows that date wherever it uses it. It is produced by a
script, committed with the app, and never edited by hand.

Size: about 800 bytes an entry, so 300 works is a quarter of a megabyte and 3,000 is 2.5 MB. Past that it stops being a
file and becomes a small endpoint, and the record shape stays the same.

## The adapter

The only part that knows which library it is talking to. One interface:

```
search(query, page)      -> [brief]
record(recordId)         -> brief
newTitles(page)          -> [brief]
recordUrl(recordId)      -> the page a person borrows from
```

`brief` is the normalised shape above. An adapter is a build-time producer (a script) today; if a host wants live
queries, the same interface becomes a small HTTP endpoint and nothing else changes. `adapters/tpl/` is the first
implementation; another library system means another adapter, not a rewrite.

Events, if a mode uses them, come through the same idea: one adapter, one normalised shape, built ahead.

## The scoring core

No embeddings. At this size they would be unexplainable and slower to reason about than what they replace.

- A **profile** is a weighted count of facets over the shelf: loved is 3, liked 2, finished unrated 1, reading a half,
  not-for-me negative. Author affinity is tracked separately.
- **Similarity** is the weighted overlap between a candidate's facets and the profile, normalised by the candidate's
  facet count so a heavily-catalogued book does not win by having more labels.
- Every contribution is kept, which is what makes the **reason**: the two strongest contributors become the sentence.
- Modes consume the same core differently: rank it, walk it into a sequence, invert it, or apply it to someone else's
  shelf.

## The model seam

Exactly two jobs, both optional, both with the same guard.

1. **Text to facets.** An event description, a headline, or a half-formed wish becomes a handful of facet labels. Output
   is labels only, and the rules take it from there.
2. **Argue between finalists.** Given six ids with their facts and our one-liners, pick two and give one sentence each.

The guard: the model answers with ids that must already exist. The app checks every id against the shortlist, drops what
it does not recognise, and says which ones it dropped. Dates, titles and authors are never taken from the model.

With no model available, the app still works: the six candidates and their rule-built reasons stand on their own. The
argument is an enhancement, not a dependency.

## Files in and out

- `shelf.json` out and back in: the person's list, portable, theirs.
- `picks.json` the six with reasons, so a result can be saved, shared or handed to an agent.
- `path.json` for a journey or a ladder: an ordered list with a reason per step.
- `club.json` for a shared shelf: several members' shelves folded into one, which is what a book club season needs.

One shape, several verbs. A mode that cannot express itself as one of these is probably two modes.

## Hosted copy

The same file, served from a static host, with no accounts and no server storage. The only runtime network call
permitted is an optional Wikipedia or Open Library lookup for a title that is not in the slice, cached in the browser,
and the app says so before it happens. The catalogue is never fetched at runtime, because it cannot be: there is no CORS
header.

## What the thin build deliberately lacks

Covers, blurbs, availability counts, and live search. Each is on the library's page, one click away, and each is a
copyright or a scraping problem we do not need to have.
