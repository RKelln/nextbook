Nextbook.check('more-by', (t, mode) => {
  const L = mode.logic;
  const e = L.likedAuthors([
    { title: 'A', rating: 'liked', work: { authorKey: 'x' } },
    { title: 'B', rating: 'loved', work: { authorKey: 'x' } }]);
  t.eq(e.x.title, 'B', 'keeps the loved book when an author has two');
  t.eq(L.likedAuthors([{ title: 'C', rating: 'loved', work: null }]), {}, 'ignores books typed in');
  t.ok(mode.strings.noAuthors, 'has the sentence for an empty shelf');

  // choose, on a tiny shelf and list: the sort, the shelf rule and the sentence.
  const works = [
    { id: 'a-old-on-shelf', title: 'Older On Shelf', author: 'Author A', authorKey: 'a', year: 1990 },
    { id: 'a-older', title: 'Older', author: 'Author A', authorKey: 'a', year: 2000 },
    { id: 'a-newer', title: 'Newer', author: 'Author A', authorKey: 'a', year: 2010 },
    { id: 'b-book', title: 'Someone Else', author: 'Author B', authorKey: 'b', year: 2020 }
  ];
  const shelf = [{ title: 'Old One', rating: 'loved', work: { authorKey: 'a' } }];
  const say = (key, vars) => String(mode.strings[key]).replace(/\{([A-Za-z0-9_]+)\}/g,
    (m, k) => vars && vars[k] !== undefined ? String(vars[k]) : m);
  const ctx = { shelf, works, onShelf: id => id === 'a-old-on-shelf', t: say };
  const r = mode.choose.call(mode, ctx);
  t.eq(r.picks.map(p => p.id), ['a-newer', 'a-older'], 'puts the newest book by a liked author first');
  t.ok(r.picks.every(p => p.id !== 'a-old-on-shelf'), 'leaves off a book that is already on the shelf');
  t.ok(r.picks.every(p => p.id !== 'b-book'), 'leaves off an author the person did not rate well');
  t.ok(!!r.picks[0] && r.picks[0].why.indexOf('Author A') !== -1 && r.picks[0].why.indexOf('Old One') !== -1,
    'names the author and the shelf book in the reason');
  t.ok(!!r.note && /has 2 more/.test(r.note), 'says how many it found when fewer than six');

  // Six is enough: no note needed, because nothing was held back.
  const many = [];
  for (let i = 0; i < 7; i++) {
    many.push({ id: 'a-' + i, title: 'Book ' + i, author: 'Author A', authorKey: 'a', year: 2000 + i });
  }
  const six = mode.choose.call(mode, { shelf, works: many, onShelf: () => false, t: say });
  t.eq(six.picks.length, 6, 'takes six and leaves the rest');
  t.ok(!six.note, 'says nothing extra when it found six');
});
