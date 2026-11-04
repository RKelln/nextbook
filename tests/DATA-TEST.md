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
| `shelf-state-N` | Select: Want to read / Reading / Read / Stopped | Saves the new state in this browser. |
| `shelf-rating-N` | Select: No rating / Loved / Liked / OK / Not for me | Saves the new rating in this browser. |
| `shelf-remove-N` | Button "Remove" | Takes the book off the shelf in use. |

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
| `found-clear` | Button "Clear" | Hides the notice on this page for the rest of the visit. It does not delete the file or the books. |

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
| `input-<input>` | The input's main control, named by the mode's input id: a select for `shelf-book`, `facet`; a search box for `book`; a text box for `text`; a number box for `number` | Saves the value in this browser and runs the mode again. |
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

## Also marked

`not-saving` is the sentence shown on every screen when the store says `persistent: false`.
It is a paragraph, not a control.
