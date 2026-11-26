// reference/modes/ask-chat.js: a worked example of a mode that asks a chat (CONTRACT.md section 9,
// D46). Built to docs/modes/ask-a-chat.md. The rule narrows the pile to the forty books closest to
// the shelf; the chat chooses up to six of them. The app writes the prompt, with the shelf as
// numbers only, and checks the chat's answer against these forty.
Nextbook.mode({
  id: 'ask-chat',
  name: 'Ask a chat',
  purpose: 'A chat chooses six from the forty books closest to your shelf.',
  shape: 'list',
  inputs: [{ id: 'wish', kind: 'text', label: 'What are you in the mood for?', optional: true, any: 'Anything' }],
  strings: {
    askWish: 'This person is in the mood for: {wish}. Choose the books from this list that fit that best, and that fit what their shelf adds up to.',
    askPlain: 'Choose the books from this list that this person is most likely to enjoy next, from what their shelf adds up to.',
    noRated: 'Your shelf has no rated books yet, so the chat chooses from the first {n} books in the pile.',
    fewClose: 'Only {n} books in the pile share something with your shelf, so the chat chooses from those.',
    emptyPile: 'Every book in the pile is already on your shelf, so there is nothing to ask about.'
  },
  logic: {
    // Pure: the books with their scores, closest first, ties by id, at most n.
    closest(scored, n) {
      return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, n)
        .map(s => s.id);
    },
    question(wish, strings) {
      const said = String(wish || '').replace(/\s+/g, ' ').trim();
      return said ? strings.askWish.replace('{wish}', said) : strings.askPlain;
    }
  },
  choose(ctx, input) {
    const pile = ctx.works.filter(w => !ctx.onShelf(w.id));
    if (!pile.length) return { picks: [], note: ctx.t('emptyPile') };
    const question = this.logic.question(input && input.wish, this.strings);
    const scored = pile.map(w => ({ id: w.id, score: ctx.score(w).score }));
    let books = this.logic.closest(scored, 40);
    let note = '';
    if (!books.length) {
      books = pile.map(w => w.id).sort().slice(0, 40);
      note = ctx.t('noRated', { n: books.length });
    } else if (books.length < 6) {
      note = ctx.t('fewClose', { n: books.length });
    }
    const out = { picks: [], ask: { question, books } };
    if (note) out.note = note;
    return out;
  }
});
