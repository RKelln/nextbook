# Probes

Throwaway scripts that checked a claim. They are not the product and never ship with the app.

| Script | What it answers |
|---|---|
| `record_fields.py <recordId>` | What a catalogue record page actually carries right now, field by field |
| `search_bibs.py "<query>"` | How many records one search page returns, and how many come with subjects and descriptions |
| `search_fields.py "<query>"` | Which fields the slice builder reads are filled on a search page, and the common headings |

Both are standard library only, print what they find, and write nothing. Run them before trusting `docs/DATA.md`; if a
field has moved, correct that document in place and note the change in `docs/RESEARCH.md`.

Each makes one request. The catalogue's `robots.txt` asks for two minutes between requests (`Crawl-delay: 120`), so
leave that gap between runs.

Two habits worth keeping when adding a probe:

- Print the count as well as the content. "It worked" is not a measurement; "63 records, 20 distinct groupKeys" is.
- Never probe a licensed surface. The record page's read-alike panel belongs to NoveList; a probe that reads it would be
  the first step of scraping it.
