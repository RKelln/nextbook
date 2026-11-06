#!/usr/bin/env python3
"""Read selected entries from the opt-in local mirror; never start sharing implicitly."""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--file', type=Path, default=Path(__file__).resolve().parent.parent / 'nextbook-live.json')
    ap.add_argument('--find', help='title or author contains these words')
    ap.add_argument('--key', help='exact shelf entry key')
    ap.add_argument('--state', choices=['want', 'hold', 'reading', 'read', 'stopped'])
    ap.add_argument('--limit', type=int, default=20)
    args = ap.parse_args()
    if args.limit < 1:
        ap.error('--limit must be positive')
    try:
        doc = json.loads(args.file.read_text(encoding='utf-8'))
        if doc.get('schema') != 'nextbook/shelf-1' or not isinstance(doc.get('entries'), list):
            raise ValueError('not a shelf mirror')
        entries = doc['entries']
        if args.key:
            entries = [e for e in entries if e.get('key') == args.key]
        if args.state:
            entries = [e for e in entries if e.get('state') == args.state]
        if args.find:
            entries = [e for e in entries if args.find.casefold() in
                       (str(e.get('title', '')) + ' ' + str(e.get('author', ''))).casefold()]
        print(json.dumps({'which': doc.get('which'), 'matched': len(entries),
                          'entries': entries[:args.limit]}, ensure_ascii=False, indent=2))
    except (OSError, ValueError, AttributeError) as err:
        ap.exit(1, 'read-shelf: %s. Enable --mirror and open its browser tab first.\n' % err)


if __name__ == '__main__':
    main()
