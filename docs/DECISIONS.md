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

Forecloses: a single "correct" build for a workshop, and means every mode offered needs its own working demo.

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
the most fragile thing a beginner's agent can edit, and an earlier starter was already 119 KB. Search Desk's answer
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
(mood, pace, a one-line note) lives in `data/tags.json`, keyed by `groupKey`, hand-written, seeded from the 30-book pack.
Modes that need mood or pace say how many untagged works they skipped.

Forecloses: inventing mood or length for works nobody tagged.

## D16. The example mode is not on the menu (2026-11-03, proposed by Claude, accepted by Ryan)

The starter ships `more-by` (more by authors you rated well) as the contract's worked example, and no menu mode. Survey,
journey and challenge are reference builds in `reference/modes/`, packed into the demo file only. Same reasoning as Search
Desk's example feature and a kit keeping its demo out of a seed set: an agent that can see the finished
mode copies it.

Forecloses: shipping a menu mode in the starter.

## D17. Links come from templates in the slice (2026-11-03)

A work links to `library.recordUrl` with its id; a typed book links to `library.searchUrl` with its title and author.
Both templates live in `slice.json`, written by the adapter, so the app never contains a library's hostname (D10).

## D18. A hard date, and a fallback slice (2026-11-03, Ryan)

"We want this for the first run, and there is a date." Most of the foundation is a port of Search Desk, which was built and tested in four days;
the library layers are the new part. The safety net is a slice built from the 30-book pack (the pack's own facets,
search links instead of record links), made first so every lane has data on day one. If the real slice misses its
numbers by the midweek gate the fallback ships, and if the starter misses the second gate the first run uses the
earlier starter that already exists.

The dates belong to the workshop, not to this repo: the library's own event list is where they live. What this entry
records is the decision — make the fallback slice first, so a hard date can never leave the app without data.

Forecloses: nothing permanent. The real slice replaces the fallback whenever it lands.

## D19. The menu lives in the docs, not in the app (2026-11-03, Ryan)

The mode menu is `docs/modes/`, for people and their agents. The app lists only modes that are built
(`app/modes/list.js`). Search Desk showed planned features as stubs inside the app; here that would put the menu on
screen with one item marked as the answer, which D8 forbids.

Forecloses: "not built yet" cards in the app.

## D20. The library's own shelves: line up now, import once later, never sync (2026-11-03, Ryan and Claude)

BiblioCommons already keeps a signed-in person's shelves (For Later, In Progress, Completed) and 1 to 5 star ratings,
and other library systems have the same. The library's shelf is the tracker; this app is the decision layer beside it,
and does not compete with it (the project's thesis since 2026-09-01).

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
list in `BUILD.md` and carries on; the build does not switch back to an earlier starter. The fallback slice from the
30-book pack stays, as data every lane needs on day one.

## D22. Repo and domain (2026-11-03, Ryan)

`github.com/RKelln/nextbook`, published at `nextbook.ryankelln.com` on GitHub Pages, as Search Desk is at
`searchdesk.ryankelln.com`. A personal subdomain implies no partnership with the library, so it answers the domain half
of D11 without the library's agreement. The product name is still open.

## D23. A saved shelf page is the import route (2026-11-03, measured)

T8.7 answered D20's open question: a signed-in shelf page is rendered with the person's items in its JSON, each with the
record id, shelf, date added and a rating out of 10, and the page carries each record's full catalogue `briefInfo`. So
"save your shelf page, choose the file" can bring in a reading life with real subjects attached, with no account
access, no network and no help from the library's servers.

The same file holds the card barcode, name, email and a live session token, so the reader is written to take only the
shelf and the records, never to keep the file, and to tell the person to delete it. Still not for Nov 7 (T8.8).

## D24. The adapter is the platform, the library is a setting (2026-11-03, Ryan)

The catalogue pages, the record payload, the robots rules and the signed-in shelf page are BiblioCommons', not TPL's,
and BiblioCommons runs many other public libraries' catalogues. So the adapter is `adapters/bibliocommons/`, and TPL is
`adapters/bibliocommons/libraries/tpl.json` (subdomain, name, slice queries). Another BiblioCommons library is one new
file and a rerun; another platform is another adapter with the same outputs. Sharpens D10.

## D25. One-way sync with a memory, discrepancies fixed at the library (2026-11-03, Ryan)

"A smart one way sync from library to app, where for things like I've read it we note discrepancies that need the
person to resolve at the library site." Each library-origin entry remembers what the library said last time, so a
re-import can tell "changed there" (follow it), "changed here" (list it to tidy up at the library) and "changed in both"
(ask). Nothing is ever written to the library; the fix is a link to its record page. Spec in `ARCHITECTURE.md`.

Forecloses: automatic background sync (every import is the person's action, with a date and an Undo), and deleting
anything because it is missing from a file that might be incomplete.

## D26. Real requests through the agent in the workshop; Open Library later (2026-11-03, Ryan)

The browser cannot read the catalogue (no CORS), so a context-driven request has to be made by something else. In a
folder copy, that is the person's agent: they ask "find me books about birds" or "find this book", the agent runs
`tools/find.py`, the books land in `data/found.json`, and the page reloads with them. The slice stays as the warm cache
that makes the app work before anyone asks. The hosted copy, with no agent, gets an Open Library "look further" later
(T8.10). A relay server and a bookmarklet were considered and not taken: the first would be a service hitting the
library for everyone and needs the library's agreement; the second is clumsy and fragile.

## D27. Pacing: crawl-delay for the batch, a person's pace for a person's search (2026-11-03, Ryan)

"The 120 crawl delay is for robots making indexes; searches for particular books that happen occasionally are entirely
different, even if it's robots making them." The batch slice build still waits the full `Crawl-delay`, because it is
the one unattended, index-like job here and its slowness costs nothing. An on-demand search a person asked for goes one
request at a time, at least 5 s apart, at most 3 pages per command, cached. Disallowed paths stay refused for both.
Revises the pacing part of D12.

## D28. No batch catalogue slice for now; the pack is the starting list (2026-11-03, Ryan)

"I thought we decided against the slice for now?" The app starts from the 30-book pack, made into the slice's shape
with sections and fiction/non-fiction derived from its genres, so every mode on the menu runs on it. Real catalogue
records arrive only when a person asks their helper to find books (D26), and stay in their own copy. Supersedes the
batch-slice parts of D12 and D18; the batch builder becomes a later task (T8.11), with the open question of whether a
public repo may carry catalogue records in bulk (`DATA.md`).

## D29. The pack's books and notes are kept (2026-11-03, Ryan)

The earlier material is a placeholder, but the pack's 30 books and their hand-written mood, pace and one-line notes
are the only source of words the catalogue does not carry (D15). They seed the starting list, `tags.json` and the
practice shelf. Replacing them later changes data, not code.

## D30. Events are in for Nov 7, last in priority (2026-11-03, Ryan)

"Events can be last but they are basically done" across Search Desk and an earlier events finder.
A dated snapshot for one branch, `ctx.events` for modes, an events screen, and "Books for this event" when event hook
is loaded. The library's own event text is kept as `summary` (short, linked, dated); rule 4 is about publisher blurbs
on book records, and there is no field named `description` anywhere.

## D31. A workshop copy uses the practice shelf only (2026-11-03, Ryan)

A workshop copy shows the practice shelf only and says why in its own words; the own shelf, friends' shelves from real
people and the library import are for home. The welcome copy and the "describe it for one reader" step never invite a
real reading history. The take-home copy's words say the own shelf goes in at home, on a computer the person owns.

## D32. From Ryan's design review (2026-11-03)

Folded in from `docs/HANDOFF.md` (committed as written, then removed once its points were in the docs):

- **Prompts never carry a reason sentence**, because a reason may name a shelf book. They carry the candidates' own
  facts and a facts clause that names no shelf book, and end "Answer with two lines. Do not change any files."
- **Friends' shelves have a home**: a third storage key and "Add a friend's shelf", never merged into the own shelf.
  A seventh standard shelf includes one.
- **The check is a lint, and says so.** It reads code with comments and quoted words left out, matches call-shaped
  tokens, and names the word, the place and what to do instead.
- **`check.sh` is never cut.** Node is not on every library machine, and where it sits on the PATH is untested.
- **The build is continuous**, so the plan is a dependency order with a priority list, not a calendar; the human
  checks run early, on a clean machine, in a fresh standard account.
- **"Up to six"** everywhere the product is described; fewer with a reason is a full answer.
- **Material from before this design is a placeholder.** Port code from it, never requirements.
- **The starter's interface to whatever is built on it is written down** (`BUILD.md`), and that is all it relies on.

## D33. What the build changed in the product (2026-11-03, Hermes, each reviewed)

Decisions taken while building that a reader of the design would not find in it. Each was reversible, low stakes and
clear enough to lead; each had an independent review pass, and each is named in the commit that made it.

- **The model box is closed for `allowShelf` modes.** A mode that may pick books already on the shelf can put a shelf
  book into the finalists prompt, and rule 1 says a prompt never carries a title from the person's shelf. Closing the
  box for that shape keeps the rule absolute without filtering candidates. Kept: D34 leaves this box closed.
- **The practice shelf leaves one part of the library unvisited.** Its only two books in the 300s came out and two
  others went in (same twelve, same four-loved/three-liked spread), so survey's demo shows the widening pick its
  brief asks for instead of six "you have N books from…" fallbacks.
- **Each build replaces only its own output.** `python3 tools/build.py --starter` used to empty `dist/` and delete the
  one file and the demo made a minute earlier. A stray file is now named on the output rather than shipped, and
  `--clean` empties `dist/` for a real reset.
- **The check runner's `--all` and `--dir` mean what they say.** `--all` alone is the manifest, and a missing or
  non-list manifest is a STOP rather than a green run with nothing checked; `--all --dir F` is every mode file in F;
  `--dir` must resolve inside the repo; ids are checked on both paths; the mode file's own source is scanned as well
  as its functions, so `eval` in the call's argument is caught.
- **`data/events.json` is committed as a dated snapshot.** The library's own event text, capped at 300 characters,
  with the feed's host recorded as answering `robots.txt` with 404 (2026-11-03). It goes stale: rebuild before a room.

## D34. The finalists prompt: titles, but never a work on the person's shelf (2026-11-03, Ryan's call)

Ryan asked whether placeholders would cost the chat the titles it needs to curate, and accepted that reading lists stay
private. Both halves are right, and rule 1 draws the line in the same place: **"never a title from the person's shelf"**,
not "never a title".

- A candidate that is *not* on the shelf has a public catalogue title, and the prompt already says it was a candidate.
  It keeps its id, title, author, year and facet labels, because that is what lets a chat curate rather than merely
  restate the facet words.
- A candidate that *is* on the shelf is the person's reading list. It is dropped from the prompt before the prompt is
  built — by work id, `groupKey`, `recordId` and normalised title, so a typed book that never matched the slice (and
  whose title is therefore in the person's own list) is caught too.
- The box says so in words: "The chat sees five of the six. One is already on your shelf, so it stays out of this box."
  Nothing is said when nothing was dropped.
- The `allowShelf` box stays closed (D33): a mixed prompt would tell the chat which candidate is the shelf book.

The "from some words" prompt is unchanged: it carries no titles at all, and maps text to the slice's own subject list.
Placeholders remain the fallback if a later feature has to put a shelf work in front of a model; nothing in this design
does.

## D35. An `event` input kind (2026-11-03, Ryan)

Ryan: "event input kind seems good." Until now the contract had no kind that could carry a library event, so the
events screen's "Books for this event" button could only put the event's title into a mode's `text` box (T3.6, open
question 2).

`CONTRACT.md` section 4 gains `event`: the control is a picker of the snapshot's events (day and title), and `choose`
receives the event object — `{id, title, start, end, branch, virtual, categories, summary, url}` — never a title typed
into a box and never a model's words. The standard shelves give a mode with an `event` input a sensible default (the
first event in the snapshot, or a two-event fixture when there is none). The events screen hands the event itself to
the mode when it has that input, and keeps the title-in-the-text-box path for a mode that does not.

Forecloses nothing: a mode that never lists the input is unaffected, and the event snapshot is still the only source,
so nothing here reaches the network.
## D36. An agent reads and writes the app through two files, not an MCP server (2026-11-03, Ryan's steer)

Search Desk solved this and the answer is worth copying rather than reinventing. It has two halves:

- **Read:** `tools/serve.py --mirror` — the page posts its records to a token-guarded route on localhost about a
  second after any change, and the server writes them to `searchdesk-live.json`, which an agent reads *in part*
  (`read-desk.py --type`, `--id`, `--find`) rather than opening the whole file.
- **Write:** `data/inbox.js` — the agent writes `window.DESK_INBOX = {schema, records}`, records marked `source: "ai"`;
  on load the page merges the inbox as one batch, with Undo, idempotently, and the date rule that decides whether a
  record wins.

**Superseded by D44 below (2026-11-05).** Originally, nextbook took the second half and not the first. **No shelf mirror**: the mirror exists in Search Desk because the
desk *is* the product and the agent has to see it; here the shelf is the person's reading history, and a file of it on
disk is exactly what rule 1 refuses. The person's export is the read path, and they choose it.

**The inbox is in**, as `app/data/inbox.js` (gitignored, like `workshop.js`): `window.NEXTBOOK_INBOX =
{schema: "nextbook/inbox-1", records, source: "ai", updated}`, merged once at load through the store's existing import,
with Undo and a marker in storage so a reload does not apply it twice. It is what lets `find.py --from-shelf` hand the
matched record ids back to the page without the person importing their file again.

**Not an MCP server.** Two files do the job inside rules the repo already keeps: no dependency, no process, no second
route to the shelf, and nothing to configure before a workshop. An MCP surface would be a third way in, and the one
with the largest blast radius, for a capability the files already have.
## D37. An input can be left unset, and every input state gets a standard run (2026-11-03, Ryan's bug)

Ryan found this by using the app as a participant would: a facet dropdown draws an empty "Pick one", `inputsFor()`
treats an empty value as missing, and the contract says `choose` is not called until every input has a value. So every
input was required, and a mode could not offer "any subject" — the mode's own `hasSubject()` branch, written to treat
"no subject" as "no filter", could never run. The most natural second step for a beginner (add one more input) would
have shown nothing until they clicked.

The fix, deliberately kept small:

- An input spec may say `optional: true` and give its empty option its own words (`any: 'Any subject'`). Default stays
  required, so nothing that works today changes meaning.
- On an optional input, an **empty** value reaches `choose` as `null` instead of blocking the call. An **absent** key
  is still missing. The distinction is the point: `undefined` = not asked, `null` = asked and left blank, a value = set.
- The check gains one more standard run, only for modes that have an optional input: that input empty and every other
  input at its default. A mode that crashes on `null` fails its own check, and the failure names the input.

**The general form of this, and where it stops.** The real gap was not optionality; it was that the checks only ever
ran inputs at their defaults, so any input state a mode's author had not pictured was untested. The rule that follows:
**a new input state ships with a standard run, or it is unverified.** That is what makes the next such feature safe
without a form engine.

Rejected: making the contract expressive enough to say "input B is required only when A is set". That is a validation
language, and a beginner would have to learn it before growing a mode. A mode that needs a conditional treats `null`
itself — which is exactly what `hasSubject()` already did, and now can.

Not rejected, and not yet done: a first-timer's *second step* (add one input) belongs in the T7.2 script. Nobody on the
build found this, because every test ran the contract at its defaults.
## D38. Three ways in, on one shelf screen (2026-11-03, led)

The shelf screen now offers three separate bring-it-in blocks: a Goodreads or StoryGraph CSV, the library's own saved
shelf pages, and a shelf file (a backup, or a friend's shelf). Each has its own heading, its own sentence about what it
reads, and its own refusal.

Kept as three labelled blocks rather than tabs or one wizard: each sentence has to be true on its own — a CSV carries
ratings but no record ids, saved pages carry record ids and facets but are several files, a shelf file is neither — and
a beginner can ignore the two they do not want. If it reads as clutter on a screen, collapsing it is copy and layout,
not a rebuild.

The library pages carry one extra sentence the others do not need: the page keeps the books, not the file, so delete the
saved pages afterwards. That is the one path where a file on the person's disk holds more than a book list.
## D39. The shelf's count comes from the page's own words, not from a tick (2026-11-03, Ryan)

The state carries no totals, so the first answer was to keep quiet about completeness. Ryan's answer is better: the
saved page still *says* how many books the shelf holds, in its own header and footer.

Measured on the two saved pages (2026-11-04, text only):

- A **shelf** page carries `1 to 2 of 2 items`, twice — once at the top, once at the bottom.
- A **search** page carries `1 to 20 of 1,744 results`.

So the number is there, the word distinguishes the two page types, and both are worth reading:

- Parse `X to Y of N items` from the page's text (tags and scripts stripped, entities unescaped). `N` is the shelf's
  size, `Y` says whether this page reaches the end, and `X..Y` is the range this page covers.
- Attribute the line to the shelf its items name (a shelf page shows one shelf). If a page carries no such line, or
  the word is not `items`, the shelf stays **unknown** — a French or changed page must not make the app guess.
- A page alone is the shelf only when it starts at the first book **and** reaches the last: `21 to 40 of 40 items`
  reaches the end but has never seen book 1, and one page must never be enough to mark a book gone.
- Complete across saved pages by covering `1..N` with the merged ranges, not by counting page numbers (the file never
  says which page it is). Pages 1 and 3 saved, with 2 missing, is a gap, and nothing is marked gone.

Rejected: a tick asking the person to promise they saved every page. It shifts a fact the file already states onto the
person, and it is the kind of promise someone mis-remembers.

## D40. The rating follows the state; the page is laid out in layers (2026-11-04, Ryan and Claude)

Ryan: the state and rating drop-downs were "kinda meh" and "should be aware of each other". They are now one control.
The state is a radio group drawn as a segmented bar; the rating is four chips that press and unpress, and it asks
the question the state makes: **How was it?** for read and stopped, **So far** for reading (its pressed chip is drawn
dashed, as a guess so far), and nothing for a book to read. This matches the arithmetic already in `score.js`: a
"want" carries no weight whatever its rating, and a reading book's rating counts. A "want" that already has a rating
(an import, an older shelf) still shows it, so no rating that scores is ever out of sight. Pressing the pressed chip
clears the rating, so "No rating" needs no option of its own. Nothing about the stored shelf changed.

The page is responsive: on a phone the nav is a tab bar at the foot of the screen and the ways of choosing scroll
sideways; from 48rem the nav is a sticky bar at the top; from 64rem the shelf and find screens split into a main
column and a side. The shelf's tools fold away in the side column. The status note is a toast that stays until
closed. `nextbook.css` is in cascade layers (reset, tokens, base, layout, components, screens, modes, utilities); the
mode panel carries `data-mode`, so a mode's look is one rule in the `modes` layer. `tools/screens.py` (uv and
Playwright, a dev tool that never ships, ported from Search Desk) takes every screen at every size in both schemes.

Forecloses: rating a book you have not started. Leaves open: how much you want to read a book (`BUILD.md`, Open
questions).

## D41. Changes at the library come back in one round trip (2026-11-04, Ryan and Claude)

Ryan: after a hold or a change to a list at the library, getting it back into the app should be as easy as possible.
The way back stays D23's: the person saves the library's page and the app reads the file. No sign-in, no request, no
sync (D20). What changed is the length of the trip:

- The library block is three steps with the doors in them: open For Later, In Progress or Completed (each through
  the library's sign-in, as T8.12), save the page, choose it or drop it on the box.
- Coming back to the tab after pressing any library link, on the own shelf, says once how to bring a change in and
  opens that block. Nothing is read and nothing is assumed: the app cannot see what happened over there.
- Bringing in again is safe, and says so: the three-way merge keeps the newer answer and asks about a book changed
  in both places (`ARCHITECTURE.md`, the merge table). Each bring-in is still one import the person starts, from a
  file they saved: D20's "import once, never sync" holds for every trip.

Saving a page is a computer's job; the step says so rather than pretend a phone can. Holds cannot come back yet: no
one has measured what a saved holds page carries (`BUILD.md`, Open questions).

## D42. "On hold" is a state (2026-11-04, Ryan)

Ryan: "we should have a foundational hold state for books to track which are currently on hold at your library." The
states are now `want`, `hold`, `reading`, `read` and `stopped`, in that order on the shelf's control.

- **It is a wish.** A book on hold weighs 0, as `want` does, and asks for no rating. It is not evidence of taste.
- **Only the person sets it.** By hand, or with one press: after "Sign in and hold", coming back to the tab asks "Did
  you place a hold on X?" with "Yes, it's on hold". The app cannot see the library, so it asks rather than guesses.
- **The library has no hold shelf.** When the merge compares with the library, `hold` counts as `want` (a held book
  usually sits on For Later). For Later unchanged never undoes a hold; a book the library moved to In Progress or
  Completed takes the library's answer. The CSV readers never produce it.
- **Every mode meets one.** The practice shelf gains a thirteenth book, on hold, so every standard shelf carries a
  hold and a mode that treats "not want" as "read" fails its check.

Holds still do not come in from the library: a saved holds page is unmeasured (`BUILD.md`, Open questions). When it
is, an import could set `hold` and clear it, and this decision says what it would set. (It was measured the same day:
D43.)

## D43. The holds list comes back like a shelf (2026-11-04, Ryan)

Ryan saved his On Hold page (My Borrowing) and asked for the app to read it. Measured for shape only (`DATA.md`, "A
person's own On Hold page"): each hold names its record by `metadataId`, the page carries that book's `briefInfo`, and
`borrowing.holds.pagination` says how many holds there are. So it goes in the same drop box as the shelf pages, as part
of the same one import with one Undo.

- **What it sets.** A held book that is not here is added as `hold`. A `want` becomes `hold`. `reading`, `read` and
  `stopped` stay: the person has moved past it, and a hold for a re-read says nothing new. `hold` stays `hold`.
- **What it takes off.** Only from a whole list (every hold the page counts was read): a `hold` here that the list does
  not have goes back to `want`, and the report names it with "I picked it up" (to Reading). The page cannot say whether
  a hold was picked up, cancelled or ran out, so it asks rather than guesses. A partial list takes nothing off and says
  so (`importPartialHolds`).
- **After the shelves.** The shelf pass runs first, with `hold` seen as `want` (D42), so a book the library moved to
  In Progress takes that answer and is no longer a hold to take off.
- **What it never reads.** Two fields of each hold (`metadataId`, `holdPlacedDate`) and the four numbers of the
  pagination. Pickup branch, queue place, hold and item ids, status, the barcode and the rest are never touched; the
  test fixture carries decoys in all of them. The status is not read because only one value (`NOT_YET_AVAILABLE`) has
  been seen; "ready to pick up" could be a later step once a page with one is measured.
- **The page's words win over its state.** A second save, made after the last hold was cancelled on the page,
  said "You have no items on hold" with no count line while its state still carried the hold: the state is the page
  as it was opened. So on a saved page, "no items on hold" is an empty, whole list; a count line that disagrees with
  the state reads nothing and asks for a reload (`libraryHoldsStale`); words with neither are read but never whole.
  Step 2 now says to reload a changed page before saving it.
- **A bug it fixed.** Before this, a holds page dropped in the box was read as a shelf page: its "1 to 1 of 1 items"
  became For Later's count, so For Later was called whole with one book and every other For Later book was listed as
  gone. A holds page now says nothing about any shelf.


## D44. Opt-in agent reading, with a notice for reads and writes (2026-11-05, Ryan's request)

Ryan asked for Search Desk's read connection as well as its inbox, and a skill that warns that both
reading and writing expose book titles to the AI. This supersedes D36's no-mirror restriction.
`tools/serve.py --mirror` injects a local-only helper that mirrors the active shelf, including practice
data, to `nextbook-live.json` outside the served folder. It is off by default; normal and built apps
remain offline. A per-run token and exact local Origin/Host protect the write route. The file is atomic,
owner-only, ignored by git and excluded from builds. A visible notice identifies enabled sharing.
`tools/read-shelf.py` filters the snapshot; `.claude/skills/use-nextbook/SKILL.md` explains disclosure,
whole-entry writes, separate browser origins, multiple tabs, and the snapshot left after stopping.
The model box's shelf-title exclusions are unchanged.
