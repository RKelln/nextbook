"""Turn the catalogue's raw headings into facets.

One pure function per rule in `docs/DATA.md`, "From headings to facets". The
headings mix three vocabularies (library of congress, their "fast" twins, BISAC
trade categories), so two editions of one subject almost never match as strings;
the facet is what makes them comparable.

Section labels are the same words `adapters/pack/config.json` uses, so a found
book and a pack book on the same shelf share a section.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"

with open(CONFIG_PATH, encoding="utf-8") as _handle:
    CONFIG = json.load(_handle)

FORM_SUBDIVISIONS = sorted(CONFIG["form_subdivisions"], key=len, reverse=True)
GENRE_WORDS = {word.casefold() for word in CONFIG["genre_words"]}
DROPPED_GENRES = {word.casefold() for word in CONFIG["dropped_genres"]}
FICTION_SHELVES = CONFIG["fiction_shelves"]
DEWEY_LABELS = CONFIG["dewey_labels"]

# For the record id of a merged work (docs/ARCHITECTURE.md, slice.json).
FORMAT_PREFERENCE = ("BK", "LPRINT", "EBOOK", "EAUDIOBOOK")

_DATE = re.compile(r"^\d{3,4}\s*(?:[-\u2013\u2014]\s*(?:\d{3,4}|[A-Za-z]+)?)?\.?$")
_PARENTHETICAL = re.compile(r"\([^)]*\)")


# --- words ------------------------------------------------------------------

def slug(text) -> str:
    """A facet key fragment: lower case, accents folded, words joined by `-`."""
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("'", "").replace("\u2019", "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _strip_parentheticals(text: str) -> str:
    return " ".join(_PARENTHETICAL.sub("", text).split())


def _name_parts(name) -> list[str]:
    text = _strip_parentheticals(str(name or "")).strip()
    return [part.strip() for part in text.split(",") if part.strip()]


def author_display(name) -> str:
    """`Le Guin, Ursula K., 1929-2018` -> `Ursula K. Le Guin`."""
    parts = [part for part in _name_parts(name) if not _DATE.match(part)]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return " ".join(parts[1:] + [parts[0]])


# Surname particles a catalogue sometimes files at the end of the given names
# ("Guin, Ursula K. Le").
PARTICLES = frozenset({
    "le", "la", "de", "van", "von", "der", "den", "da", "di", "du", "des", "del",
    "della", "al", "el", "bin", "ibn", "ten", "ter", "af", "av",
})


def _particle_split(last: str, first: str):
    """`Guin` + `Ursula K. Le` -> (`le guin`, `Ursula K.`); anything else unchanged.

    A one-word surname plus given names that end in a lowercase particle is the
    other spelling of a surname with a particle; both must key the same.
    """
    if not last or not first:
        return last, first
    if len(last.split()) != 1:
        return last, first
    words = first.split()
    if len(words) < 2:
        return last, first
    if words[-1].strip(".").casefold() not in PARTICLES:
        return last, first
    return " ".join([words[-1], last]), " ".join(words[:-1])


def author_key(name) -> str:
    """A stable key for matching authors: `Golub, L. (Leon)` -> `golub, l`."""
    parts = _name_parts(name)
    if not parts:
        return ""
    if len(parts) >= 2:
        last, first = _particle_split(parts[0], parts[1])
    else:
        words = parts[0].split()
        last = words[-1] if words else ""
        first = words[0] if len(words) > 1 else ""
    last = re.sub(r"[.\s]+$", "", last).casefold()
    initial = first[:1].casefold()
    return f"{last}, {initial}" if initial else last


# --- rule 1: author headings ------------------------------------------------

def is_author_heading(heading: str, authors=()) -> bool:
    """A heading that names an author of the work, or `<Last>, <First>, <year>-`."""
    text = " ".join(str(heading or "").split())
    if not text:
        return False
    if re.match(r"^[^,]+,\s*[^,]+,\s*\d{3,4}\s*(?:[-\u2013\u2014]|\s*$)", text):
        return True
    key = author_key(text)
    return bool(key) and any(author_key(author) == key for author in authors or ())


# --- rule 2: "fast" duplicates ----------------------------------------------

def is_fast_heading(heading: str) -> bool:
    """`Dragons. fast` duplicates `Dragons.`; keep the library's own form."""
    return str(heading or "").strip().casefold().endswith(" fast")


# --- rule 3: BISAC ----------------------------------------------------------

def bisac_facet(heading: str):
    """`FICTION / Science Fiction / X bisacsh` -> (`bisac:science-fiction`, label)."""
    text = " ".join(str(heading or "").split())
    if not text.casefold().endswith(" bisacsh"):
        return None
    body = text[: -len(" bisacsh")].strip().rstrip(".").strip()
    levels = [level.strip().rstrip(".").strip() for level in body.split("/")]
    levels = [level for level in levels if level]
    if not levels:
        return None
    chosen = levels[1] if len(levels) > 1 else levels[0]
    if chosen.casefold() == "general":
        chosen = levels[0]
    if not chosen:
        return None
    return f"bisac:{slug(chosen)}", chosen.lower()


# --- rule 4: form subdivisions ----------------------------------------------

def topic_facet(heading: str):
    """Strip a trailing form word; what is left is the topic."""
    text = " ".join(str(heading or "").split()).rstrip(".").strip()
    if not text:
        return None
    lowered = text.casefold()
    for form in FORM_SUBDIVISIONS:
        if lowered.endswith(form.casefold()):
            remainder = text[: len(text) - len(form)].strip(" ,;:.").strip()
            if not remainder:
                return None
            return f"topic:{slug(remainder)}", remainder.lower()
    key = slug(text)
    if not key:
        return None
    return f"topic:{key}", text.lower()


# --- rule 5: genre words ----------------------------------------------------

def genre_facet(heading: str):
    """A heading that is exactly a known genre word -> `genre:<slug>`."""
    text = " ".join(str(heading or "").split()).rstrip(".").strip()
    folded = text.casefold()
    if not text or folded not in GENRE_WORDS or folded in DROPPED_GENRES:
        return None
    return f"genre:{slug(text)}", text.lower()


def genre_facets(brief: dict) -> dict:
    """Every `genreForm` value is a genre. Empty or generic ones say nothing."""
    found: dict[str, str] = {}
    for value in brief.get("genreForm") or []:
        text = " ".join(str(value or "").split()).rstrip(".").strip()
        if not text or text.casefold() in DROPPED_GENRES:
            continue
        found[f"genre:{slug(text)}"] = text.lower()
    return found


# --- rule 6: section --------------------------------------------------------

def section_from_call_number(call_number):
    """`813.54 L2453.109` -> `section:800`; `SCIENCE FICTION LEG` -> `section:science-fiction`."""
    if not call_number:
        return None
    text = " ".join(str(call_number).split()).upper()
    if not text or "ON ORDER" in text:
        return None
    dewey = re.match(r"^(\d{3})", text)
    if dewey:
        return "section:" + dewey.group(1)[0] + "00"
    tokens = text.split()
    best = None  # (word count, section key)
    for shelf in FICTION_SHELVES:
        for alternative in shelf["words"]:
            words = alternative.split()
            if not words:
                continue
            for start in range(0, len(tokens) - len(words) + 1):
                if tokens[start:start + len(words)] == words:
                    if best is None or len(words) > best[0]:
                        best = (len(words), shelf["key"])
                    break
    return "section:" + best[1] if best else None


def section_label(section: str):
    """The shelf words for a `section:` facet, or None."""
    key = str(section or "").removeprefix("section:")
    if key in DEWEY_LABELS:
        return DEWEY_LABELS[key]
    for shelf in FICTION_SHELVES:
        if shelf["key"] == key:
            return shelf["label"]
    return None


# --- rule 7: series ---------------------------------------------------------

def series_facets(brief: dict) -> dict:
    """Each series name, trimmed, gives `series:<slug>`, "the <Name> series"."""
    found: dict[str, str] = {}
    for entry in brief.get("series") or []:
        name = entry.get("name") if isinstance(entry, dict) else entry
        name = " ".join(str(name or "").split())
        if name:
            found[f"series:{slug(name)}"] = f"the {name} series"
    return found


# --- the brief, all together ------------------------------------------------

def heading_facets(headings, authors=()) -> dict:
    """Rules 1 to 5 over one list of headings."""
    found: dict[str, str] = {}
    for heading in headings or []:
        text = " ".join(str(heading or "").split())
        if not text or is_author_heading(text, authors) or is_fast_heading(text):
            continue
        if text.rstrip(".").strip().casefold() in GENRE_WORDS:
            pair = genre_facet(text)  # None for Fiction / Literature alone
            if pair:
                found[pair[0]] = pair[1]
            continue
        pair = bisac_facet(text) or topic_facet(text)
        if pair:
            found[pair[0]] = pair[1]
    return found


def labels_for(brief: dict) -> dict:
    """Every facet of one manifestation, with the words a reason would say."""
    found = heading_facets(brief.get("subjectHeadings"), brief.get("authors"))
    found.update(genre_facets(brief))
    found.update(series_facets(brief))
    section = section_from_call_number(brief.get("callNumber"))
    if section:
        label = section_label(section)
        if label:
            found[section] = label
    return found


def facets_for(brief: dict) -> set:
    """The facet keys of one manifestation."""
    return set(labels_for(brief))


# --- rule 8: merge across manifestations ------------------------------------

def _format_rank(fmt) -> int:
    fmt = str(fmt or "").upper()
    return FORMAT_PREFERENCE.index(fmt) if fmt in FORMAT_PREFERENCE else len(FORMAT_PREFERENCE)


def work_from(briefs) -> dict:
    """One work from one work's manifestations: the union of their facets.

    The record id comes from the preferred format (BK, LPRINT, EBOOK, EAUDIOBOOK,
    then anything); `formats` lists every format seen.
    """
    briefs = [brief for brief in briefs or [] if isinstance(brief, dict)]
    if not briefs:
        raise ValueError("work_from needs at least one brief")
    ordered = sorted(briefs, key=lambda brief: _format_rank(brief.get("format")))
    preferred = ordered[0]

    def first(field):
        for brief in ordered:
            value = brief.get(field)
            if value not in (None, "", [], {}):
                return value
        return None

    def section_bearing_call_number():
        for brief in ordered:
            call_number = brief.get("callNumber")
            if call_number and section_from_call_number(call_number):
                return call_number
        return first("callNumber")

    facets: dict[str, str] = {}
    for brief in ordered:
        for key, label in labels_for(brief).items():
            facets.setdefault(key, label)

    formats = []
    for brief in ordered:
        fmt = brief.get("format")
        if fmt and fmt not in formats:
            formats.append(fmt)
    formats.sort(key=lambda fmt: (_format_rank(fmt), fmt))

    authors = first("authors") or []
    author = author_display(authors[0]) if authors else ""
    year = first("publicationDate")
    year = int(str(year)[:4]) if str(year or "")[:4].isdigit() else None

    series = []
    for brief in ordered:
        for entry in brief.get("series") or []:
            name = entry.get("name") if isinstance(entry, dict) else entry
            name = " ".join(str(name or "").split())
            if name and name not in series:
                series.append(name)

    audiences = first("audiences") or []
    return {
        "id": first("id"),
        "groupKey": preferred.get("groupKey"),
        "title": preferred.get("title") or first("title") or "",
        "subtitle": first("subtitle"),
        "author": author,
        "authorKey": author_key(authors[0]) if authors else "",
        "year": year,
        "formats": formats,
        "contentType": first("contentType"),
        "audience": audiences[0] if audiences else None,
        "language": first("primaryLanguage"),
        "callNumber": section_bearing_call_number(),
        "series": series,
        "facets": sorted(facets),
    }


def works_from(briefs) -> list:
    """Every work on a page: group the briefs by `groupKey`, merge each group."""
    groups: dict[str, list] = {}
    for brief in briefs or []:
        if not isinstance(brief, dict):
            continue
        key = brief.get("groupKey") or ("id:" + str(brief.get("id")))
        groups.setdefault(key, []).append(brief)
    return [work_from(group) for group in groups.values()]
