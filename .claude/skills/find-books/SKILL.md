---
name: find-books
description: Find books at the library for the person's words - one catalogue search, plus up to ten titles you remember that fit, each checked at the library - and add what the library has to the app. Use when a person asks to find or search for books.
---

Find books for the person, using the words they gave, and titles you remember that fit them

The library's search matches words, so a request like "quiet books about the sea" often finds little. You know
many books; the library knows which ones are real and on its shelves. So you suggest, and the library decides.

1. Use their words exactly as given for the search. Do not add words or correct spelling.
2. Think of up to 10 books that fit their words: real titles you are confident of, with the author. Mix well-known
   and less-known books, and different places and voices, not only the famous ones. If their words name no kind
   of book (a single author, a call number), suggest none and leave out `--suggest`.
3. Show them your list, one line each, then the exact command, in the same reply, and run it:

   ```
   python3 tools/find.py "quiet books about the sea" --suggest - <<'EOF'
   The Old Man and the Sea | Ernest Hemingway
   The Sea, the Sea | Iris Murdoch
   EOF
   ```

   Their words go inside double quotes, in place of `quiet books about the sea` (single quotes if their words
   contain a double quote). One `Title | Author` per line between the `EOF` lines.
4. Wait for it to finish. Each search is one page, at least 5 seconds apart, so eleven searches take about a
   minute. Do not run it a second time while it is working.
5. Read what it printed. The lines that matter:
   - `Added N books.` (or `Added 1 book.`, or `Added no new books. ... already in the pile.`)
   - `Strongest subjects: ...`
   - `No page came back, so nothing was added and nothing was changed.`
   - `The library would not give that page: ...` or `Could not reach the library: ...`
   - `Suggested titles found at the library: N of M ...` and `Not found: ...`
6. Tell the person, in plain words and short sentences:
   - the search line you ran;
   - how many books were added, and the strongest subjects the library's records carried, if any;
   - where they went: "They went into the pile, not on your shelf. The pile is the books Nextbook can suggest from. You can see them on the Pile screen in the app, and a way of choosing can now pick them."
   - this sentence: "The page will show these books the next time it is opened or reloaded."
   - how many of your suggestions the library had, and which it did not, by name. Say plainly that a title not
     found may be one you made up or remembered wrongly, or one this library does not hold; do not argue for it.
   - if nothing was added, why: they were already in the pile, or the library would not answer.
   - if the search failed (`Could not reach the library` or `The library would not give that page`): the error in
     one line, as printed, and that the pile still has the books it had, so the modes still work and they can
     carry on without it (`python3 tools/coverage.py` gives the count; say "up to six" picks, never "six"). Try
     once more at most. Do not guess whether a fix is allowed or why the library refused: report what printed.
7. If the page is being served by `python3 tools/serve.py`, it reloads itself when `app/data/found.js` changes, so
   the books appear on their own. Say that; do not tell them to press anything.
8. Titles the library has only on order are left out on purpose (nobody can borrow them yet). Do not add
   `--include-on-order` unless they ask for new, not-yet-arrived books.
9. Do not do these: fetch a second page of the search, add a book the library did not return, suggest more than
   10 titles, edit `data/found.json` or `app/data/found.js` by hand, or run `--clear` unless they ask to start over.
