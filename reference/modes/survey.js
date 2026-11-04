// reference/modes/survey.js: T6.1, the facilitator's demo. Built to docs/modes/survey.md.
// One book from each part of the library the shelf never visits: coverage, not matching.
Nextbook.mode({
  id: 'survey',
  name: 'Survey',
  purpose: 'One book from each part of the library your shelf never visits.',
  shape: 'list',
  inputs: [],
  strings: {
    emptyShelf: 'Your shelf is empty, so every part of the library is new.',
    typedOnly: 'None of your books are in the library list, so every part of the library is new.',
    allVisited: 'You have a book from every part of the library. These start with the parts you visit least.',
    someVisited: 'Your shelf has books in {n} of the {total} parts. These start with the parts you never visit, to widen your shelf.',
    fewParts: 'The library list has books in only {n}.',
    fewBooks: 'There was no book left to show you in {n}.',
    leftOut: 'Left out: {n} in the list with no part of the library.',
    noParts: 'The library list has no parts to survey.',
    nothingNew: 'The parts you visit least have nothing new for you: every book in them is on your shelf.',
    whyNew: 'You have nothing from {part}.',
    whyThin: 'You have {n} from {part}.',
    widen: 'This is where to start: widening, not matching.',
    bridge: 'This one shares books about {topic} with your shelf.',
    bridgeGenre: 'This one shares the {label} kind of book with your shelf.',
    bridgeAuthor: 'It is by {author}, whom you rated well.',
    noBridge: 'Nothing on your shelf points here, which is the point.'
  },
  logic: {
    // The parts of the library a work stands in: its section facets, without repeats.
    sectionFacets(work) {
      const out = [];
      const facets = work && Array.isArray(work.facets) ? work.facets : [];
      for (const f of facets) {
        if (typeof f === 'string' && f.indexOf('section:') === 0 && out.indexOf(f) === -1) out.push(f);
      }
      return out;
    },

    // A count in words for a sentence: howMany(1) is "one book", howMany(12) "12 books",
    // howMany(1, 'part') "one part". The noun defaults to books, which is what most notes count.
    howMany(n, noun) {
      const ones = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
      const i = Math.floor(Number(n));
      const word = String(noun || 'book');
      const plural = /s$/.test(word) ? word : word + 's';
      const base = !isFinite(i) || i < 0 ? 'no' : (i < ones.length ? ones[i] : String(i));
      return base + ' ' + (i === 1 ? plural.slice(0, -1) : plural);
    },

    // {sectionFacet: how many shelf books stand there}. A book typed in has no work, so it
    // counts nowhere; a work with two call numbers counts once in each part.
    visitCounts(shelf, sections) {
      const counts = {};
      for (const s of sections || []) counts[s.facet] = 0;
      for (const e of shelf || []) {
        const work = e && e.work;
        if (!work) continue;
        for (const f of this.sectionFacets(work)) {
          if (!(f in counts)) counts[f] = 0;
          counts[f] += 1;
        }
      }
      return counts;
    },

    // The parts with no shelf book, biggest first, ties by facet key.
    unvisited(counts, sections) {
      const list = (sections || []).filter(s => !(counts[s.facet] > 0));
      list.sort((a, b) => (b.works.length - a.works.length) ||
        (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0));
      return list.map(s => s.facet);
    },

    // Every part, fewest shelf books first, then the biggest part, then the key.
    leastVisited(counts, sections) {
      return (sections || []).slice().sort((a, b) =>
        ((counts[a.facet] || 0) - (counts[b.facet] || 0)) ||
        (b.works.length - a.works.length) ||
        (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0));
    },

    // The friendliest door into one part: the best score among works not on the shelf,
    // ties to the lower id. `used` holds ids already taken by another part.
    bestIn(section, ctx, profile, used) {
      const works = section && Array.isArray(section.works) ? section.works : [];
      let best = null, top = -Infinity;
      for (const w of works) {
        if (!w || ctx.onShelf(w.id) || (used && used[w.id])) continue;
        const s = ctx.score(w, profile).score;
        if (s > top || (s === top && best && String(w.id) < String(best.id))) {
          best = w;
          top = s;
        }
      }
      return best;
    },

    // The bridge a reason may name. An author at the top is the strongest evidence there is
    // (two books by them beat one shared subject), so it is named rather than passed over.
    // Otherwise a shared topic wins, then a shared genre: never one the part itself is named
    // for, because "a fantasy pick shares books about fantasy" says nothing.
    bridgePart(parts, section) {
      const good = (parts || []).filter(p => p && p.weight > 0 && typeof p.facet === 'string')
        .slice().sort((a, b) => (b.weight - a.weight) ||
          (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0));
      if (!good.length) return null;
      const key = section && typeof section.facet === 'string' ? section.facet.slice(8).replace(/-/g, ' ') : '';
      const words = section && typeof section.label === 'string'
        ? section.label.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter(Boolean) : [];
      if (good[0].facet.indexOf('author:') === 0) return { kind: 'author', label: good[0].label };
      for (const p of good) if (p.facet.indexOf('topic:') === 0) return { kind: 'subject', label: p.label };
      for (const p of good) {
        if (p.facet.indexOf('genre:') !== 0 && p.facet.indexOf('bisac:') !== 0) continue;
        const label = String(p.label).toLowerCase();
        if (key && label === key) continue;
        const own = label.split(' ');
        if (words.length && own.every(w => words.indexOf(w) !== -1)) continue;
        return { kind: 'genre', label: p.label };
      }
      for (const p of good) if (p.facet.indexOf('author:') === 0) return { kind: 'author', label: p.label };
      return null;
    }
  },
  choose(ctx) {
    const L = this.logic;
    const sections = ctx.sections();
    if (!sections.length) return { picks: [], note: ctx.t('noParts') };

    const counts = L.visitCounts(ctx.shelf, sections);
    const profile = ctx.profile();
    const byFacet = {};
    for (const s of sections) byFacet[s.facet] = s;

    const openKeys = L.unvisited(counts, sections);
    const order = [];
    for (const key of openKeys) {
      if (order.length >= 6) break;
      order.push({ section: byFacet[key], fresh: true });
    }
    let filled = false;
    if (order.length < 6) {
      for (const s of L.leastVisited(counts, sections)) {
        if (order.length >= 6) break;
        if (openKeys.indexOf(s.facet) !== -1) continue;
        order.push({ section: s, fresh: false });
        filled = true;
      }
    }

    const used = {};
    const picks = [];
    for (const item of order) {
      const work = L.bestIn(item.section, ctx, profile, used);
      if (!work) continue;
      used[work.id] = true;
      const part = item.section.label || ctx.labelOf(item.section.facet) || item.section.facet;
      const bridge = L.bridgePart(ctx.score(work, profile).parts, item.section);
      const why = [
        item.fresh
          ? ctx.t('whyNew', { part: part })
          : ctx.t('whyThin', { part: part, n: L.howMany(counts[item.section.facet] || 0) }),
        item.fresh ? ctx.t('widen') : '',
        bridge
          ? ctx.t(bridge.kind === 'author' ? 'bridgeAuthor' : bridge.kind === 'genre' ? 'bridgeGenre' : 'bridge',
            { topic: bridge.label, author: bridge.label, label: bridge.label })
          : ctx.t('noBridge')
      ];
      picks.push({ id: work.id, why: why.filter(s => s).join(' ') });
    }

    const shelfBooks = ctx.shelf.filter(e => e && e.work).length;
    const typed = ctx.shelf.length - shelfBooks;
    // A work is left out when it has no section facet. That covers a list entry with no call
    // number, and an "ON ORDER" call number, which gives no section either (docs/DATA.md).
    const leftOut = ctx.works.filter(w => !L.sectionFacets(w).length).length;
    const notes = [];
    if (!shelfBooks) notes.push(typed ? ctx.t('typedOnly') : ctx.t('emptyShelf'));
    else if (!openKeys.length) notes.push(ctx.t('allVisited'));
    else if (filled) notes.push(ctx.t('someVisited', { n: sections.length - openKeys.length, total: sections.length }));
    if (sections.length < 6) notes.push(ctx.t('fewParts', { n: L.howMany(sections.length, 'part') }));
    // A part that produced no pick had no book left to show: every work in it is on the shelf,
    // or was already picked for another part it also stands in. Both are true of this sentence.
    if (picks.length < order.length) notes.push(ctx.t('fewBooks', { n: L.howMany(order.length - picks.length, 'part') }));
    if (leftOut) notes.push(ctx.t('leftOut', { n: L.howMany(leftOut) }));

    if (!picks.length) {
      const tail = [ctx.t('nothingNew')];
      if (leftOut) tail.push(ctx.t('leftOut', { n: L.howMany(leftOut) }));
      return { picks: [], note: tail.join(' ') };
    }
    return notes.length ? { picks: picks, note: notes.join(' ') } : { picks: picks };
  }
});
