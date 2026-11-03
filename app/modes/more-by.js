// app/modes/more-by.js: the example. It is not on the menu, on purpose.
Nextbook.mode({
  id: 'more-by',
  name: 'More by them',
  purpose: 'Other books by authors you rated well.',
  shape: 'list',
  inputs: [],
  strings: {
    noAuthors: 'Rate a book "loved" or "liked" first. This finds more by those authors.',
    nothingMore: 'The library list has nothing else by the authors you rated well.',
    fewBooks: 'The library list has {n} more by the authors you rated well.',
    why: 'You rated {author} well. You gave {book} a "{rating}".'
  },
  logic: {
    // Pure: the same input always gives the same output. No ctx, no dates, no random.
    likedAuthors(entries) {
      const out = {};
      for (const e of entries) {
        if (!e.work || (e.rating !== 'loved' && e.rating !== 'liked')) continue;
        const key = e.work.authorKey;
        if (!out[key] || e.rating === 'loved') out[key] = e;
      }
      return out;
    }
  },
  choose(ctx) {
    const liked = this.logic.likedAuthors(ctx.shelf);
    if (!Object.keys(liked).length) return { picks: [], note: ctx.t('noAuthors') };
    const picks = ctx.works
      .filter(w => liked[w.authorKey] && !ctx.onShelf(w.id))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.id < b.id ? -1 : 1))
      .slice(0, 6)
      .map(w => {
        const e = liked[w.authorKey];
        return { id: w.id, why: ctx.t('why', { author: w.author, book: e.title, rating: e.rating }) };
      });
    return picks.length
      ? (picks.length < 6 ? { picks, note: ctx.t('fewBooks', { n: picks.length }) } : { picks })
      : { picks: [], note: ctx.t('nothingMore') };
  }
});
