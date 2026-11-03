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
