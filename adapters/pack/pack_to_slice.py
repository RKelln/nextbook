#!/usr/bin/env python3
"""Turn the W13 reading pack into nextbook's data files.

Ported from kit/seed_src/pack/books.json (MIT, same author). The data is ported,
not the residency material's requirements: the pack's books, moods, paces and
one-line notes are the only source of words the catalogue does not carry (D29).

Writes data/slice.json, data/tags.json and data/practice.json from the pack and
the tables in adapters/pack/config.json. Standard library only.

    python3 adapters/pack/pack_to_slice.py            # write the three files
    python3 adapters/pack/pack_to_slice.py --report   # write, then print the report
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CONFIG_PATH = os.path.join(HERE, "config.json")
DATA_DIR = os.path.join(REPO, "data")

SLICE_SCHEMA = "nextbook/slice-1"
TAGS_SCHEMA = "nextbook/tags-1"
PRACTICE_SCHEMA = "nextbook/practice-1"

# A trailing generational suffix is not a surname ("Walter M. Miller Jr.").
SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}
# Surname particles stay with the surname ("Ursula K. Le Guin" -> "le guin, u").
PARTICLES = {"le", "la", "van", "von", "de", "del", "della", "der", "di",
             "du", "da", "dos", "das", "bin", "ibn"}

# The slice's build date is the pack's, written once; nothing here reads today's clock.
PACK_FETCHED = "2026-11-03"


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_config(path=CONFIG_PATH):
    return load_json(os.path.expanduser(path))


def load_pack(path=None, config=None):
    config = config or load_config()
    path = os.path.expanduser(path or config["packPath"])
    return load_json(path), path


def author_key(name):
    """'Ursula K. Le Guin' -> 'le guin, u'. Surname plus first initial."""
    tokens = name.split()
    while len(tokens) > 1 and tokens[-1].lower() in SUFFIXES:
        tokens.pop()
    if not tokens:
        return ""
    index = len(tokens) - 1
    parts = [tokens[index]]
    while index - 1 >= 1 and tokens[index - 1].lower() in PARTICLES:
        index -= 1
        parts.insert(0, tokens[index])
    surname = " ".join(part.lower() for part in parts)
    return "%s, %s" % (surname, tokens[0][0].lower())


def contentType_for(book, config):
    """FICTION if any of the pack's genres for the book is fiction, else NONFICTION."""
    table = config["genreToContentType"]
    values = [table[genre] for genre in book["genre"]]
    return "FICTION" if "FICTION" in values else "NONFICTION"


def audience_for(book, config):
    return config["audience"][book["audience"]]


def section_keys_for(book, config):
    """One section per genre, in the pack's order, no repeats."""
    keys = []
    for genre in book["genre"]:
        key = config["genreToSection"][genre]["key"]
        if key not in keys:
            keys.append(key)
    return keys


def facets_for(book, config):
    """Every facet a work carries, before the singleton rule."""
    prefix = config["facetPrefix"]
    facets = []
    for genre in book["genre"]:
        facets.append("%s:%s" % (prefix["genre"], genre))
    for theme in book["themes"]:
        facets.append("%s:%s" % (prefix["theme"], theme))
    for key in section_keys_for(book, config):
        facets.append("%s:%s" % (prefix["section"], key))
    seen = set()
    ordered = []
    for facet in facets:
        if facet not in seen:
            seen.add(facet)
            ordered.append(facet)
    return ordered


def group_key_for(book):
    return "pack:%s" % book["id"]


def work_from(book, config):
    return {
        "id": book["id"],
        "groupKey": group_key_for(book),
        "title": book["title"],
        "subtitle": None,
        "author": book["author"],
        "authorKey": author_key(book["author"]),
        "year": book["year"],
        "formats": [],
        "contentType": contentType_for(book, config),
        "audience": audience_for(book, config),
        "language": None,
        "callNumber": None,
        "series": [],
        "facets": facets_for(book, config),
    }


def count_facets(works):
    counts = {}
    for work in works:
        for facet in work["facets"]:
            counts[facet] = counts.get(facet, 0) + 1
    return counts


def label_for(facet, config):
    kind, _, key = facet.partition(":")
    if kind == config["facetPrefix"]["section"]:
        for genre, section in config["genreToSection"].items():
            if section["key"] == key:
                return section["label"]
        raise KeyError("no section label for %r" % key)
    return key


def apply_singleton_rule(works, config):
    """Drop a facet carried by fewer than `dropFacetsCarriedByFewerThan` works.

    A facet only one work carries cannot match anything, so it is dropped from
    the dictionary and from that work's facets. Returns (dropped, counts).
    """
    floor = config["dropFacetsCarriedByFewerThan"]
    counts = count_facets(works)
    dropped = sorted(facet for facet, count in counts.items() if count < floor)
    for work in works:
        work["facets"] = [facet for facet in work["facets"] if facet not in dropped]
    return dropped, {facet: count for facet, count in counts.items() if facet not in dropped}


def build_facets(works, counts, config):
    return {
        facet: {
            "label": label_for(facet, config),
            "kind": facet.partition(":")[0],
            "works": counts[facet],
        }
        for facet in sorted(counts)
    }


def build_slice(pack, config, pack_path):
    works = [work_from(book, config) for book in pack["books"]]
    dropped, counts = apply_singleton_rule(works, config)
    doc = {
        "schema": SLICE_SCHEMA,
        "library": dict(config["library"]),
        "fetched": PACK_FETCHED,
        "sources": [{
            "kind": "pack",
            "name": os.path.basename(pack_path),
            "version": pack["version"],
            "fetched": PACK_FETCHED,
            "books": len(pack["books"]),
            "works": len(works),
        }],
        "facets": build_facets(works, counts, config),
        "works": works,
    }
    return doc, dropped


def build_tags(pack, config):
    """The pack's mood, pace and note, unchanged, keyed by groupKey."""
    vocab = pack["vocab"]
    works = {}
    for book in pack["books"]:
        works[group_key_for(book)] = {
            "mood": list(book["mood"]),
            "pace": book["pace"],
            "note": book["note"],
        }
    return {
        "schema": TAGS_SCHEMA,
        "vocab": {"mood": list(vocab["mood"]), "pace": list(vocab["pace"])},
        "works": works,
    }


def build_practice(pack, config):
    by_id = {book["id"]: book for book in pack["books"]}
    entries = []
    for pick in config["practice"]:
        book = by_id[pick["id"]]
        entries.append({
            "key": "w:%s" % group_key_for(book),
            "id": book["id"],
            "groupKey": group_key_for(book),
            "title": book["title"],
            "author": book["author"],
            "state": pick["state"],
            "rating": pick["rating"],
            "updated": pick["updated"],
        })
    return {"schema": PRACTICE_SCHEMA, "entries": entries}


def sections_of(slice_doc):
    prefix = "section:"
    return sorted({facet for work in slice_doc["works"]
                   for facet in work["facets"] if facet.startswith(prefix)})


def report(slice_doc, tags_doc, practice_doc, dropped):
    works = slice_doc["works"]
    print("pack: %d books -> %d works, %d facets kept, %d dropped"
          % (len(works), len(works), len(slice_doc["facets"]), len(dropped)))
    print("dropped (carried by one work only): %s"
          % (", ".join(dropped) if dropped else "none"))
    sections = sections_of(slice_doc)
    print("sections(%d): %s" % (len(sections), ", ".join(sections)))
    bare = [w["id"] for w in works
            if len(w["facets"]) < 3 or not any(f.startswith("section:") for f in w["facets"])]
    print("facets per work: min %d, max %d; works with fewer than three facets or no section: %s"
          % (min(len(w["facets"]) for w in works),
             max(len(w["facets"]) for w in works),
             ", ".join(bare) if bare else "none"))
    for work in works:
        section = [f for f in work["facets"] if f.startswith("section:")]
        print("  %-20s %2d  %-22s %s"
              % (work["id"], len(work["facets"]), ",".join(section),
                 " ".join(f for f in work["facets"] if not f.startswith("section:"))))
    print("tags: %d works, %d notes" % (len(tags_doc["works"]),
                                        sum(1 for w in tags_doc["works"].values() if w["note"])))
    states = {}
    for entry in practice_doc["entries"]:
        states[entry["state"]] = states.get(entry["state"], 0) + 1
    print("practice: %d entries, states %s"
          % (len(practice_doc["entries"]),
             ", ".join("%s %d" % (k, v) for k, v in sorted(states.items()))))


def write_json(path, doc):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Turn the W13 reading pack into data/slice.json, data/tags.json and data/practice.json.")
    parser.add_argument("--pack", help="the pack's books.json (default: config packPath)")
    parser.add_argument("--config", default=CONFIG_PATH)
    parser.add_argument("--out", default=DATA_DIR, help="where the three JSON files go")
    parser.add_argument("--report", action="store_true", help="print sections and facet counts")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    pack, pack_path = load_pack(args.pack, config)

    slice_doc, dropped = build_slice(pack, config, pack_path)
    tags_doc = build_tags(pack, config)
    practice_doc = build_practice(pack, config)

    os.makedirs(args.out, exist_ok=True)
    write_json(os.path.join(args.out, "slice.json"), slice_doc)
    write_json(os.path.join(args.out, "tags.json"), tags_doc)
    write_json(os.path.join(args.out, "practice.json"), practice_doc)

    if args.report:
        report(slice_doc, tags_doc, practice_doc, dropped)
    else:
        print("wrote slice.json (%d works), tags.json (%d works), practice.json (%d entries) to %s"
              % (len(slice_doc["works"]), len(tags_doc["works"]),
                 len(practice_doc["entries"]), os.path.relpath(args.out, REPO)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
