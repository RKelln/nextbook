// reference/modes/journey.check.js: checks for the journey mode's pure helpers and its answer.
Nextbook.check('journey', (t, mode) => {
  const L = mode.logic;
  const say = (key, vars) => String(mode.strings[key]).replace(/\{([A-Za-z0-9_]+)\}/g,
    (m, k) => vars && vars[k] !== undefined ? String(vars[k]) : m);

  const labels = {
    'topic:islands': 'islands', 'topic:sea': 'the sea', 'topic:science': 'science',
    'topic:art': 'art', 'genre:speculative': 'speculative fiction', 'genre:true': 'true stories',
    'section:fantasy': 'the fantasy shelves', 'mood:quiet': 'quiet books',
    'pace:slow': 'a slow pace', 'audience:adult': 'adult readers'
  };
  const labelOf = f => (labels[f] !== undefined ? labels[f] : String(f));

  // A similar() built from a table of pairs: 'a|b': {score, shared}. Symmetric, and a pair
  // that is not in the table shares nothing.
  function simOf(rows) {
    const map = {};
    Object.keys(rows).forEach(k => {
      const p = k.split('|');
      map[p[0] + '>' + p[1]] = rows[k];
      map[p[1] + '>' + p[0]] = rows[k];
    });
    return (a, b) => {
      if (a && b && a.id === b.id) return { score: 1, shared: (a.facets || []).slice() };
      const row = map[(a && a.id) + '>' + (b && b.id)];
      return row ? { score: row.score, shared: row.shared.slice() } : { score: 0, shared: [] };
    };
  }

  const S = { id: 's', groupKey: 'book:s', title: 'Start Book' };
  const G = { id: 'goal', title: 'The Goal Book' };
  const A = { id: 'a', title: 'Book A' };
  const A2 = { id: 'a2', title: 'Book A Two' };
  const B = { id: 'b', title: 'Book B' };
  const C = { id: 'c', title: 'Book C' };
  const E = { id: 'e', title: 'Book E' };
  const F = { id: 'f', title: 'Book F' };

  const sim = simOf({
    's|goal': { score: 0.2, shared: ['topic:science'] },
    's|a': { score: 0.9, shared: ['topic:islands'] },
    's|a2': { score: 0.9, shared: ['topic:art'] },
    's|b': { score: 0.1, shared: ['topic:sea'] },
    's|c': { score: 1.0, shared: ['audience:adult'] },
    's|e': { score: 0.95, shared: ['topic:art'] },
    's|f': { score: 1.0, shared: ['topic:islands'] },
    'a|goal': { score: 0.6, shared: ['topic:science'] },
    'a|b': { score: 0.8, shared: ['topic:sea'] },
    'a2|goal': { score: 0.6, shared: ['topic:science'] },
    'b|goal': { score: 0.7, shared: ['topic:science'] },
    'c|goal': { score: 0.9, shared: ['topic:science'] },
    'e|goal': { score: 0.3, shared: [] },
    'f|goal': { score: 0.1, shared: ['topic:science'] }
  });

  // ---- the link facets ------------------------------------------------------------------------
  t.eq(L.weak('audience:adult'), true, 'an audience is not a link');
  t.eq(L.weak('genre:true'), true, 'the "true stories" wrapper is not a link');
  t.eq(L.weak('genre:fiction'), true, 'a plain "fiction" wrapper is not a link');
  t.eq(L.weak('genre:speculative'), false, 'a real kind of book is a link');
  t.eq(L.linkFacets(['audience:adult', 'genre:true', 'topic:islands', 'section:fantasy']),
    ['topic:islands', 'section:fantasy'], 'drops an audience and a broad genre, keeps a subject and a part');
  t.eq(L.linkFacets(['topic:islands', 'topic:islands']), ['topic:islands'], 'a facet counts once');
  t.eq(L.linkFacets(null), [], 'no shared list is no link');

  // ---- nextStep -------------------------------------------------------------------------------
  const graph = [S, A, A2, B, C, F, G];
  t.eq(L.nextStep(S, G, graph, {}, sim).id, 'a', 'takes the strongest neighbour');
  t.eq(L.nextStep(S, G, graph, { a: true }, sim).id, 'a2', 'ties break by id, and a used book is skipped');
  t.eq(L.nextStep(S, G, [S, C, G], {}, sim).id, 'goal',
    'a book that shares only an audience is no step: the goal is nearer');
  t.eq(L.nextStep(S, G, [S, F, G], {}, sim).id, 'goal',
    'a neighbour that moves away from the goal is no step');
  t.eq(L.nextStep(S, G, [S, G], {}, () => ({ score: 0, shared: [] })), null,
    'no shared facet anywhere means no step');
  t.eq(L.nextStep(null, G, graph, {}, sim), null, 'no current book, no step');
  t.eq(L.nextStep(S, G, graph, {}, null), null, 'no similar function, no step');
  t.eq(L.nextStep(S, G, [S, A, G], {}, () => ({ score: 0, shared: ['audience:adult'] })), null,
    'an audience alone never makes a step');

  // ---- walk -----------------------------------------------------------------------------------
  const path = L.walk(S, G, graph, sim, 5);
  t.eq(path.map(s => s.work.id), ['a', 'b', 'goal'], 'each step is the next best neighbour, and the goal ends the path');
  t.eq(path[0].prev.id, 's', 'the first step remembers the book it starts from');
  t.eq(path[1].prev.id, 'a', 'each step remembers the one before it');

  t.eq(L.walk(S, G, [S, C, G], sim, 5).map(s => s.work.id), ['goal'],
    'stops early when the goal is the best next step');
  t.eq(L.walk(S, G, [S, E, G], sim, 1).map(s => s.work.id), ['e'],
    'with the steps used up, a last step that does not link to the goal leaves it out');
  t.eq(L.walk(S, G, [S, A, B, G], sim, 1).map(s => s.work.id), ['a', 'goal'],
    'with one step used, the goal comes last when that step links to it');
  t.eq(L.walk(S, G, [S, G], () => ({ score: 0, shared: [] }), 5), [],
    'a path with no link at all is no steps');
  t.eq(L.walk(null, G, graph, sim, 5), [], 'no start, no path');

  // Six picks at most: five steps and then the goal.
  const chain = [{ id: 'x1', title: 'Step One' }, { id: 'x2', title: 'Step Two' },
    { id: 'x3', title: 'Step Three' }, { id: 'x4', title: 'Step Four' },
    { id: 'x5', title: 'Step Five' }];
  const chainRows = {
    's|goal': { score: 0.2, shared: ['topic:science'] },
    's|x1': { score: 0.9, shared: ['topic:art'] },
    'x1|goal': { score: 0.5, shared: ['topic:science'] },
    'x1|x2': { score: 0.9, shared: ['topic:art'] },
    'x2|goal': { score: 0.6, shared: ['topic:science'] },
    'x2|x3': { score: 0.9, shared: ['topic:art'] },
    'x3|goal': { score: 0.7, shared: ['topic:science'] },
    'x3|x4': { score: 0.9, shared: ['topic:art'] },
    'x4|goal': { score: 0.8, shared: ['topic:science'] },
    'x4|x5': { score: 0.9, shared: ['topic:art'] },
    'x5|goal': { score: 0.9, shared: ['topic:science'] }
  };
  const chainSim = simOf(chainRows);
  const long = L.walk(S, G, [S].concat(chain, [G]), chainSim, 5);
  t.eq(long.length, 6, 'five steps and the goal make six');
  t.eq(long.map(s => s.work.id), ['x1', 'x2', 'x3', 'x4', 'x5', 'goal'], 'the steps are in order, the goal last');

  // ---- stepReason -----------------------------------------------------------------------------
  t.eq(L.stepReason(['topic:islands'], 'The Left Hand of Darkness', labelOf, say),
    'Shares books about islands with The Left Hand of Darkness.',
    'names the subject it shares with the step before');
  t.eq(L.stepReason(['topic:islands', 'topic:sea'], 'The Left Hand of Darkness', labelOf, say),
    'Shares books about islands and the sea with The Left Hand of Darkness.',
    'names two subjects when the two books share two');
  t.eq(L.stepReason(['audience:adult', 'topic:sea'], 'The Left Hand of Darkness', labelOf, say),
    'Shares books about the sea with The Left Hand of Darkness.',
    'never names an audience as the link');
  t.eq(L.stepReason(['genre:true', 'genre:speculative'], 'The Left Hand of Darkness', labelOf, say),
    'Shares the speculative fiction kind of book with The Left Hand of Darkness.',
    'never names the broad "true stories" wrapper as the link');
  t.eq(L.stepReason(['section:fantasy'], 'The Left Hand of Darkness', labelOf, say),
    'Stands on the fantasy shelves with The Left Hand of Darkness.',
    'names the part of the library when that is all they share');
  t.eq(L.stepReason(['mood:quiet'], 'The Left Hand of Darkness', labelOf, say),
    'Shares a quiet mood with The Left Hand of Darkness.',
    'names a shared mood as "a quiet mood"');
  t.eq(L.stepReason(['pace:slow'], 'The Left Hand of Darkness', labelOf, say),
    'Shares a slow pace with The Left Hand of Darkness.', 'names a shared pace');
  t.eq(L.stepReason(['section:fantasy', 'topic:sea'], 'The Left Hand of Darkness', labelOf, say),
    'Shares books about the sea with The Left Hand of Darkness.',
    'puts the subject before the part of the library');
  t.eq(L.stepReason(['audience:adult'], 'The Left Hand of Darkness', labelOf, say),
    'Is the closest book to The Left Hand of Darkness in the library list.',
    'falls back to the rule itself when nothing nameable is shared');
  const longTitle = 'The Left Hand of Darkness and Other Stories From a Long Cold Winter';
  t.ok(L.stepReason(['topic:islands', 'topic:sea'], longTitle, labelOf, say).length <= 200,
    'a reason fits in 200 characters even with a long title');

  // ---- choose, on made-up shelves -------------------------------------------------------------
  function ctxFor(works, similar, opts) {
    const o = opts || {};
    return {
      works: works,
      shelf: o.shelf || [],
      onShelf: id => (o.onShelf || []).indexOf(id) !== -1,
      similar: similar,
      labelOf: labelOf,
      t: say
    };
  }
  const noStart = mode.choose.call(mode, ctxFor(graph, sim), { to: G });
  t.eq(noStart.picks.length, 0, 'no start book gives no picks');
  t.eq(noStart.note, mode.strings.needStart, 'says to pick a book you loved');

  const typed = mode.choose.call(mode, ctxFor(graph, sim),
    { from: { title: 'Typed In', work: null }, to: G });
  t.eq(typed.note, mode.strings.typedStart, 'a book typed in has no neighbours, and the mode says so');

  const twin = { id: 's2', groupKey: 'book:s', title: 'Start Book (another record)' };
  const sameTwin = mode.choose.call(mode, ctxFor(graph, sim), { from: { work: S }, to: twin });
  t.eq(sameTwin.note, mode.strings.sameBook, 'two records of one book at both ends are the same book');

  const same = mode.choose.call(mode, ctxFor(graph, sim), { from: { work: S }, to: S });
  t.eq(same.picks.length, 0, 'the same book at both ends makes no path');
  t.eq(same.note, mode.strings.sameBook, 'the same book at both ends says so');

  const walked = mode.choose.call(mode, ctxFor([S, A, B, G], sim), { from: { work: S }, to: G });
  t.eq(walked.picks.map(p => p.id), ['a', 'b', 'goal'], 'the answer is the path, in order');
  t.eq(walked.picks.map(p => p.step), ['Step 1', 'Step 2', 'The goal'],
    'each step carries its words, and the last is "The goal"');
  t.eq(walked.picks[0].why, 'Shares books about islands with Start Book.',
    'the first step says what it shares with the book you loved');
  t.eq(walked.picks[1].why, 'Shares books about the sea with Book A.',
    'a middle step names the step before it');
  t.eq(walked.picks[2].why, 'The goal. Shares books about science with Book B.',
    'the goal step says it is the goal and names the link');
  t.eq(walked.note, undefined, 'a path that reaches the goal needs no note');
  t.ok(walked.picks.every(p => p.why.length <= 200), 'every reason fits in 200 characters');

  // A path that breaks keeps the steps it found and says where.
  const broken = mode.choose.call(mode, ctxFor([S, E, G], sim), { from: { work: S }, to: G });
  t.eq(broken.picks.map(p => p.id), ['e'], 'a broken path shows the step it found');
  t.eq(broken.note, say('noLink', { title: 'Book E' }),
    'says no book links the last step to the next one');

  const stuck = mode.choose.call(mode, ctxFor([S, G], () => ({ score: 0, shared: [] })),
    { from: { work: S }, to: G });
  t.eq(stuck.picks.length, 0, 'nothing to walk to gives no picks');
  t.eq(stuck.note, say('noLink', { title: 'Start Book' }), 'says where the path broke');

  // A book already on the shelf is not a waypoint, but the goal may be on it as "want".
  const shelved = mode.choose.call(mode, ctxFor([S, A, G], sim, { onShelf: ['a', 'goal'] }),
    { from: { work: S }, to: G });
  t.eq(shelved.picks.map(p => p.id), ['goal'], 'skips a shelf book on the way, and still ends on a shelf goal');

  // Five steps and the goal: six picks, no seventh.
  const full = mode.choose.call(mode, ctxFor([S].concat(chain, [G]), chainSim), { from: { work: S }, to: G });
  t.eq(full.picks.length, 6, 'gives six at most');
  t.eq(full.picks.map(p => p.step), ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'The goal'],
    'the step words count up and then say "The goal"');
  t.ok(full.picks[0].why.indexOf('Start Book') !== -1, 'the first step names the book the path starts from');

  // The step labels are the mode's own words, never a bare number.
  t.ok(full.picks.every(p => typeof p.step === 'string' && p.step.length > 0),
    'every step has words of its own');
  t.ok(mode.shape === 'path', 'the mode is a path, so the app draws the steps in order');
  t.ok(mode.allowShelf === true, 'the goal may be a book already on the shelf');
});
