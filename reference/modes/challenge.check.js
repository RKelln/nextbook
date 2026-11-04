// reference/modes/challenge.check.js: checks for the challenge mode's pure helpers and its answer.
Nextbook.check('challenge', (t, mode) => {
  const L = mode.logic;
  const say = (key, vars) => String(mode.strings[key]).replace(/\{([A-Za-z0-9_]+)\}/g,
    (m, k) => vars && vars[k] !== undefined ? String(vars[k]) : m);

  const labels = {
    'topic:survival': 'survival', 'topic:war': 'war', 'topic:memory': 'memory',
    'topic:justice': 'justice', 'genre:speculative': 'speculative fiction'
  };
  const labelOf = f => (labels[f] !== undefined ? labels[f] : String(f));

  // ---- positive: what the person said something good about -------------------------------------
  t.eq(L.positive({ rating: 'loved', state: 'read' }), true, 'a loved book is evidence');
  t.eq(L.positive({ rating: 'ok', state: 'read' }), true, 'an "ok" book is evidence');
  t.eq(L.positive({ rating: null, state: 'read' }), true, 'a book read with no rating is evidence');
  t.eq(L.positive({ rating: null, state: 'reading' }), true, 'a book being read is evidence');
  t.eq(L.positive({ rating: 'not-for-me', state: 'read' }), false, 'a "not for me" is never a subject to argue with');
  t.eq(L.positive({ rating: null, state: 'want' }), false, 'a wish is not evidence');
  t.eq(L.positive({ rating: null, state: 'stopped' }), false, 'a book put down is not evidence');
  t.eq(L.positive(null), false, 'nothing is not evidence');

  // ---- leastRead --------------------------------------------------------------------------------
  t.eq(L.leastRead([]), 'NONFICTION', 'an empty shelf ties, and a tie goes to non-fiction');
  t.eq(L.leastRead([{ rating: 'loved', work: { contentType: 'FICTION' } },
    { rating: 'loved', work: { contentType: 'FICTION' } }]), 'NONFICTION',
  'a shelf of novels is given non-fiction');
  t.eq(L.leastRead([{ rating: 'loved', work: { contentType: 'NONFICTION' } },
    { rating: 'loved', work: { contentType: 'NONFICTION' } }]), 'FICTION',
  'a shelf of non-fiction is given a novel');
  t.eq(L.leastRead([{ rating: 'loved', work: { contentType: 'FICTION' } },
    { rating: 'loved', work: { contentType: 'NONFICTION' } }]), 'NONFICTION', 'a tie goes to non-fiction');
  t.eq(L.leastRead([
    { rating: 'loved', work: { contentType: 'FICTION' } },
    { rating: 'loved', work: { contentType: 'FICTION' } },
    { rating: null, state: 'want', work: { contentType: 'NONFICTION' } },
    { rating: 'not-for-me', work: { contentType: 'NONFICTION' } }
  ]), 'NONFICTION', 'a wish and a "not for me" are not books the shelf reads');
  t.eq(L.leastRead([{ rating: 'loved', work: null }, { state: 'read' }]), 'NONFICTION',
    'a book with no work counts for nothing');

  // ---- topTopics ---------------------------------------------------------------------------------
  const prof = { weights: { 'topic:war': 2, 'topic:survival': 5, 'topic:memory': 5, 'genre:speculative': 9,
    'topic:power': -3, 'mood:hopeful': 4 }, rated: 3 };
  t.eq(L.topTopics(prof, 3), ['topic:memory', 'topic:survival', 'topic:war'],
    'the strongest subjects, positive only, ties by facet key');
  t.eq(L.topTopics(prof, 1), ['topic:memory'], 'takes the number asked for');
  t.eq(L.topTopics({ weights: { 'genre:speculative': 4 } }, 3), [], 'a kind of book is not a subject');
  t.eq(L.topTopics({ weights: { 'topic:power': -3 } }, 3), [], 'a subject the shelf did not like is left out');
  t.eq(L.topTopics(null, 2), [], 'no profile is no subjects');

  // ---- topMoods ----------------------------------------------------------------------------------
  const joke = w => (w.id === 'a' ? { mood: ['Quiet', 'quiet'] } : null);
  t.eq(L.topMoods([{ rating: 'loved', work: { id: 'a' } }], joke, 2), ['quiet'],
    'counts a mood once per work, in lower case');
  t.eq(L.topMoods([
    { rating: 'loved', work: { id: 'a' } },
    { rating: 'liked', work: { id: 'b' } }
  ], w => (w.id === 'a' ? { mood: ['quiet'] } : { mood: ['warm', 'quiet'] }), 2), ['quiet', 'warm'],
  'puts the most common mood first');
  t.eq(L.topMoods([
    { rating: 'loved', work: { id: 'a' } },
    { rating: 'not-for-me', work: { id: 'b' } },
    { rating: null, state: 'want', work: { id: 'c' } }
  ], w => (w.id === 'a' ? { mood: ['quiet'] } : { mood: ['dark'] }), 2), ['quiet'],
  'a mood only on a "not for me" or a wish does not count');
  t.eq(L.topMoods([{ rating: 'loved', work: { id: 'a' } }, { rating: 'loved', work: { id: 'b' } }],
    w => (w.id === 'a' ? { mood: ['warm'] } : { mood: ['dark'] }), 2), ['dark', 'warm'],
  'ties go by the mood word');
  t.eq(L.topMoods([], null, 2), [], 'an empty shelf has no moods');
  // The pool writes the mood words on the work as facets; a mode reads those as well as tagsOf,
  // because ctx.tagsOf can hand back nothing while the facets are there.
  t.eq(L.topMoods([{ rating: 'loved', work: { id: 'a', facets: ['mood:quiet', 'topic:sea'] } }], () => null, 2),
    ['quiet'], 'reads a mood from the work own facets when there are no tags');
  t.eq(L.moodsOf({ id: 'a', facets: ['mood:quiet'] }, () => ({ mood: ['quiet', 'warm'] })), ['quiet', 'warm'],
    'counts a mood once when the facets and the tags agree');

  // ---- opposite and sharedTopic ------------------------------------------------------------------
  const book = (id, type, facets) => ({ id: id, contentType: type, facets: facets });
  t.eq(L.opposite(book('n', 'NONFICTION', ['topic:survival']), 'topic:survival', 'NONFICTION'), true,
    'the other kind of book on the same subject is the other side');
  t.eq(L.opposite(book('n', 'FICTION', ['topic:survival']), 'topic:survival', 'NONFICTION'), false,
    'the same kind of book is not the other side');
  t.eq(L.opposite(book('n', 'NONFICTION', ['topic:war']), 'topic:survival', 'NONFICTION'), false,
    'another subject is not the other side');
  t.eq(L.opposite(book('n', 'NONFICTION', []), 'topic:survival', 'NONFICTION'), false,
    'no subjects at all is not the other side');
  t.eq(L.sharedTopic(book('x', 'FICTION', ['topic:war', 'topic:survival']),
    ['topic:survival', 'topic:war']), 'topic:survival', 'names the strongest shared subject');
  t.eq(L.sharedTopic(book('x', 'FICTION', ['topic:memory']), ['topic:survival']), '',
    'nothing shared is no subject');

  // ---- hasAnyMood, howMany, byScore --------------------------------------------------------------
  t.eq(L.hasAnyMood({ id: 'x' }, ['quiet', 'dark'], w => ({ mood: ['dark'] })), true,
    'a shared mood is the mood the shelf likes');
  t.eq(L.hasAnyMood({ id: 'x' }, ['quiet'], w => ({ mood: ['dark'] })), false,
    'another mood is the other side');
  t.eq(L.howMany(1), 'one book', 'writes one so the sentence reads');
  t.eq(L.howMany(5), 'five books', 'writes a small count in words');
  t.eq(L.howMany(12), '12 books', 'writes a large count in digits');
  const ranked = [{ work: { id: 'b' }, score: 1 }, { work: { id: 'a' }, score: 1 }, { work: { id: 'c' }, score: 5 }];
  t.eq(ranked.slice().sort(L.byScore).map(x => x.work.id), ['c', 'a', 'b'],
    'best score first, ties to the lower id');

  // ---- choose, on made-up shelves ---------------------------------------------------------------
  function ctxFor(o) {
    return {
      works: o.works,
      shelf: o.shelf || [],
      onShelf: id => (o.onShelf || []).indexOf(id) !== -1,
      profile: () => o.profile,
      score: w => ({ score: w.score || 0, parts: [] }),
      tagsOf: w => (o.tags && o.tags[w.id]) || null,
      labelOf: labelOf,
      t: say
    };
  }

  // A shelf of three novels about survival and war, all liked and all hopeful.
  const shelf = [
    { rating: 'loved', state: 'read', work: book('f1', 'FICTION', ['genre:speculative', 'topic:survival', 'mood:hopeful']) },
    { rating: 'liked', state: 'read', work: book('f2', 'FICTION', ['topic:survival', 'mood:hopeful']) },
    { rating: 'liked', state: 'read', work: book('f3', 'FICTION', ['genre:speculative', 'topic:war', 'mood:hopeful']) }
  ];
  const shelfTags = { f1: { mood: ['hopeful'] }, f2: { mood: ['hopeful'] }, f3: { mood: ['hopeful'] } };
  const shelfProfile = { weights: { 'topic:survival': 5, 'topic:war': 2, 'genre:speculative': 3, 'mood:hopeful': 3 }, rated: 3 };

  const nf1 = book('nf1', 'NONFICTION', ['topic:survival']);
  const nf2 = book('nf2', 'NONFICTION', ['topic:survival']);
  const nf3 = book('nf3', 'NONFICTION', ['topic:war']);
  const m1 = book('m1', 'FICTION', ['topic:survival']);
  const m2 = book('m2', 'FICTION', ['topic:war']);
  const hope = book('h1', 'FICTION', ['topic:survival']);
  const untagged = book('u1', 'FICTION', ['topic:survival']);
  [nf1, nf2, nf3, m1, m2, hope, untagged].forEach((w, i) => { w.score = [5, 3, 1, 4, 2, 8, 9][i]; });

  const full = ctxFor({
    works: [nf1, nf2, nf3, m1, m2, hope, untagged],
    shelf: shelf,
    profile: shelfProfile,
    tags: { f1: shelfTags.f1, f2: shelfTags.f2, f3: shelfTags.f3, nf1: { mood: ['dark'] },
      m1: { mood: ['dark'] }, m2: { mood: ['tense'] }, h1: { mood: ['hopeful'] } }
  });
  const answer = mode.choose.call(mode, full);
  t.eq(answer.picks.map(p => p.id), ['nf1', 'nf2', 'nf3', 'm1', 'm2'],
    'three of the other shelf and two of the other mood, best score first');
  t.eq(answer.picks.slice(0, 3).map(p => p.group), ['The other shelf', 'The other shelf', 'The other shelf'],
    'the other kind of book is grouped together');
  t.eq(answer.picks.slice(3).map(p => p.group), ['The other mood', 'The other mood'],
    'the other mood is grouped together');
  t.eq(answer.picks[0].why, 'You read novels about survival. This is non-fiction about survival.',
    'the other shelf names the subject and what is different');
  t.eq(answer.picks[3].why, 'Your shelf leans hopeful. This one is about survival, but not hopeful.',
    'the other mood names the shared subject, the shelf mood, and the difference');
  t.ok(answer.picks[3].why.indexOf('You liked') === -1,
    'the mood sentence is about the shelf as a whole, not a claim about this subject');
  t.ok(answer.picks.every(p => p.why.length <= 200), 'every reason fits in 200 characters');
  t.eq(answer.note, 'Left out one book with no mood words. The list has only five books that would argue with your shelf.',
    'says how many books had no mood words, and says it found fewer than six');
  t.eq(answer.picks.map(p => p.id).filter((id, i, all) => all.indexOf(id) !== i), [],
    'no book is on the list twice');

  // The hopeful novel is never offered as the other mood: it has the mood the shelf likes.
  t.ok(answer.picks.map(p => p.id).indexOf('h1') === -1, 'a book with the shelf mood is not the other mood');
  // The untagged novel is skipped and counted.
  t.ok(answer.picks.map(p => p.id).indexOf('u1') === -1, 'a book with no mood words is not guessed at');

  // A list with no untagged books says so.
  const allTagged = ctxFor({
    works: [nf1, nf2, nf3, m1, m2, hope],
    shelf: shelf,
    profile: shelfProfile,
    tags: { f1: shelfTags.f1, f2: shelfTags.f2, f3: shelfTags.f3, nf1: { mood: ['dark'] },
      m1: { mood: ['dark'] }, m2: { mood: ['tense'] }, h1: { mood: ['hopeful'] } }
  });
  const tidy = mode.choose.call(mode, allTagged);
  t.ok(tidy.note.indexOf(mode.strings.skippedNone) !== -1,
    'says no book was left out when every book has mood words');

  // No non-fiction at all: the mood side fills the list, and the note says which kind filled it.
  const m3 = book('m3', 'FICTION', ['topic:survival']);
  const m4 = book('m4', 'FICTION', ['topic:war']);
  m3.score = 7;
  m4.score = 6;
  const noOtherShelf = mode.choose.call(mode, ctxFor({
    works: [m1, m2, m3, m4, hope],
    shelf: shelf,
    profile: shelfProfile,
    tags: { f1: shelfTags.f1, f2: shelfTags.f2, f3: shelfTags.f3, m1: { mood: ['dark'] },
      m2: { mood: ['tense'] }, m3: { mood: ['sad'] }, m4: { mood: ['dark'] }, h1: { mood: ['hopeful'] } }
  }));
  t.eq(noOtherShelf.picks.length, 4, 'fills the list from the mood side');
  t.eq(noOtherShelf.picks.map(p => p.group), ['The other mood', 'The other mood', 'The other mood', 'The other mood'],
    'every pick is from the mood side');
  t.ok(noOtherShelf.note.indexOf(mode.strings.noShelfSide) === 0,
    'the note says the other shelf had nothing, so these come from the other mood');

  // No book with a different mood: the other shelf fills the list, and the note says which.
  const noOtherMood = mode.choose.call(mode, ctxFor({
    works: [nf1, nf2, nf3, hope, untagged],
    shelf: shelf,
    profile: shelfProfile,
    tags: { f1: shelfTags.f1, f2: shelfTags.f2, f3: shelfTags.f3, nf1: { mood: ['dark'] },
      h1: { mood: ['hopeful'] } }
  }));
  t.eq(noOtherMood.picks.map(p => p.group), ['The other shelf', 'The other shelf', 'The other shelf'],
    'fills the list from the other shelf');
  t.ok(noOtherMood.note.indexOf(mode.strings.noMoodSide) === 0,
    'the note says no book with a different mood was left, so these come from the other shelf');
  t.ok(noOtherMood.note.indexOf('Left out one book with no mood words.') !== -1,
    'still counts the book it could not judge for mood');

  // A shelf with no mood words at all does not run the mood side, and says why.
  const plainShelf = [
    { rating: 'loved', state: 'read', work: book('p1', 'FICTION', ['genre:speculative', 'topic:survival']) },
    { rating: 'liked', state: 'read', work: book('p2', 'FICTION', ['topic:survival']) },
    { rating: 'liked', state: 'read', work: book('p3', 'FICTION', ['topic:war']) }
  ];
  const noWords = mode.choose.call(mode, ctxFor({
    works: [nf1, nf2, nf3, m1],
    shelf: plainShelf,
    profile: shelfProfile,
    tags: { m1: { mood: ['dark'] } }
  }));
  t.eq(noWords.picks.length, 3, 'still gives the other shelf');
  t.ok(noWords.note.indexOf(mode.strings.noMoods) !== -1, 'says the shelf has no mood words yet');

  // A book already on the shelf is not offered.
  const onShelf = mode.choose.call(mode, ctxFor({
    works: [nf1, nf2, nf3, m1, m2],
    shelf: shelf,
    profile: shelfProfile,
    onShelf: ['nf1'],
    tags: { f1: shelfTags.f1, f2: shelfTags.f2, f3: shelfTags.f3, nf2: { mood: ['dark'] },
      m1: { mood: ['dark'] }, m2: { mood: ['tense'] } }
  }));
  t.ok(onShelf.picks.map(p => p.id).indexOf('nf1') === -1, 'never offers a book already on the shelf');

  // Nothing rated: ask for a rated book instead of guessing.
  const nothingRated = mode.choose.call(mode, ctxFor({
    works: [nf1, m1], shelf: [], profile: { weights: {}, rated: 0 }, tags: {}
  }));
  t.eq(nothingRated.picks.length, 0, 'a shelf with nothing rated gives no picks');
  t.eq(nothingRated.note, mode.strings.needsRated, 'says it needs a rated book first');

  // Rated, but with no subjects at all: say that, and still ask for a rated book.
  const noSubjects = mode.choose.call(mode, ctxFor({
    works: [nf1, m1], shelf: shelf, profile: { weights: { 'genre:speculative': 3 }, rated: 2 }, tags: {}
  }));
  t.eq(noSubjects.picks.length, 0, 'a shelf with no subjects gives no picks');
  t.eq(noSubjects.note, mode.strings.noTopics, 'says there are no subjects to take the other side of');

  // Every reason is civil: it describes the books, never the person's taste.
  const rude = ['wrong', 'bad taste', 'should read', 'instead of', 'not for you', 'lazy', 'you need'];
  const rough = [];
  answer.picks.forEach(p => rude.forEach(w => {
    if (p.why.toLowerCase().indexOf(w) !== -1) rough.push(p.id + ': ' + w);
  }));
  t.eq(rough, [], 'no reason is rude about the person or their taste');

  // The two kinds are always in the same order, so the same shelf gives the same answer twice.
  const again = mode.choose.call(mode, full);
  t.eq(again, answer, 'the same shelf gives the same list twice');
});
