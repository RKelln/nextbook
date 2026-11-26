# Ask a chat  (id: your choice, shape: list, size: S)

**In plain words:** your rule picks up to forty books from the pile; a chat chooses up to six of them for you.

**Why someone wants it:** some wishes are hard to write as a rule ("something that feels like autumn", "a book to talk
about with my dad"). A chat is good at that kind of judgement. The rule keeps it honest: the chat can only choose from
books that are really in the pile, and the app checks every one.

## The rule

1. Decide which books the chat may choose from: up to forty, none on the shelf. This is your rule, and it is the part
   you build and test. Examples: the forty closest to the shelf (`ctx.score`); every book in a part of the library the
   shelf never visits; books with a subject the person picks.
2. Write the question the chat answers, in one or two sentences. It may use an input (a `text` box: "What are you in the
   mood for?"). It must not name a book or an author from the shelf: the check refuses that.
3. Return `{ picks: [], ask: { question, books } }`. The app writes the rest of the prompt, with the shelf as numbers only
   (`CONTRACT.md` section 9), and reads the answer.
4. When the rule finds no books, return a `note` that says why, and no `ask`.

## Done when

- [ ] The check passes, including the standard shelves.
- [ ] The rule's helpers are tested in the check file: which books, how many, in what order.
- [ ] On the Suggestions screen the box shows the question and up to forty books; pasting a chat's answer gives cards
      marked "From the chat".
- [ ] A book the chat made up, or one not offered, is dropped and named under the cards.
- [ ] When the rule finds few books (fewer than six), the note says so.

## Logic to write and check

- The rule: `books(...)`, a list of ids. Test with tiny made-up works: the order, the cap, and what is left out.
- The question: `question(input)`. Test that an empty input still gives a sentence.

## Usually goes wrong

- **The question names a shelf book** ("something like Piranesi"). The check stops it. Use what the summary already
  says (subjects, moods) instead.
- **The rule offers the whole pile.** Forty is the most; fewer, better-chosen books give the chat a real choice.
- **Testing the chat instead of the rule.** What a chat says changes every time, so it cannot be in the check. Test the
  rule; then try the box by hand and say what the chat did in the plan's "Still broken" if it misbehaves.

**Out of scope:** calling a chat from the page, sending titles or authors from the shelf, more than six cards.

**Ideas for after:** a `choice` input for the question's angle (cosy, a challenge, something short); a second rule for a
different forty; have the person compare the chat's six with "More by them" and say which they would read.
