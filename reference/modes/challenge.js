// reference/modes/challenge.js: T6.3. Built to docs/modes/challenge.md.
// Books on the subjects you read, from the other side: the other kind of book, and the other
// mood. Only what the shelf says yes to is used, and nothing is said against the person.
Nextbook.mode({
  id: 'challenge',
  name: 'Challenge',
  purpose: 'Books on the subjects you read, from the other side: books that would argue with you.',
  shape: 'list',
  inputs: [],
  strings: {
    needsRated: 'Rate a book "loved" or "liked" first. This finds books that would argue with you.',
    noTopics: 'There are no subjects on your shelf yet, so there is nothing to argue with. Rate a book "loved" or "liked".',
    nothing: 'No book in the list takes the other side of your shelf yet.',
    noShelfSide: 'No book of the other kind fits your subjects, so these all come from the other mood.',
    noMoodSide: 'No book with a different mood was left to show, so these all come from the other shelf.',
    noMoods: 'Your shelf has no mood words yet, so these all come from the other shelf.',
    fewBooks: 'The list has only {n} that would argue with your shelf.',
    skipped: 'Left out {n} with no mood words.',
    skippedNone: 'No book was left out for having no mood words.',
    groupShelf: 'The other shelf',
    groupMood: 'The other mood',
    whyShelf: 'You read {reads} about {topic}. This is {other} about {topic}.',
    whyMood1: 'Your shelf leans {mood}. This one is about {topic}, but not {mood}.',
    whyMood2: 'Your shelf leans {a} and {b}. This one is about {topic}, but not {a} or {b}.',
    readsFiction: 'novels',
    readsNonFiction: 'non-fiction',
    isFiction: 'a novel',
    isNonFiction: 'non-fiction'
  },
  logic: {
    // An entry is evidence only when the person said something good about it. A "not for me"
    // is evidence too, but never a subject to argue with (docs/modes/challenge.md).
    positive(entry) {
      if (!entry) return false;
      if (entry.rating === 'not-for-me') return false;
      if (entry.state === 'want') return false;
      if (entry.rating === 'loved' || entry.rating === 'liked' || entry.rating === 'ok') return true;
      return entry.state === 'read' || entry.state === 'reading';
    },

    // The kind of book the shelf reads least, from the books it says something good about.
    // A tie goes to non-fiction, which is the one a shelf of readers is least likely to hold.
    leastRead(shelf) {
      let fiction = 0, nonfiction = 0;
      for (const e of shelf || []) {
        if (!this.positive(e) || !e.work) continue;
        const type = String(e.work.contentType || '');
        if (type === 'FICTION') fiction += 1;
        else if (type === 'NONFICTION') nonfiction += 1;
      }
      return fiction < nonfiction ? 'FICTION' : 'NONFICTION';
    },

    // The strongest subjects on the shelf, best first, ties by facet. Only a subject the shelf
    // reads with a positive weight counts: the mode argues with what the person chose.
    topTopics(profile, n) {
      const weights = (profile && profile.weights) || {};
      const list = [];
      for (const key of Object.keys(weights)) {
        if (key.indexOf('topic:') !== 0 || !(weights[key] > 0)) continue;
        list.push({ facet: key, weight: weights[key] });
      }
      list.sort((a, b) => (b.weight - a.weight) ||
        (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0));
      const take = n > 0 ? n : 0;
      return list.slice(0, take).map(x => x.facet);
    },

    // The moods the shelf's good books have most often, most common first, ties by word.
    // A work's moods come from moodsOf: its own mood: facets, then tagsOf.
    topMoods(shelf, tagsOf, n) {
      const counts = {};
      for (const e of shelf || []) {
        if (!this.positive(e) || !e.work || typeof tagsOf !== 'function') continue;
        for (const mood of this.moodsOf(e.work, tagsOf)) counts[mood] = (counts[mood] || 0) + 1;
      }
      const words = Object.keys(counts);
      words.sort((a, b) => (counts[b] - counts[a]) || (a < b ? -1 : a > b ? 1 : 0));
      const take = n > 0 ? n : 0;
      return words.slice(0, take);
    },

    // Our own words for a work's mood, lower case, without repeats. The pool writes them on
    // the work as mood: facets (from data/tags.json), so those are read first; tagsOf is asked
    // too, because a mode should not care which of the two the app hands it.
    moodsOf(work, tagsOf) {
      const out = [];
      if (!work) return out;
      const facets = Array.isArray(work.facets) ? work.facets : [];
      for (const f of facets) {
        if (typeof f !== 'string' || f.indexOf('mood:') !== 0) continue;
        const own = f.slice(5);
        if (own && out.indexOf(own) === -1) out.push(own);
      }
      const tags = typeof tagsOf === 'function' ? tagsOf(work) : null;
      const list = tags && Array.isArray(tags.mood) ? tags.mood : [];
      for (const m of list) {
        const word = String(m || '').toLowerCase().replace(/^\s+|\s+$/g, '');
        if (word && out.indexOf(word) === -1) out.push(word);
      }
      return out;
    },

    // The other side of one subject: the work has the subject and the other kind of book.
    opposite(work, topic, otherType) {
      if (!work || !Array.isArray(work.facets) || !topic) return false;
      if (String(work.contentType || '') !== String(otherType || '')) return false;
      return work.facets.indexOf(topic) !== -1;
    },

    // The strongest subject of `topics` that a work shares, or '' when it shares none.
    sharedTopic(work, topics) {
      if (!work || !Array.isArray(work.facets)) return '';
      for (const topic of topics || []) {
        if (work.facets.indexOf(topic) !== -1) return topic;
      }
      return '';
    },

    // Does one of these moods sit on the work? A mood it shares is the mood the shelf likes.
    hasAnyMood(work, moods, tagsOf) {
      const mine = this.moodsOf(work, tagsOf);
      for (const mood of moods || []) if (mine.indexOf(mood) !== -1) return true;
      return false;
    },

    // A count in words: howMany(1) is "one book", howMany(4) "four books".
    howMany(n) {
      const ones = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
      const i = Math.floor(Number(n));
      const base = !isFinite(i) || i < 0 ? 'no' : (i < ones.length ? ones[i] : String(i));
      return base + ' ' + (i === 1 ? 'book' : 'books');
    },

    // Best score first, then the lower id, so the same shelf gives the same list.
    byScore(a, b) {
      const x = a && typeof a.score === 'number' ? a.score : 0;
      const y = b && typeof b.score === 'number' ? b.score : 0;
      if (y !== x) return y - x;
      const ax = String(a && a.work ? a.work.id : '');
      const bx = String(b && b.work ? b.work.id : '');
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    }
  },
  choose(ctx) {
    const L = this.logic;
    const profile = ctx.profile();
    if (!profile || !profile.rated) return { picks: [], note: ctx.t('needsRated') };

    const topics = L.topTopics(profile, 3);
    if (!topics.length) return { picks: [], note: ctx.t('noTopics') };

    // The other shelf: for each of the three strongest subjects, the works on that subject in
    // the kind of book the shelf reads least. One pool, best score first.
    const otherType = L.leastRead(ctx.shelf);
    const shelfSide = [];
    for (const w of ctx.works) {
      if (!w || !w.id || ctx.onShelf(w.id)) continue;
      const topic = L.sharedTopic(w, topics);
      if (!topic || !L.opposite(w, topic, otherType)) continue;
      shelfSide.push({ work: w, topic: topic, score: ctx.score(w, profile).score });
    }
    shelfSide.sort(L.byScore);

    // The other mood: a subject the shelf reads, a book we have our own words for, and neither
    // of the shelf's two most common moods on it.
    const moods = L.topMoods(ctx.shelf, ctx.tagsOf, 2);
    const allTopics = L.topTopics(profile, 99);
    const moodSide = [];
    const noMoodWords = [];
    if (moods.length) {
      for (const w of ctx.works) {
        if (!w || !w.id || ctx.onShelf(w.id)) continue;
        const topic = L.sharedTopic(w, allTopics);
        if (!topic) continue;
        if (!L.moodsOf(w, ctx.tagsOf).length) { noMoodWords.push(w.id); continue; }
        if (L.hasAnyMood(w, moods, ctx.tagsOf)) continue;
        moodSide.push({ work: w, topic: topic, score: ctx.score(w, profile).score });
      }
      moodSide.sort(L.byScore);
    }

    // Three of each kind; a kind that finds nothing is filled from the other one.
    let shelfTake = 3, moodTake = 3;
    if (!shelfSide.length) { shelfTake = 0; moodTake = 6; }
    else if (!moodSide.length) { shelfTake = 6; moodTake = 0; }

    const readsWord = otherType === 'NONFICTION' ? ctx.t('readsFiction') : ctx.t('readsNonFiction');
    const otherWord = otherType === 'NONFICTION' ? ctx.t('isNonFiction') : ctx.t('isFiction');
    const used = {};
    const picks = [];
    for (const c of shelfSide.slice(0, shelfTake)) {
      used[c.work.id] = true;
      picks.push({
        id: c.work.id,
        group: ctx.t('groupShelf'),
        why: ctx.t('whyShelf', { reads: readsWord, other: otherWord, topic: ctx.labelOf(c.topic) })
      });
    }
    let taken = 0;
    for (const c of moodSide) {
      if (taken >= moodTake) break;
      if (used[c.work.id]) continue;
      used[c.work.id] = true;
      taken += 1;
      picks.push({
        id: c.work.id,
        group: ctx.t('groupMood'),
        why: moods.length > 1
          ? ctx.t('whyMood2', { a: moods[0], b: moods[1], topic: ctx.labelOf(c.topic) })
          : ctx.t('whyMood1', { mood: moods[0], topic: ctx.labelOf(c.topic) })
      });
    }

    const notes = [];
    if (!shelfSide.length && taken > 0) notes.push(ctx.t('noShelfSide'));
    if (!taken && picks.length) notes.push(moods.length ? ctx.t('noMoodSide') : ctx.t('noMoods'));
    if (moods.length) {
      // A work already shown is not left out, so only the ones the list cannot judge are counted.
      const left = noMoodWords.filter(id => !used[id]);
      notes.push(left.length ? ctx.t('skipped', { n: L.howMany(left.length) }) : ctx.t('skippedNone'));
    }
    if (!picks.length) notes.push(ctx.t('nothing'));
    else if (picks.length < 6) notes.push(ctx.t('fewBooks', { n: L.howMany(picks.length) }));

    return notes.length ? { picks: picks, note: notes.join(' ') } : { picks: picks };
  }
});
