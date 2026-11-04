// reference/modes/survey.check.js: checks for the survey mode's pure helpers and its answer.
Nextbook.check('survey', (t, mode) => {
  const L = mode.logic;
  const say = (key, vars) => String(mode.strings[key]).replace(/\{([A-Za-z0-9_]+)\}/g,
    (m, k) => vars && vars[k] !== undefined ? String(vars[k]) : m);

  // ---- the helpers ----------------------------------------------------------------------------
  const sections = [
    { facet: 'section:100', label: 'the 100 shelves', works: [{ id: 'a' }, { id: 'b' }] },
    { facet: 'section:200', label: 'the 200 shelves', works: [{ id: 'c' }] },
    { facet: 'section:300', label: 'the 300 shelves', works: [] }
  ];
  const shelf = [
    { title: 'A', work: { id: 'a', facets: ['section:100', 'topic:seeds'] } },
    { title: 'B', work: { id: 'b', facets: ['section:100', 'section:200'] } },
    { title: 'Typed in', work: null },
    { title: 'No call number', work: { id: 'd', facets: ['topic:seeds'] } }
  ];
  t.eq(L.visitCounts(shelf, sections),
    { 'section:100': 2, 'section:200': 1, 'section:300': 0 },
    'counts a shelf book in each part its work stands in, and nowhere for a typed book');
  t.eq(L.visitCounts([], sections), { 'section:100': 0, 'section:200': 0, 'section:300': 0 },
    'gives every part a count on an empty shelf');
  t.eq(L.sectionFacets({ facets: ['section:100', 'section:100', 'topic:x'] }), ['section:100'],
    'a work does not count twice in one part');

  // ---- howMany --------------------------------------------------------------------------------
  t.eq(L.howMany(1), 'one book', 'writes a count of one so the sentence reads');
  t.eq(L.howMany(0), 'no books', 'writes a count of none');
  t.eq(L.howMany(2), 'two books', 'writes a small count in words');
  t.eq(L.howMany(12), '12 books', 'writes a large count in digits');
  t.eq(L.howMany(1, 'part'), 'one part', 'writes a count of one part so the sentence reads');
  t.eq(L.howMany(3, 'part'), 'three parts', 'writes a count of parts in words');

  // ---- unvisited -----------------------------------------------------------------------------
  const six = ['100', '200', '300', '400', '500', '600'].map((n, i) => ({
    facet: 'section:' + n, label: 'the ' + n + ' shelves',
    works: new Array(i + 1).fill(0).map((x, k) => ({ id: n + '-' + k }))
  }));
  const zeros = {};
  for (const s of six) zeros[s.facet] = 0;
  t.eq(L.unvisited(zeros, six).slice(0, 2), ['section:600', 'section:500'],
    'puts the biggest unvisited part first');
  const twoBig = [
    { facet: 'section:900', label: 'the 900 shelves', works: [{ id: 'x' }, { id: 'y' }] },
    { facet: 'section:800', label: 'the 800 shelves', works: [{ id: 'p' }, { id: 'q' }] }
  ];
  t.eq(L.unvisited({}, twoBig), ['section:800', 'section:900'], 'breaks a tie in size by facet key');
  t.eq(L.unvisited({ 'section:100': 3 }, sections), ['section:200', 'section:300'],
    'leaves out a part the shelf already visits');

  // ---- leastVisited --------------------------------------------------------------------------
  t.eq(L.leastVisited({ 'section:100': 2, 'section:200': 0, 'section:300': 1 }, sections)
    .map(s => s.facet), ['section:200', 'section:300', 'section:100'], 'puts the thinnest part first');

  // ---- bestIn --------------------------------------------------------------------------------
  const doors = [
    { id: 'a', title: 'A', facets: [], score: 1 },
    { id: 'b', title: 'B', facets: [], score: 5 },
    { id: 'c', title: 'C', facets: [], score: 5 },
    { id: 'd', title: 'D', facets: [], score: 9 }
  ];
  const pool = {
    onShelf: id => id === 'd',
    score: w => ({ score: w.score, parts: [] })
  };
  const section = { facet: 'section:100', works: doors };
  t.eq(L.bestIn(section, pool, {}).id, 'b', 'takes the best score, ties to the lower id');
  t.ok(L.bestIn(section, pool, {}, { d: true, b: true }).id === 'c',
    'skips a book already on the shelf and one another part took');
  t.eq(L.bestIn({ facet: 'section:100', works: [doors[0]] }, { onShelf: () => true, score: () => ({ score: 0, parts: [] }) }, {}),
    null, 'finds nothing when every book in the part is on the shelf');

  // ---- bridgePart ----------------------------------------------------------------------------
  t.eq(L.bridgePart([
    { facet: 'author:le guin, u', label: 'Ursula K. Le Guin', weight: 10 },
    { facet: 'topic:identity', label: 'identity', weight: 4.07 },
    { facet: 'genre:speculative', label: 'speculative fiction', weight: 2 },
    { facet: 'section:science-fiction', label: 'the science fiction shelves', weight: 1 }
  ], { facet: 'section:science-fiction' }), { kind: 'author', label: 'Ursula K. Le Guin' },
  'names the author when two books by them are the strongest part, not a weaker subject');
  t.eq(L.bridgePart([
    { facet: 'author:le guin, u', label: 'Ursula K. Le Guin', weight: 1 },
    { facet: 'topic:seeds', label: 'seeds', weight: 3 },
    { facet: 'section:100', label: 'the 100 shelves', weight: 1 }
  ], { facet: 'section:100' }), { kind: 'subject', label: 'seeds' },
  'names the strongest shared subject when the author is weaker, not the shelf');
  t.eq(L.bridgePart([{ facet: 'author:osman, r', label: 'Richard Osman', weight: 2 }]),
    { kind: 'author', label: 'Richard Osman' }, 'falls back to a shared author');
  t.eq(L.bridgePart([{ facet: 'topic:war', label: 'war', weight: -4 }]), null, 'a shared subject you did not like is no bridge');
  t.eq(L.bridgePart([]), null, 'an empty shelf has nothing to bridge to');

  // A fantasy-shelf pick must not say it "shares books about fantasy": that is the shelf itself.
  const fantasyPart = { facet: 'section:fantasy', label: 'the fantasy shelves' };
  t.eq(L.bridgePart([
    { facet: 'genre:fantasy', label: 'fantasy', weight: 5 },
    { facet: 'topic:cities', label: 'cities', weight: 2 }
  ], fantasyPart), { kind: 'subject', label: 'cities' }, 'skips a genre that is the part own genre and takes the topic');
  t.eq(L.bridgePart([{ facet: 'genre:fantasy', label: 'fantasy', weight: 5 }], fantasyPart), null,
    'the part own genre alone is no bridge');
  t.eq(L.bridgePart([{ facet: 'genre:literary', label: 'literary', weight: 5 }], { facet: 'section:fiction' }),
    { kind: 'genre', label: 'literary' }, 'falls back to a shared genre that is not the part own');
  t.eq(L.bridgePart([{ facet: 'genre:history', label: 'history', weight: 5 }],
    { facet: 'section:900', label: 'the history shelves (900s)' }), null,
    'the genre a part is named for is no bridge either: 900 is the history shelves');
  t.eq(L.bridgePart([
    { facet: 'genre:history', label: 'history', weight: 5 },
    { facet: 'topic:travel', label: 'travel', weight: 2 }
  ], { facet: 'section:900', label: 'the history shelves (900s)' }), { kind: 'subject', label: 'travel' },
  'takes a topic in the history shelves rather than the history genre');

  // ---- choose, on made-up shelves -------------------------------------------------------------
  // Six parts, each with two books off the shelf: '<n>-a' and '<n>-b'. A shelf entry names the
  // section it stands in; the shelf book itself is '<n>-shelf', which no section holds, so the
  // part still has both of its own books to offer.
  const parts = six.map(s => s.facet);
  function ctxFor(shelfFacets, typed) {
    const works = [];
    const groups = [];
    for (const f of parts) {
      const n = f.slice(8);
      const a = { id: n + '-a', title: 'Book ' + n + ' a', author: 'A', facets: [f] };
      const b = { id: n + '-b', title: 'Book ' + n + ' b', author: 'A', facets: [f] };
      works.push(a, b);
      groups.push({ facet: f, label: 'the ' + n + ' shelves', works: [a, b] });
    }
    const entries = shelfFacets.map((f, i) => {
      const n = f.slice(8);
      return { title: 'Held ' + i, work: { id: n + '-shelf', facets: [f] } };
    });
    for (let i = 0; i < (typed || 0); i++) entries.push({ title: 'Typed ' + i, work: null });
    const on = {};
    for (const e of entries) if (e.work) on[e.work.id] = true;
    return {
      works: works,
      shelf: entries,
      sections: () => groups,
      onShelf: id => !!on[id],
      profile: () => ({}),
      score: w => ({ score: w.id.indexOf('-b') !== -1 ? 2 : 1, parts: [] }),
      labelOf: f => { const g = groups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
      t: say
    };
  }

  const empty = mode.choose.call(mode, ctxFor([]));
  t.eq(empty.picks.length, 6, 'an empty shelf still gives six');
  t.eq(empty.note, mode.strings.emptyShelf, 'an empty shelf says every part is new');
  t.eq(empty.picks[0].why,
    'You have nothing from the 100 shelves. This is where to start: widening, not matching. ' +
    'Nothing on your shelf points here, which is the point.',
    'a widening pick names the part, says it widens rather than matches, and says there is no bridge');
  t.ok(empty.picks[0].why.length <= 200, 'a reason fits in 200 characters');
  t.eq(empty.picks.map(p => p.id), ['100-b', '200-b', '300-b', '400-b', '500-b', '600-b'],
    'each pick is the best book in its own part');

  const oneIn = mode.choose.call(mode, ctxFor(['section:100']));
  t.eq(oneIn.picks.length, 6, 'fills up when five parts are unvisited');
  t.eq(oneIn.note, 'Your shelf has books in 1 of the 6 parts. These start with the parts you ' +
    'never visit, to widen your shelf.', 'says it filled from the parts visited least, to widen the shelf');
  t.eq(oneIn.picks.map(p => p.id), ['200-b', '300-b', '400-b', '500-b', '600-b', '100-b'],
    'the unvisited parts come first, then the part visited least');
  t.ok(oneIn.picks[5].why.indexOf('You have one book from the 100 shelves.') === 0,
    'the fill pick names the part and counts the shelf books there');
  t.ok(oneIn.picks[5].why.indexOf('This is where to start') === -1,
    'a fill pick does not claim to widen: only a part you never visit does');

  const every = mode.choose.call(mode, ctxFor(parts));
  t.eq(every.note, mode.strings.allVisited, 'a shelf that visits every part says so');
  t.eq(every.picks.length, 6, 'a shelf that visits every part still gives six');
  t.eq(every.picks.map(p => p.id), ['100-b', '200-b', '300-b', '400-b', '500-b', '600-b'],
    'a shelf that visits every part picks one book from each part');

  const typed = mode.choose.call(mode, ctxFor([], 2));
  t.eq(typed.note, mode.strings.typedOnly, 'a shelf of typed books says none are in the list');
  t.eq(typed.picks.length, 6, 'a shelf of typed books still gives six, because every part is new');

  // Every book in the list already on the shelf: no picks, and one true sentence.
  const allOn = ctxFor(parts);
  allOn.onShelf = () => true;
  const none = mode.choose.call(mode, allOn);
  t.eq(none.picks.length, 0, 'gives no picks when every book is already on the shelf');
  t.eq(none.note, mode.strings.nothingNew, 'says why there is nothing to show');

  // Eight parts, no shelf: six picks, one per part, and no note about a shortfall.
  const groups = [];
  const allWorks = [];
  for (let i = 0; i < 8; i++) {
    const facet = 'section:' + (100 + i * 100);
    const works = [];
    for (let k = 0; k <= i; k++) {
      const w = { id: facet.slice(8) + '-' + k, title: 'Book ' + i + '-' + k, author: 'A', facets: [facet] };
      works.push(w);
      allWorks.push(w);
    }
    groups.push({ facet: facet, label: 'the ' + (100 + i * 100) + ' shelves', works: works });
  }
  groups.sort((a, b) => (a.facet < b.facet ? -1 : 1));
  const wide = {
    works: allWorks, shelf: [], sections: () => groups, onShelf: () => false,
    profile: () => ({}), score: () => ({ score: 1, parts: [] }),
    labelOf: f => { const g = groups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
    t: say
  };
  const capped = mode.choose.call(mode, wide);
  t.eq(capped.picks.length, 6, 'takes six of eight parts');
  t.eq(capped.note, mode.strings.emptyShelf, 'says the shelf is empty without a second sentence');
  t.eq(capped.picks.map(p => p.id), ['800-0', '700-0', '600-0', '500-0', '400-0', '300-0'],
    'takes the six biggest parts, and the lower id inside each');

  // A list with only three parts and only one work: "one part", not "1 parts".
  const three = {
    works: allWorks.filter(w => Number(w.facets[0].slice(8)) <= 300),
    shelf: [], sections: () => groups.filter(g => Number(g.facet.slice(8)) <= 300),
    onShelf: () => false, profile: () => ({}), score: () => ({ score: 1, parts: [] }),
    labelOf: f => { const g = groups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
    t: say
  };
  const narrow = mode.choose.call(mode, three);
  t.eq(narrow.picks.length, 3, 'gives one book per part when the list has fewer than six parts');
  t.eq(narrow.note, mode.strings.emptyShelf + ' The library list has books in only three parts.',
    'says how many parts the library list has, in words, so one part would read');

  // One part, one book: the same note with a count of one ("only one part").
  const lonely = {
    works: [{ id: 'solo', title: 'Solo', author: 'A', facets: ['section:100'] }],
    shelf: [], sections: () => [groups[0]], onShelf: () => false,
    profile: () => ({}), score: () => ({ score: 1, parts: [] }),
    labelOf: () => groups[0].label, t: say
  };
  const only = mode.choose.call(mode, lonely);
  t.eq(only.note, mode.strings.emptyShelf + ' The library list has books in only one part.',
    'a one-part list says "only one part", not "only 1 parts"');

  // ---- the works left out (docs/modes/survey.md "Usually goes wrong") --------------------------
  // A work is left out when it stands in no part of the library: no call number, or an
  // "ON ORDER" call number, which gives no section either. Counting works that have no
  // callNumber at all would give zero here, and these checks would fail.
  const outCtx = ctxFor([]);
  outCtx.works = outCtx.works.concat([
    { id: 'bare', title: 'No call number', author: 'A', facets: ['genre:true'] }
  ]);
  const oneOut = mode.choose.call(mode, outCtx);
  t.eq(oneOut.note, mode.strings.emptyShelf +
    ' Left out: one book in the list with no part of the library.',
    'counts a work with no part of the library, and writes a count of one so the sentence reads');

  outCtx.works = outCtx.works.concat([
    { id: 'on-order', title: 'On order', author: 'B', callNumber: 'ON ORDER', facets: ['genre:true'] }
  ]);
  const twoOut = mode.choose.call(mode, outCtx);
  t.eq(twoOut.note, mode.strings.emptyShelf +
    ' Left out: two books in the list with no part of the library.',
    'counts an "ON ORDER" work too, because it stands in no part either');

  const noSection = mode.choose.call(mode, {
    works: [{ id: 'a', title: 'A', author: 'A', facets: ['genre:true'] }],
    shelf: [], sections: () => [], onShelf: () => false,
    profile: () => ({}), score: () => ({ score: 0, parts: [] }),
    labelOf: () => '', t: say
  });
  t.eq(noSection.note, mode.strings.noParts, 'says so when no work in the list stands in a part');

  // ---- the few-books note ---------------------------------------------------------------------
  // Two parts share their one book. The first part shows it; the second has no book left to
  // show. The note must not claim the book is not new to the person: it is on screen.
  const shared = { id: 'shared', title: 'One Book', author: 'A', facets: ['section:100', 'section:200'] };
  const sharedGroups = six.map((s, i) => ({
    facet: s.facet,
    label: s.label,
    works: [i < 2 ? shared : { id: s.facet.slice(8) + '-1', title: 'Book ' + i, author: 'A', facets: [s.facet] }]
  }));
  const sharedCtx = {
    works: [shared].concat(sharedGroups.slice(2).map(g => g.works[0])),
    shelf: [], sections: () => sharedGroups, onShelf: () => false,
    profile: () => ({}), score: () => ({ score: 1, parts: [] }),
    labelOf: f => { const g = sharedGroups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
    t: say
  };
  const short = mode.choose.call(mode, sharedCtx);
  t.eq(short.picks.length, 5, 'gives one book fewer when two parts share their only book');
  t.eq(short.note, mode.strings.emptyShelf + ' There was no book left to show you in one part.',
    'says there was no book left to show, not that the book is not new, and writes "one part"');

  // ---- the author bridge, end to end ----------------------------------------------------------
  const leGuinParts = [
    { facet: 'author:le guin, u', label: 'Ursula K. Le Guin', weight: 10 },
    { facet: 'topic:identity', label: 'identity', weight: 4.07 },
    { facet: 'genre:speculative', label: 'speculative fiction', weight: 2 },
    { facet: 'section:100', label: 'the 100 shelves', weight: 1 }
  ];
  const lhGroups = six.map((s, i) => ({
    facet: s.facet,
    label: s.label,
    works: [{ id: i === 0 ? 'left-hand' : s.facet.slice(8) + '-x', title: 'T', author: 'A', facets: [s.facet] }]
  }));
  const lhCtx = {
    works: [], shelf: [{ title: 'Two Le Guin books', work: { id: 'shelf-1', facets: [] } }],
    sections: () => lhGroups,
    onShelf: id => id === 'shelf-1',
    profile: () => ({}),
    score: w => ({ score: w.id === 'left-hand' ? 10 : 1, parts: w.id === 'left-hand' ? leGuinParts : [] }),
    labelOf: f => { const g = lhGroups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
    t: say
  };
  const lh = mode.choose.call(mode, lhCtx);
  t.eq(lh.picks[0].why,
    'You have nothing from the 100 shelves. This is where to start: widening, not matching. ' +
    'It is by Ursula K. Le Guin, whom you rated well.',
    'names a strong author instead of a weaker shared subject');

  // ---- no tautology end to end ---------------------------------------------------------------
  const fantasyGroups = [
    { facet: 'section:fantasy', label: 'the fantasy shelves',
      works: [{ id: 'city', title: 'T', author: 'A', facets: ['section:fantasy'] }] }
  ].concat(six.slice(1).map((s, i) => ({
    facet: s.facet, label: s.label,
    works: [{ id: s.facet.slice(8) + '-y', title: 'T', author: 'A', facets: [s.facet] }]
  })));
  const fantasyCtx = {
    works: [], shelf: [{ title: 'Held', work: { id: 'shelf-2', facets: [] } }],
    sections: () => fantasyGroups,
    onShelf: id => id === 'shelf-2',
    profile: () => ({}),
    score: w => ({ score: 1, parts: w.id === 'city' ? [
      { facet: 'genre:fantasy', label: 'fantasy', weight: 5 },
      { facet: 'topic:cities', label: 'cities', weight: 2 },
      { facet: 'section:fantasy', label: 'the fantasy shelves', weight: 1 }
    ] : [] }),
    labelOf: f => { const g = fantasyGroups.filter(x => x.facet === f)[0]; return g ? g.label : ''; },
    t: say
  };
  const fantasyPick = mode.choose.call(mode, fantasyCtx).picks.filter(p => p.id === 'city')[0];
  t.ok(fantasyPick && fantasyPick.why.indexOf('shares books about cities') !== -1,
    'a pick in a part names a shared subject');
  t.ok(fantasyPick && fantasyPick.why.indexOf('about fantasy') === -1,
    'a pick never says it shares books about the part own genre');
  t.ok(fantasyPick && fantasyPick.why.length <= 200, 'the reason still fits in 200 characters');
});
