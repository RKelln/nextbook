# data-test names

Every control a browser test would press has a `data-test` name. Names are stable; only the
number at the end changes, and it is always the control's place on the page, counted from 1.

- `shelf-…-N`: N is the book's row in the shelf list, top to bottom. The row (`li.nb-book`)
  also carries `data-book="<entry key>"`, which survives a reorder: `w:pack:dispossessed`
  for a book from the list, `t:<title>|<author>` for a book typed in.
- `add-result-N`: N is the row in the current search results.
- `friend-remove-N`: N is the friend's shelf in the list.

## The page and the tabs

| Name | What it is | What pressing it does |
|---|---|---|
| `nav-find` | Tab "Ways to choose" | Goes to `#find`. |
| `nav-shelf` | Tab "Shelf" | Goes to `#shelf`. |
| `nav-events` | Tab "Events" | Goes to `#events`. Drawn only when `app/data/events.js` has a snapshot; a copy without one has no tab. |
| `nav-selftest` | Tab "Self-test" | Goes to `#selftest`. |

The hash is the place: a reload keeps `#shelf` or `#selftest`, and no hash shows `#find`.

## The practice banner

| Name | What it is | What pressing it does |
|---|---|---|
| `practice-banner` | The banner box (not pressed) | — |
| `practice-reset` | Button "Reset the practice shelf" | Asks first ("Reset the practice shelf? …"), then puts the practice books back. The own shelf and friends' shelves are not touched. |
| `shelf-use-own` | Button "Use my own shelf" | Switches to the own shelf. Not drawn in a workshop copy (the practice-only sentence is shown instead). |
| `shelf-use-practice` | Button "Use the practice shelf" | Switches back to the practice shelf. |

## The shelf list

| Name | What it is | What pressing it does |
|---|---|---|
| `shelf-list` | The list (not pressed) | — |
| `shelf-link-N` | The book's title, a link | Opens the library's page for the book (the library's own page for it when there is one, otherwise its search page). A book typed in and not in the list links to the library's search for its title and author. |
| `shelf-filter` | The filter above the list: one chip per state that has a book, each with its count (not pressed) | — |
| `shelf-filter-all`, `shelf-filter-<state>` | Chip "All" or a state's name (`aria-pressed`) | Shows the whole shelf or only that state, for this visit. N below counts the rows shown. |
| `shelf-filter-empty` | The line when a filter shows no books | — |
| `shelf-state-N` | A fieldset of four radios drawn as one bar (not pressed) | — |
| `shelf-state-N-<state>` | Radio: `want` / `hold` / `reading` / `read` / `stopped` | Saves the new state in this browser. |
| `shelf-rating-N` | The rating group; its `aria-label` is the question. Absent on a book to read with no rating | — |
| `shelf-rating-N-<rating>` | Chip: `loved` / `liked` / `ok` / `not-for-me` (`aria-pressed`) | Saves that rating; pressing the chip that is on takes the rating off. |
| `shelf-remove-N` | Button "Remove" | Takes the book off the shelf in use. |
| `shelf-holds-N` | Link "Your holds", on a book on hold | Opens the library's holds page through its sign-in, in a new tab. |
| `message-hold-yes` | Button "Yes, it's on hold" in the toast, after coming back from `shelf-hold-N` or `pick-hold-N` | Sets that book to `hold`, adding it to the shelf first if it came from a pick. |
| `lib-steps` | The library block's three steps (not pressed) | — |
| `lib-open-<page>` | Link in step 1: `forLater`, `inProgress`, `completed`, `holds` | Opens that shelf at the library through its sign-in, in a new tab. Coming back to this tab afterwards on the own shelf says once how to bring a change in (`libBackHere`) and opens the library block. |
| `lib-drop` | The box around `shelf-library-file`: a click chooses, a drop of saved pages lands | As `shelf-library-file`. |
| `shelf-hold-N` | Link "Sign in and hold", on a book to read that has a catalogue record | Opens the library's sign-in page in a new tab, which lands on the book's own page after signing in. |
| `shelf-account`, `find-account` | The "At the library" box (not pressed) | — |
| `shelf-account-<page>`, `find-account-<page>` | Link: `holds`, `forLater`, `checkedOut` | Opens the library's sign-in page in a new tab, which lands on that page of the person's account. |

## Adding a book

| Name | What it is | What pressing it does |
|---|---|---|
| `add-search` | Search box | Narrows the list as you type, by title, author or subject. |
| `add-results` | The results box (not pressed) | — |
| `add-result-N` | Button "Add" on a result | Adds that book as "Want to read". The button is replaced by "On your shelf" when it is already there. |
| `add-by-name` | Button "Not in the list? Add it by name" | Shows the title and author boxes. |
| `add-title` | Title box | — |
| `add-author` | Author box | — |
| `add-name-submit` | Button "Add this book" | Adds the typed book. If its title and author match a book in the list it links to it and shows its subjects; if not, it is kept by its own key and its link searches the library. |

## Saving a copy, importing, friends

| Name | What it is | What pressing it does |
|---|---|---|
| `shelf-export` | Button "Download the shelf file" | Makes `nextbook-shelf-<date>.json` from the shelf in use. |
| `shelf-export-text` | Text box with the file's text | Only appears when the browser cannot make a download; the text is there to copy. |
| `shelf-import-file` | File chooser "Choose a shelf file" | Reads the file and merges it into the shelf in use, then says in words how many were added, changed and kept. |
| `friend-name` | Box "A name for this shelf" | — |
| `friend-file` | File chooser "Choose their shelf file" | — |
| `friend-add` | Button "Add this friend's shelf" | Adds their file as a friend's shelf, kept apart; the own shelf is not changed. A second file with the same name replaces the first. |
| `friends-list` | The list of friends' shelves (not pressed) | — |
| `friend-remove-N` | Button "Remove" by a friend's shelf | Removes that friend's shelf only. |

## The found notice

| Name | What it is | What pressing it does |
|---|---|---|
| `found-notice` | The box "Your helper found N books for …" (not pressed) | Drawn only when `app/data/found.js` has books. |
| `found-clear` | Button "OK" | Hides the notice on this page for the rest of the visit. It does not delete the file or the books. |

## The helper's note

Drawn at the top of the shelf screen when `app/data/inbox.js` was read at boot and its books
came in. A reload with the same note draws nothing: its name is remembered in this browser.

| Name | What it is | What pressing it does |
|---|---|---|
| `inbox-note` | The box (not pressed) | — |
| `inbox-said` | "Brought in 4 changes from your helper." (not pressed) | — |
| `inbox-kept` | "1 of them was newer on your shelf, so it was left as it is." (not pressed) | Drawn only when the shelf had a newer entry than the note's. |
| `inbox-undo` | Button "Undo these changes" | Puts the shelf in use back exactly as it was before the note was applied. |
| `inbox-refused-N` | One book the note offered and the page left out, named (not pressed) | — |
| `inbox-not-saved` | The not-saving sentence (not pressed) | Drawn only when the browser would not keep the change. |

## The self-test

| Name | What it is | What pressing it does |
|---|---|---|
| `selftest-data` | The list of what this copy has (not pressed) | — |
| `selftest-data-slice` | Line: the book list, its count and date | — |
| `selftest-data-tags` | Line: our own words, and how many books have them | — |
| `selftest-data-practice` | Line: the practice shelf and its count | — |
| `selftest-data-found` | Line: books found for you, count and date (or "none") | — |
| `selftest-data-events` | Line: library events, count and date (or "none") | — |
| `selftest-data-pool` | Line: why the book list did not load (only when it did not) | — |
| `selftest-saving` | Line: "This browser is saving your shelf." or the not-saving sentence | — |
| `selftest-run` | Button "Run the checks" | Runs `Nextbook.runModeChecks` for every id in `Nextbook.modes` and prints each pass and failure in words. |
| `selftest-results` | The results box (not pressed) | — |
| `selftest-summary` | The last line: "All checks passed." or "N checks failed." | — |

## The find screen

| Name | What it is | What pressing it does |
|---|---|---|
| `mode-list` | The mode cards (not pressed) | — |
| `mode-card-<id>` | One loaded mode's card, `<id>` as in `app/modes/list.js` (not pressed) | — |
| `mode-current-<id>` | The tag "Showing now" on the chosen mode's card (not pressed) | — |
| `mode-pick-<id>` | Button "Show the books" on a mode's card | Makes that mode the one shown, draws its inputs and its result. |
| `mode-missing-<id>` | The card for a listed mode that did not load (not pressed) | — |
| `mode-panel` | The chosen mode's box: inputs, results, model box (not pressed) | — |
| `find-needs-input` | The line "Pick something for … first" (not pressed) | Drawn instead of a result while an input has no value. |
| `find-shuffle` | Button "Shuffle" | Moves the mode's seed on by one and runs it again. The seed is kept, so a reload gives the same mix and only a press changes it. |
| `input-<input>` | The input's main control, named by the mode's input id: a select for `shelf-book`, `facet`, `event`; a search box for `book`; a text box for `text`; a number box for `number` | Saves the value in this browser and runs the mode again. An `event` select lists the snapshot's events by day and title and keeps the event's id; `choose` receives the event object. |
| `input-<input>-pick-N` | Button "Use this book" on a `book` search result | Makes that work the input's value. |
| `input-<input>-chosen` | The line "Chosen: title, by author." (not pressed) | — |
| `input-<input>-facet-N` | A subject checkbox in a `facets` input | Adds or removes that subject; the fourth is the last one taken. |
| `input-<input>-option-N` | A button in a `choice` input | Makes that option the value (marked `aria-pressed`). |
| `find-result` | The result box (not pressed) | — |
| `find-note` | The mode's own note (not pressed) | — |
| `find-error` | The plain sentence when a mode stopped or returned nothing with no note (not pressed) | — |
| `find-dropped` | The dropped-picks notice: each id and why, in words (not pressed) | — |
| `find-library-line` | "Holds, copies, your library shelves and the library's own suggestions are on the library's page." (not pressed) | — |
| `pick-list` | The cards, or the ordered path (not pressed) | — |
| `pick-N` | One result card (`data-pick="<work id>"`), N counted from 1 down the page | — |
| `pick-link-N` | The card's title, a link | Opens the library's page for the book. |
| `pick-want-N` | Button "Want to read" | Adds the book to the shelf in use as "Want to read" and runs the mode again. |
| `pick-read-N` | Button "Read it" | Adds it as "Read" (ready to rate) and runs the mode again. |
| `pick-hold-N` | Link "Sign in and hold", on a pick that has a catalogue record | As `shelf-hold-N`. |
| `find-to-shelf` | Button "Go to the shelf" | Goes to `#shelf`. |

## The model box

Drawn under a result with at least one card. Nothing is sent anywhere.

| Name | What it is | What pressing it does |
|---|---|---|
| `model-box` | The box (not pressed) | — |
| `model-prompt` | The words to copy, a read-only text box | — |
| `model-copy` | Button "Copy" | Copies the prompt, or selects it and says this browser did not copy, so it can be copied by hand. |
| `model-answer` | The paste box | — |
| `model-check` | Button "Read the answer" | Checks the pasted answer against the six cards, keeps what matches and names what it drops. An answer with no pick says so. |
| `model-result` | The answer's box (not pressed) | — |
| `model-card-N` | One kept pick, highlighted, marked "From the chat" (not pressed) | — |
| `model-link-N` | "Open the library's page" on a kept pick | Opens the library's page. |
| `model-said` | "This page could not find a pick in that answer." (not pressed) | — |
| `model-dropped` | The dropped ids, named in words (not pressed) | — |
| `model-excluded` | "The chat sees five of the six. One is already on your shelf, so it stays out of this box." (not pressed) | Drawn only when a candidate was left out of the prompt because it is on the shelf. Nothing is drawn when nothing was left out. |

The numbering rule holds here too: `N` is the control's place on the page, counted from 1. `<id>`
and `<input>` are names a mode chose, so they stay the same when cards move.

## From some words (a `facets` input)

Drawn inside a `facets` input, under the subject checkboxes. A mode with no `facets` input has
no `-words-…` control at all. Nothing is sent anywhere: the person copies the words into a chat
and pastes the answer back.

| Name | What it is | What pressing it does |
|---|---|---|
| `input-<input>-words-toggle` | Button "From some words" | Opens the panel; `aria-expanded` says whether it is open. |
| `input-<input>-words-panel` | The panel (not pressed) | — |
| `input-<input>-words-text` | Box "The words you paste" | An event, a headline or a wish. The words to copy follow as you type. |
| `input-<input>-words-prompt` | The words to copy, a read-only text box | — |
| `input-<input>-words-copy` | Button "Copy" | Copies the prompt. If the browser will not copy, it says so and the words are there to select by hand. |
| `input-<input>-words-answer` | The paste box | — |
| `input-<input>-words-check` | Button "Use the answer" | Keeps only subjects in this list, ticks up to four checkboxes and names the subjects it did not keep. |
| `input-<input>-words-result` | "Ticked: …" or "The chat did not name any subject in this list." (not pressed) | — |
| `input-<input>-words-dropped` | The subjects not kept, named in words (not pressed) | — |
| `input-<input>-words-said` | A note from Copy or Use the answer (not pressed) | — |

## The events screen

Drawn from `app/data/events.js`, which is made ahead by the events snapshot; the page never
fetches the feed. `N` is the event's place on the page, counted from 1 down the days; day
headings are numbered from 1 on their own.

| Name | What it is | What pressing it does |
|---|---|---|
| `events-section` | The screen (not pressed) | — |
| `events-snapshot` | "Snapshot taken <date>. Check the library's page before you go." (not pressed) | — |
| `events-empty` | The plain sentence in a copy with no events file (not pressed) | Drawn instead of the list; the tab is not drawn at all in such a copy. |
| `event-day-N` | One day's heading, e.g. "Tuesday, November 3" (not pressed) | — |
| `event-day-list-N` | That day's list of events (not pressed) | — |
| `event-N` | One event's box (`data-event="<event id>"`, not pressed) | — |
| `event-link-N` | The event's title, a link | Opens the library's own page for the event. |
| `event-open-N` | "Open the library's page" under the words, a link | The same page, for anyone who reads the words first. |
| `event-time-N` | "6:00 pm to 7:30 pm" (not pressed) | — |
| `event-virtual-N` | "This event is online." (not pressed) | Drawn only for a virtual event. |
| `event-summary-N` | The library's own words about the event, as text (not pressed) | — |
| `event-summary-long-N` | The sentence shown instead when the snapshot's words are over 300 characters (not pressed) | Nothing is cut here: the page says the words are longer than the snapshot keeps and points at the library's page. |
| `event-books-N` | Button "Books for this event" | Drawn only when a mode with the id `event-hook` is loaded. It opens that mode on `#find`. When the mode lists an `event` input, that input is set to this event; with only a `text` input, the event's title goes into the words box. One sentence says which path ran. |

## Bringing a reading list in (Goodreads or StoryGraph)

| Name | What it is | What pressing it does |
|---|---|---|
| `shelf-list-import` | The block under the shelf (not pressed; it takes the cursor after a report) | — |
| `shelf-list-file` | File input, "Choose a reading list file" | Reads the CSV, merges it with the shelf, says what changed. Not drawn on the practice shelf or in a workshop copy, with one sentence saying why. |
| `shelf-list-undo` | Button "Undo this import" | Puts the shelf back as it was before the import. |
| `list-said` | The report sentence (not pressed) | — |
| `list-report` | The report box (not pressed) | — |
| `list-refused-N` | One refusal sentence (not pressed) | — |
| `list-problem-N` | One reader problem, a row it could not use (not pressed) | — |
| `list-tidy` | The "Tidy up at the library (N)" panel (not pressed) | — |
| `list-choose` | The "Which is right? (N)" panel (not pressed) | — |
| `list-not-yet-row-N` | One book with no catalogue match, with its search link | — |

## Bringing the library's own shelf in (saved pages)

| Name | What it is | What pressing it does |
|---|---|---|
| `shelf-library` | The block (not pressed; it takes the cursor after a report) | — |
| `shelf-library-file` | File input, more than one page at a time | Reads each saved page, combines them, merges, says what changed. Not drawn on the practice shelf or in a workshop copy. |
| `lib-off` | The sentence shown instead in those copies (not pressed) | — |
| `lib-said` | The report sentence (not pressed) | — |
| `lib-report` | The report box (not pressed) | — |
| `lib-refused-N` | One refusal sentence (not pressed) | — |
| `lib-unheld` | The "No longer on hold" list after a whole holds list came in (D43) (not pressed) | — |
| `lib-unheld-N` | One book on it (not pressed) | — |
| `lib-unheld-reading-N` | "I picked it up" | Sets that book to Reading and puts the row away; the toast says so. |
| `lib-file-error-N` | One page that could not be read, named (not pressed) | — |
| `lib-problem-N` | One reader problem (not pressed) | — |
| `lib-not-saved` | The sentence when the write did not persist (not pressed) | — |
| `lib-last` | "Last brought in from the library: <date>" (not pressed) | — |
| `shelf-library-undo` | Button "Undo this library import" | Puts the shelf back as it was. |
| `lib-tidy` | The "Tidy up at the library (N)" panel (not pressed) | — |
| `lib-tidy-row-N` | One book that changed here and not at the library (not pressed) | — |
| `lib-tidy-open-N` | "Open at the library" | Opens the library's page for that book. |
| `lib-tidy-use-N` | "Use the library's" | Copies the library's shelf and rating onto the book. |
| `lib-tidy-leave-N` | "Leave it" | Remembers the choice, so the same book is not listed again until either side changes. |
| `lib-tidy-gone-N` | A book the library no longer has on your shelf (not pressed) | The book stays on the shelf, marked. |
| `lib-choose` | The "Which is right? (N)" panel (not pressed) | — |
| `lib-choose-row-N` | One book that changed on both sides, both shown (not pressed) | — |
| `lib-choose-keep-N` | "Keep mine" | Dismisses the row for this visit. |
| `lib-choose-use-N` | "Use the library's" | Copies the library's answer onto the book. |
| `shelf-gone-N` | The note on a shelf row the library no longer lists (not pressed) | The book is never removed automatically. |

## The model box

| Name | What it is | What pressing it does |
|---|---|---|
| `model-closed` | The sentence shown instead of the box when a mode may pick books already on the shelf (not pressed) | — |
| `model-prompt`, `model-copy`, `model-answer`, `model-check`, `model-result`, `model-excluded` | The prompt, its copy button, the answer box, the check button, the result, and the line saying how many candidates were left out because they are on the shelf | As their names say. |

## Also marked

`not-saving` is the sentence shown on every screen when the store says `persistent: false`.
It is a paragraph, not a control.
