# Decisions

A decision log, not a plan. Each entry says what was decided, by whom, and what it forecloses. When a decision changes,
add a new entry with the date; do not rewrite the old one.

## D1. Thin router, not a catalogue (2026-11-03, Ryan)

The app decides and routes. It does not hold availability, formats, blurbs or covers; the library's record page does.
Ryan: "let's start thin".

Forecloses: a self-contained reading record with covers and descriptions. Makes the copyright question mostly vanish,
and makes the app fast and small.

## D2. No NoveList ingestion (2026-11-03, Ryan and measured)

The record page's read-alikes are licensed to the library, served as HTML with no CORS header. We link to them and
compare against them in a demo; we never read them with code.

Forecloses: "recommendations" as a feature. That is the library's product; ours is the decision layer around it.

## D3. The library's catalogue record is the enrichment (2026-11-03, measured)

`briefInfo` carries subject headings, genre form, audience, content type, year and series. That is a better facet set
than hand-tagging and it comes from the institution. Wikipedia and Open Library are fallbacks for books the library does
not hold, and Google Books is optional with a key.

Forecloses: an enrichment pipeline of our own making. Correction to an earlier position in the same session, which had
build-time Wikipedia enrichment as the primary route; the measurement made that redundant for TPL holdings.

## D4. Enrichment is build time for the corpus, runtime for one title (2026-11-03)

A slice is fetched, normalised and committed with a date. A single title outside the slice may be looked up at runtime,
cached in the browser, off by default.

Forecloses: live catalogue search in the app. Also removes the rate-limit problem from the visitor's path.

## D5. No embeddings (2026-11-03, argued)

Vectors do not launder copyright, may inherit CC BY-SA obligations from Wikipedia-derived text, and cannot be audited or
argued with by a reader or a librarian. At the size of a slice, facet overlap plus a title match is better and
explainable.

Revisit only if a slice passes tens of thousands of works and retrieval quality is demonstrably the constraint.

## D6. Reasons are part of the artifact (2026-11-03)

Every candidate carries a sentence naming the evidence that produced it. A score with no sentence is a bug.

Forecloses: a "similar books" feature with no explanation, and any mode whose output cannot be justified in words.

## D7. One output contract for every mode (2026-11-03)

Six candidates with reasons, two argued for by a model, one link out. The mode changes how the six are chosen, not what
comes out.

Forecloses: a menu of modes that produce incomparable artifacts, which is what makes an unranked choice survive a room.

## D8. The mode menu is unranked and randomly ordered (2026-11-03, Ryan)

Participants choose what to build, or bring their own idea. Nothing on the menu reads as the intended answer.

Forecloses: a single "correct" build for the room, and means every mode offered needs its own working demo.

## D9. Practice mode is prebuilt, not a participant exercise (2026-11-03, Ryan)

"The sandbox is boring to participants." Two shelves, a banner, a switch, a reset, shipped in the starter.

Forecloses: the sandbox as a teaching feature. It becomes the test fixture, and the documented way to clear test data.

## D10. The repo is library-generic, with a TPL adapter (2026-11-03, Ryan)

"Modular to allow for any library open backend." The catalogue adapter is the only thing a different system replaces.

Forecloses: hard-coding TPL URLs into the app, and makes the workshop's kit a consumer of this repo rather than the
repo's reason to exist.

## D11. Name and domain are open (2026-11-03)

`nextbook` is a working repo name. Anything suggesting the library endorses the app needs the library's agreement first,
so a subdomain on the residency's domain is not assumed.

Forecloses: shipping a name that implies a partnership before there is one.

## D12. The slice is built from search pages, at the house's pace (2026-11-03, measured)

`robots.txt` asks for `Crawl-delay: 120`. A record page gives one work per request; a search page gives about twenty
and carries the same `briefInfo`, call numbers included. The adapter fetches only `/v2/search` (and at most a page or two
of new titles), honours the delay, caches every page, and never fetches record pages.

Forecloses: per-record enrichment at build time, and "20 pages of new titles" as the main source (unread, often on
order). Supersedes the source list in the first `BUILD.md`.

## D13. Source is a folder of classic scripts; one file is a build output (2026-11-03, proposed by Claude, accepted by Ryan)

The first `AGENTS.md` said "one HTML file, no build step". For a foundation that participants extend, one large file is
the most fragile thing a beginner's agent can edit, and the residency starter is already 119 KB. Search Desk's answer
works: one file per feature behind a contract, classic `<script src>` so the folder opens from `file://`, and a
standard-library `tools/build.py` that packs one file for carrying home and hosting. Nothing needs the build to run.

Forecloses: editing the single file by hand. The take-home is still one file, made by the build.

## D14. A mode chooses; the shell draws and checks (2026-11-03, proposed by Claude, accepted by Ryan)

A mode returns `{picks: [{id, why}], note}` and draws nothing. The shell renders every result the same way, builds the
links, and enforces rules 5 and 6 (ids exist, every pick has a reason, an empty result says why) for every mode rather
than trusting each one.

Forecloses: per-mode screens in the first release. A custom view is a new `shape` added to the shell, not drawing
improvised in a mode, the same rule as Search Desk's "new slots are added to core".

Ryan, accepting: the `why` and the `note` are what let one contract fit very different modes. Taken from Search Desk
as well, because they were tested there: missing is fine (a mode that fails to load shows a card and nothing else
breaks), a repeat registration replaces with a warning, the banned-word scan over the mode's functions, the
`check(id, (t, mode))` API with a runner for Node and for `osascript`, the in-browser self-test, live reload with
`.dev-go`, the `new-mode` and `check` commands, and the rules for small models.

## D15. The catalogue's subjects plus our own words, kept apart (2026-11-03, proposed by Claude, accepted by Ryan)

Facets come from the catalogue (topics, BISAC, genre, call-number sections, series). What the catalogue does not carry
(mood, pace, a one-line note) lives in `data/tags.json`, keyed by `groupKey`, hand-written, seeded from the W13 pack.
Modes that need mood or pace say how many untagged works they skipped.

Forecloses: inventing mood or length for works nobody tagged.

## D16. The example mode is not on the menu (2026-11-03, proposed by Claude, accepted by Ryan)

The starter ships `more-by` (more by authors you rated well) as the contract's worked example, and no menu mode. Survey,
journey and challenge are reference builds in `reference/modes/`, packed into the demo file only. Same reasoning as Search
Desk's example feature and the residency kit keeping the demo out of the seed set: an agent that can see the finished
mode copies it.

Forecloses: shipping a menu mode in the starter.

## D17. Links come from templates in the slice (2026-11-03)

A work links to `library.recordUrl` with its id; a typed book links to `library.searchUrl` with its title and author.
Both templates live in `slice.json`, written by the adapter, so the app never contains a library's hostname (D10).

## D18. Saturday Nov 7 is the target, with a fallback slice (2026-11-03, Ryan)

"We want this for Nov 7." Most of the foundation is a port of Search Desk, which was built and tested in four days;
the library layers are the new part. The safety net is a slice built from the W13 pack (30 books, the pack's own facets,
search links instead of record links), made first so every lane has data on day one. If the real slice misses its
numbers by Wed 18:00 the fallback ships, and if the starter misses gate 2 on Thu 18:00 Saturday runs on the residency
starter that already exists.

Forecloses: nothing permanent. The real slice replaces the fallback whenever it lands.

## D19. The menu lives in the docs, not in the app (2026-11-03, Ryan)

The mode menu is `docs/modes/`, for people and the agents in the room. The app lists only modes that are built
(`app/modes/list.js`). Search Desk showed planned features as stubs inside the app; here that would put the menu on
screen with one item marked as the answer, which D8 forbids.

Forecloses: "not built yet" cards in the app.

## D20. The library's own shelves: line up now, import once later, never sync (2026-11-03, Ryan and Claude)

BiblioCommons already keeps a signed-in person's shelves (For Later, In Progress, Completed) and 1 to 5 star ratings,
and other library systems have the same. The library's shelf is the tracker; this app is the decision layer beside it,
and does not compete with it (the W13 thesis since 2026-09-01).

Decided now, because it costs nothing and avoids a migration: our states and ratings map one to one onto theirs
(`ARCHITECTURE.md`, "Lining up with the library's own shelves"), entries keep the library's `groupKey` and record id,
and imported entries can carry `from` and `stars`.

Later, and only this way: **import once, from a file the person saved themselves**, read in their browser with the
network off. Never ask for a library card number or password, never sign in on anyone's behalf, never write back to
the library's shelves (the record page's own buttons do that, one click away), and never two-way sync. A patron-data
API would be a separate conversation with the library, and nothing public says it is coming.

Not for Nov 7. Measured nothing yet: a public search page's JSON carries empty `shelves`, `borrowingHistory` and
`checkouts` entities, which suggests a signed-in page carries the person's own; T8.7 checks.

Forecloses: account linking, credential handling, and any feature that needs the library's servers to know the app
exists.

## D21. No fallback to the old starter (2026-11-03, Ryan)

"I don't think we want a fallback demo." Replaces the last clause of D18: if a gate is missed, the build cuts from the
list in `BUILD.md` and carries on; Saturday does not switch back to the residency starter. The fallback slice from the
W13 pack stays, as data every lane needs on day one.

## D22. Repo and domain (2026-11-03, Ryan)

`github.com/RKelln/nextbook`, published at `nextbook.ryankelln.com` on GitHub Pages, as Search Desk is at
`searchdesk.ryankelln.com`. A personal subdomain implies no partnership with the library, so it answers the domain half
of D11 without the library's agreement. The product name is still open.
