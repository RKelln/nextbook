// reference/modes/ask-chat.check.js: checks for the ask-chat mode's pure helpers.
Nextbook.check('ask-chat', (t, mode) => {
  const L = mode.logic;
  const scored = [
    { id: 'b', score: 2 }, { id: 'a', score: 2 }, { id: 'c', score: 5 }, { id: 'd', score: 0 }, { id: 'e', score: -1 }
  ];
  t.eq(L.closest(scored, 40), ['c', 'a', 'b'], 'keeps only books that share something, closest first, ties by id');
  t.eq(L.closest(scored, 2), ['c', 'a'], 'stops at the number asked for');
  t.eq(L.closest([], 40), [], 'gives nothing for an empty pile');
  t.ok(L.question('  something   short ', mode.strings).indexOf('in the mood for: something short.') !== -1,
    'puts the wish in the question, with its spaces tidied');
  t.eq(L.question(null, mode.strings), mode.strings.askPlain, 'asks the plain question when there is no wish');
  t.eq(L.question('   ', mode.strings), mode.strings.askPlain, 'treats a wish of only spaces as no wish');
});
