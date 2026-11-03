# Design

Written 2026-11-03, from a working session with Ryan. This is the settled shape; the open questions are at the bottom.

## The problem

A library catalogue is a good tool for finding a book you already know about. It is a poor tool for the question people
actually have: **I have read these things and liked them, what should I read next, this week, given my life?**

The library already runs two answer machines for that question, and neither is ours. The catalogue gives a search box
and a ranked list with no reasons. The record page carries a licensed read-alike service (NoveList), which knows books
but not you.

What neither has is the person's own shelf: what they finished, what they abandoned, what they rated, what they have
time for.

## Three jobs, in order

**Narrow.** Arithmetic over the person's shelf against the library's own subject terms. Cheap, offline, explainable.
No model, no vendor, no network at runtime.

**Argue.** A model takes the six candidates and makes a case for two, one sentence each. This is where a model earns
its place: not choosing from a catalogue, but choosing between finalists, with a reason a person can accept or reject.

**Route.** One click to the library record page: availability, formats, the hold button, the library's own suggestions.

The order matters. A model over the whole catalogue is unaffordable and unauditable; a model over six ids is neither.

## What the app produces

Every mode ends in the same artifact, which is why ten people can build ten different things and still compare notes:

- **Six candidates**, each with `id`, title, author, year, a one-line reason, and a link to the record page.
- **Two of them argued for** by the model, with a sentence each.
- **One decision**, made by the person, and one click out to the library.

The mode changes the middle, not the ends.

## The mode menu

A mode is a pair: what goes in, what shape comes out. Nothing is ranked; participants choose, and the instruction to
them is that any of these is a full answer. Each has a buildable brief in `docs/modes/`, with a rule, checks and what
usually goes wrong.

- **Off the shelf, on purpose:** survey (one from each part of the library the shelf never visits), blind date (three
  places the shelf never goes, no scores: the rule is the product).
- **An ordered path:** journey (from a book they loved to one they have been avoiding), ladder (beginner to deep on one
  subject), club season (six weeks for a group).
- **Deliberate disagreement:** challenge (same subject, the other side: fiction against non-fiction, or another mood).
- **A constraint a vendor cannot take:** time-box (something to listen to on the commute).
- **Someone else's shelf:** swap (two exported shelves, what each should read from the other's).
- **An outside text as the seed:** event hook, news diet. Words become subjects **from the list**, by hand or through
  the model box, and the rules take it from there.

The foundation ships one example mode that is **not** on the menu (`more-by`, other books by authors you rated well),
so the contract has a worked example without handing anyone their answer. Survey, journey and challenge are built as
reference modes for the projector and kept out of the starter.

## Reasons, not scores

Every candidate carries a sentence built from the facets that produced it: "matches quiet and books about identity", or
"you rated Ursula K. Le Guin well already". The sentence names the evidence. That is both the decision support and the
lesson: a person can see how the machine got there and disagree with the middle of it.

A cosine number cannot be checked, shown to a librarian, or argued with. A sentence can.

## The NoveList beat

The record page carries "You may also like", provided by NoveList. We never read it with code and never copy it. Twice
in the design it appears:

- As a **link**: "the library's own suggestions" opens that page. Legitimate, needs no CORS, and makes the app a good
  citizen of the catalogue.
- As a **three-minute comparison** in a workshop or a demo: the vendor's suggestion and ours for the same book, side by
  side, and the room says which they would actually read and why.

That comparison is the clearest statement of what this tool is for, and of what a licensed recommender structurally
cannot do.

## What a licensed recommender cannot do

It does not know your shelf, your ratings, or what you abandoned. It cannot take a constraint (this week's commute, six
weeks for a club, a branch you can reach). It cannot be sequenced by you or inverted on purpose. It is not yours and it
does not travel.

That list is the product.

## What we refuse

- Scraping, caching or republishing NoveList.
- A catalogue mirror. Query and cache what was looked at; never crawl to own a copy.
- Publisher blurbs in our pages. In the thin build the blurb is only ever seen on the library's page.
- Embeddings over licensed text: they do not launder copyright, they may inherit CC BY-SA obligations, and nobody can
  audit a vector.
- Accounts, telemetry, or a server that holds a shelf.
- A model anywhere except between six finalists.

## How we would know it worked

Clicks out to record pages (no tracking beyond a page counter on our own site, if any), and a self-report: the take-home
card asks one question, "did you borrow something because of this?". A click is not a borrow and an app with no accounts
cannot see one, so say that before anyone else does.

The second measure is comprehension: can the person say why the app suggested what it did? If they can, the reasons are
working, and that is the residency's actual product.

## Open questions

1. Product name and domain. `nextbook` is the working repo name only. Anything implying the library endorses it needs
   the library's agreement first, which is why a TPL-branded subdomain is not assumed here.
2. Whether the hosted copy fetches anything at runtime. **Proposed (2026-11-03):** not in the first release. An optional
   Open Library lookup for a typed book is a P1 task, off by default.
3. A curated pack or an empty start. **Proposed (2026-11-03):** both, separated. The catalogue slice is the list; the
   W13 pack's 30 books become our own words (`data/tags.json`: mood, pace, a note) and the practice shelf. The own shelf
   starts empty.
4. Which modes ship first. **Proposed (2026-11-03):** none on the menu; the example `more-by` ships, and survey, journey
   and challenge are reference builds, because between them they exercise coverage, sequencing and inversion.
