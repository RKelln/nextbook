---
description: Find books at the library for the person's words
argument-hint: <the words to search for>
---

Find books for the person, using the words they gave: $ARGUMENTS

1. Use their words exactly as given. Do not add words, do not correct spelling, do not search a second thing.
2. Show them the exact line before it runs. Write it in a code block, then run it in the same reply:
   `python3 tools/find.py "birds toronto"`
   Put their words inside double quotes, in place of `birds toronto`. If their words contain a double quote, use
   single quotes around them instead.
3. Wait for it to finish. It fetches one search page from the library and the pages are paced at least 5 seconds
   apart, so it can take up to a minute. Do not run it a second time while it is working.
4. Read what it printed. The lines that matter:
   - `Added N books.` (or `Added 1 book.`, or `Added no new books. ... already in the list.`)
   - `Strongest subjects: ...`
   - `No page came back, so nothing was added and nothing was changed.`
   - `The library would not give that page: ...` or `Could not reach the library: ...`
5. Tell the person, in plain words and short sentences:
   - the search line you ran;
   - how many books were added, and the strongest subjects the library's records carried, if any;
   - where they went: "They are in your library list as unshelved books, not on your shelf. Run a mode to see them in your picks."
   - this sentence: "The page will show these books the next time it is opened or reloaded."
   - if nothing was added, why: they were already in the list, or the library would not answer.
6. If the page is being served by `python3 tools/serve.py`, it reloads itself when `app/data/found.js` changes, so
   the books appear on their own. Say that; do not tell them to press anything.
7. Titles the library has only on order are left out on purpose (nobody can borrow them yet). Do not add
   `--include-on-order` unless they ask for new, not-yet-arrived books.
8. Do not do these: fetch a second page, add a book the library did not return, edit `data/found.json` or
   `app/data/found.js` by hand, or run `--clear` unless they ask to start over.
