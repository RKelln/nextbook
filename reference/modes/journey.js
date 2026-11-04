// reference/modes/journey.js: T6.2. Built to docs/modes/journey.md.
// A path from a book you loved to one you have been avoiding: each step a neighbour of the
// last, and every step at least as close to the goal as the one before.
Nextbook.mode({
  id: 'journey',
  name: 'Journey',
  purpose: 'A path from a book you loved to one you have been avoiding, each step a neighbour of the last.',
  shape: 'path',
  allowShelf: true,
  inputs: [
    { id: 'from', kind: 'shelf-book', label: 'Start from a book you loved' },
    { id: 'to', kind: 'book', label: 'The book you have been avoiding' }
  ],
  strings: {
    needStart: 'Pick a book you loved to start from.',
    typedStart: 'That book is not in the library list, so I cannot see its neighbours. Pick one the library has.',
    noGoal: 'Pick the book you have been avoiding, and the path will end there.',
    sameBook: 'That is the same book at both ends. Pick a different goal.',
    noLink: 'No book in the list links {title} to the next step.',
    stepWord: 'Step {n}',
    goalWord: 'The goal',
    goalIntro: 'The goal.',
    stepTopic: 'Shares books about {a} with {title}.',
    stepTopics: 'Shares books about {a} and {b} with {title}.',
    stepGenre: 'Shares the {genre} kind of book with {title}.',
    stepSeries: 'Is in the {series} with {title}.',
    stepPart: 'Stands on {part} with {title}.',
    stepMood: 'Shares a {mood} mood with {title}.',
    stepPace: 'Shares {pace} with {title}.',
    stepNear: 'Is the closest book to {title} in the library list.'
  },
  logic: {
    // A shared facet that says nothing about why the next step is a step. An audience is not
    // a subject, and the broad "fiction" or "true stories" wrapper is not a direction
    // (docs/modes/journey.md, "Usually goes wrong"). Leave them out of a link.
    weak(facet) {
      const key = typeof facet === 'string' ? facet : '';
      if (key.indexOf('audience:') === 0) return true;
      return key === 'genre:fiction' || key === 'genre:true';
    },

    // The shared facets that make a real link, in the order similar() gave them, no repeats.
    linkFacets(shared) {
      const out = [];
      const list = Array.isArray(shared) ? shared : [];
      for (const f of list) {
        if (typeof f !== 'string' || this.weak(f) || out.indexOf(f) !== -1) continue;
        out.push(f);
      }
      return out;
    },

    // The best next step from `current` towards `goal`, or null when nothing links.
    // A candidate must share a real facet with this book, stand no further from the goal
    // than this book does, and not be visited. Ties go to the lower id, so the path repeats.
    nextStep(current, goal, works, visited, similar) {
      if (!current || !goal || typeof similar !== 'function') return null;
      const here = similar(current, goal).score;
      let best = null, top = -Infinity;
      const list = Array.isArray(works) ? works : [];
      for (const w of list) {
        if (!w || !w.id) continue;
        if (w.id === current.id) continue;
        if (visited && visited[w.id]) continue;
        if (!(similar(w, goal).score >= here)) continue;    // only a move towards the goal
        const link = similar(current, w);
        if (!this.linkFacets(link.shared).length) continue; // only a real neighbour
        if (link.score > top || (link.score === top && best && String(w.id) < String(best.id))) {
          best = w;
          top = link.score;
        }
      }
      return best;
    },

    // The steps, in order: up to `max` of them, then the goal as the last one. The goal also
    // ends the path as soon as it is the best next step, and a path that stalls stops where
    // it stalled instead of jumping to the goal.
    walk(start, goal, works, similar, max) {
      const steps = [];
      if (!start || !goal || typeof similar !== 'function') return steps;
      const cap = max > 0 ? Math.floor(max) : 0;
      const visited = {};
      let cur = start;
      visited[cur.id] = true;
      while (steps.length < cap) {
        const next = this.nextStep(cur, goal, works, visited, similar);
        if (!next) break;
        steps.push({ work: next, prev: cur });
        if (next.id === goal.id) return steps;
        visited[next.id] = true;
        cur = next;
      }
      // The steps are used up: the goal still comes last, when the last step links to it.
      if (steps.length && steps.length >= cap) {
        const last = steps[steps.length - 1].work;
        if (last.id !== goal.id && this.linkFacets(similar(last, goal).shared).length) {
          steps.push({ work: goal, prev: last });
        }
      }
      return steps;
    },

    // The words for one link: what this step shares with the step before. A subject is the
    // best thing to name; then the kind of book, the series, the part of the library, the
    // mood, then the pace. `t` is ctx.t, so every word lives in the strings table.
    stepReason(shared, prevTitle, labelOf, t) {
      const list = this.linkFacets(shared);
      const label = typeof labelOf === 'function' ? labelOf : function (f) { return String(f); };
      const say = typeof t === 'function' ? t : function (k) { return k; };
      const title = String(prevTitle || '');
      const word = function (f) { return String(label(f) || ''); };
      const of = function (kind) {
        return list.filter(function (f) { return f.indexOf(kind + ':') === 0; });
      };
      const topics = of('topic');
      if (topics.length > 1) return say('stepTopics', { a: word(topics[0]), b: word(topics[1]), title: title });
      if (topics.length === 1) return say('stepTopic', { a: word(topics[0]), title: title });
      const kinds = of('genre').concat(of('bisac'));
      if (kinds.length) return say('stepGenre', { genre: word(kinds[0]), title: title });
      const series = of('series');
      if (series.length) return say('stepSeries', { series: word(series[0]), title: title });
      const parts = of('section');
      if (parts.length) return say('stepPart', { part: word(parts[0]), title: title });
      const moods = of('mood');
      if (moods.length) return say('stepMood', { mood: this.moodWord(word(moods[0])), title: title });
      const paces = of('pace');
      if (paces.length) return say('stepPace', { pace: word(paces[0]), title: title });
      return say('stepNear', { title: title });
    },

    // The bare mood word: "quiet books" is "quiet" in a sentence.
    moodWord(label) {
      return String(label || '').replace(/\s*books\s*$/i, '');
    }
  },
  choose(ctx, input) {
    const L = this.logic;
    const given = input || {};
    const entry = given.from || null;
    const start = entry && entry.work ? entry.work : null;
    const goal = given.to && given.to.id ? given.to : null;

    if (!entry) return { picks: [], note: ctx.t('needStart') };
    if (!start) return { picks: [], note: ctx.t('typedStart') };
    if (!goal) return { picks: [], note: ctx.t('noGoal') };
    if (start.id === goal.id || (start.groupKey && start.groupKey === goal.groupKey)) {
      return { picks: [], note: ctx.t('sameBook') };
    }

    // A step is a book to read next, so the ones already on the shelf are not waypoints;
    // the goal itself may be on the shelf as "want", which is why allowShelf is set.
    const works = ctx.works.filter(function (w) {
      return w && w.id && (!ctx.onShelf(w.id) || w.id === goal.id);
    });

    const steps = L.walk(start, goal, works, ctx.similar, 5);
    if (!steps.length) return { picks: [], note: ctx.t('noLink', { title: start.title }) };

    const picks = [];
    for (let i = 0; i < steps.length; i++) {
      const here = steps[i];
      const isGoal = here.work.id === goal.id;
      const why = L.stepReason(ctx.similar(here.prev, here.work).shared, here.prev.title,
        ctx.labelOf, ctx.t);
      picks.push({
        id: here.work.id,
        why: isGoal ? ctx.t('goalIntro') + ' ' + why : why,
        step: isGoal ? ctx.t('goalWord') : ctx.t('stepWord', { n: i + 1 })
      });
    }

    // A path that never reaches the goal shows the steps it found and says where it broke.
    const last = picks[picks.length - 1];
    if (last.id !== goal.id) {
      return { picks: picks, note: ctx.t('noLink', { title: steps[steps.length - 1].work.title }) };
    }
    return { picks: picks };
  }
});
