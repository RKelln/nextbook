#!/usr/bin/env python3
"""One paste packet per mode brief (T8.5).

A packet is one plain text file a person can paste into a chat window. The chat is
asked to write one mode file: no repo, no page, no build. Everything the answer
needs is inside the packet -- the brief, the rules, a worked example and what to do
with the answer -- so a chat with no other context can still produce a file that
the app's check will take.

    python3 tools/packets.py              # every brief -> dist/packets/<id>.txt
    python3 tools/packets.py survey       # one packet, to stdout
    python3 tools/packets.py --check      # write nothing; exit 2 on a bad packet

Standard library only. No network.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BRIEFS = "docs/modes"
MODES = "app/modes"
CONTRACT = "docs/CONTRACT.md"
EXAMPLE_ID = "more-by"
DEFAULT_OUT = "dist/packets"

# The six parts, in the order a chat should meet them. The text after the number is
# what tests and --check look for; keep it stable.
HEADINGS = (
    "## 1. The job",
    "## 2. The brief",
    "## 3. The rules a mode must keep",
    "## 4. The worked example",
    "## 5. What to send back",
    "## 6. What to do with the answer",
)

ID_RE = re.compile(r"^[a-z]+(-[a-z]+)*$")
LINK_RE = re.compile(r"\]\(([a-z]+(?:-[a-z]+)*)\.md\)")
TICK_RE = re.compile(r"`([^`]+)`")
TICKET_RE = re.compile(r"\bT\d+(?:\.\d+[a-z]?)?\b")

# A packet is self-contained: no home folders, no local addresses, no links to a
# repo the person does not have, no ticket ids, no workshop business.
FORBIDDEN = (
    "/home/",
    "~/",
    "http://localhost",
    "https://localhost",
    "@",
    "residency",
)

# The low end is the point of a packet (a chat can take it whole). The high end is a
# hard landing zone; past it, the example's comments go first.
MIN_CHARS = 5000
MAX_CHARS = 12000


def read_text(path):
    """Read UTF-8 and normalise line endings. A packet is LF only."""
    text = Path(path).read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def brief_ids(root=REPO):
    """The briefs in docs/modes, in menu order, then any the menu does not list."""
    folder = Path(root) / BRIEFS
    found = [p.stem for p in sorted(folder.glob("*.md")) if p.name != "README.md"]
    ordered = [i for i in menu_ids(root) if i in found]
    return ordered + [i for i in found if i not in ordered]


def menu_ids(root=REPO):
    """The ids the menu's table links to, in the order it lists them."""
    menu = Path(root) / BRIEFS / "README.md"
    if not menu.exists():
        return []
    out = []
    for found in LINK_RE.findall(read_text(menu)):
        if found not in out:
            out.append(found)
    return out


def banned_names(root=REPO):
    """The names in CONTRACT.md section 5, read from the contract itself.

    Only the sentence that begins "Never use" is read, so the prose after it (which
    also uses backticks for things a mode *may* do) does not leak into the list.
    """
    text = read_text(Path(root) / CONTRACT)
    start = text.find("**Never use**")
    if start < 0:
        raise SystemExit("STOP: docs/CONTRACT.md section 5 no longer says \"Never use\".")
    end = text.find("The check reads", start)
    if end < 0:
        end = text.find("\n3.", start)
    if end < 0:
        raise SystemExit("STOP: cannot find the end of the banned list in docs/CONTRACT.md.")
    names = [n.strip() for n in TICK_RE.findall(text[start:end])]
    names = [n for n in names if n and not n.startswith("'")]
    if len(names) < 10:
        raise SystemExit("STOP: the banned list in docs/CONTRACT.md section 5 looks short.")
    return names


def example_parts(root=REPO, trim_comments=False):
    """The worked example, verbatim: the mode file and its check file."""
    mode = read_text(Path(root) / MODES / (EXAMPLE_ID + ".js"))
    check = read_text(Path(root) / MODES / (EXAMPLE_ID + ".check.js"))
    if trim_comments:
        mode = "\n".join(l for l in mode.split("\n") if not l.strip().startswith("//"))
        check = "\n".join(l for l in check.split("\n") if not l.strip().startswith("//"))
    return mode, check


def plain_words(root, mode_id):
    """The brief's one-line description, for the packet README."""
    text = read_text(Path(root) / BRIEFS / (mode_id + ".md"))
    for line in text.split("\n"):
        if line.startswith("**In plain words:**"):
            return line.split("**In plain words:**", 1)[1].strip()
    return ""


def job_paragraph(mode_id):
    return (
        "Write one file that adds a mode to Nextbook, a small reading app that runs from a folder in a "
        "browser. A mode looks at the books a person has saved and chooses up to six books from the library "
        "list it is given, with one sentence saying why for each. The file registers with "
        "Nextbook.mode({...}) and must pass the app's check, which loads it with no page. It draws, fetches "
        "and saves nothing; the app does all that. Everything a mode may use arrives in ctx. The id is \"" +
        mode_id + "\"."
    )


def rules_section(root):
    names = banned_names(root)
    return "\n".join([
        "A mode is one object passed to Nextbook.mode({...}), keys in this order: id (lower-case letters and",
        "hyphens, same as the file name), name (the menu words), purpose (one sentence), shape ('list' for a",
        "grid, 'path' for ordered steps), inputs (a list; [] for none), strings (the words people read, about",
        "grade 6), logic (pure helpers), choose (a method, choose(ctx) or choose(ctx, input), returning",
        "{ picks, note }).",
        "",
        "The file does nothing when it loads except that call. Write choose as a method, not an arrow",
        "function, or this.logic is lost. Return up to six picks, each { id, why }, plus a note when the list",
        "is empty or short.",
        "",
        "ctx is the only thing a mode may use: works; work(id); shelf; onShelf(id); profile(entries?);",
        "score(work, profile); similar(a, b); reason(parts); facetsOf(work, kind?); labelOf(facet); facets;",
        "tagsOf(work); sections(); others; events; random(); t(key, vars).",
        "",
        "The check fails the mode on any of these names, exactly as written:",
        ", ".join(names),
        "It ignores comments and words inside quotes, so a sentence may say \"fetch\"; code may not.",
        "",
        "Every why is one sentence, at most 200 characters, naming a subject, a book, an author, a part of",
        "the library, or the rule. \"Similar to your taste\" is not a reason.",
        "",
        "At most six picks, no repeats, none already on the person's shelf unless allowShelf: true. An empty",
        "list needs a note saying why.",
        "",
        "Never invent a book: every pick is a work in ctx.works, and never supply a title, author, year or",
        "link of your own. Anything not in the list is dropped and named.",
    ])


def example_section(root, trim_comments=False):
    mode, check = example_parts(root, trim_comments=trim_comments)
    return "\n".join([
        "The example below is complete and passes the check. It is not on the menu, on purpose: it shows",
        "the shape, not the answer to the brief.",
        "",
        "File 1: app/modes/" + EXAMPLE_ID + ".js",
        "```js",
        mode.rstrip("\n"),
        "```",
        "",
        "File 2: app/modes/" + EXAMPLE_ID + ".check.js",
        "```js",
        check.rstrip("\n"),
        "```",
    ])


def back_section(mode_id):
    return "\n".join([
        "Send back one file: the mode file, named " + mode_id + ".js and using the id \"" + mode_id +
        "\", with only its code in the answer.",
        "",
        "Do not explain the whole app, and do not send a page, a stylesheet, a data file or a copy of the",
        "app; only the mode is missing. If the brief cannot be followed exactly, keep the rules above and add",
        "one short paragraph after the file saying what you did instead.",
    ])


def after_section(mode_id):
    return "\n".join([
        "Someone will run the app's check on the answer.",
        "",
        "1. Save it as app/modes/" + mode_id + ".js.",
        "2. Add \"" + mode_id + "\" to the list in app/modes/list.js, or the app will not show it.",
        "3. Run: node tools/check-mode.js " + mode_id,
        "4. Read the failures. If it says no check file exists, ask the same chat for",
        "   app/modes/" + mode_id + ".check.js with tests of the helpers, save it beside the mode, and run",
        "   the command again. Send the failing lines back rather than guessing.",
        "",
        "The check is a lint, not a wall: follow the rules rather than looking for what it does not see.",
    ])


def clean_brief(text):
    """The brief, with one thing a stranger cannot use: build task numbers.

    One brief still names a build task ("Cut in ..."). A chat window has no build list,
    so the number is replaced with words; everything else is the brief as written.
    """
    return TICKET_RE.sub("an earlier review", text)


def build_packet(root, mode_id):
    """One self-contained packet, as text with LF line endings."""
    brief_path = Path(root) / BRIEFS / (mode_id + ".md")
    if not brief_path.exists():
        raise FileNotFoundError(str(brief_path))
    brief = clean_brief(read_text(brief_path)).strip("\n")

    parts = [
        "NEXTBOOK MODE PACKET: " + mode_id,
        "Paste this whole message into a chat. It asks for one file.",
        "",
        HEADINGS[0],
        "",
        job_paragraph(mode_id),
        "",
        HEADINGS[1],
        "",
        "The brief below is the whole request. Follow it as written. Where it leaves a choice, make the",
        "smallest choice that keeps the rules in part 3.",
        "",
        brief,
        "",
        HEADINGS[2],
        "",
        rules_section(root),
        "",
        HEADINGS[3],
        "",
        example_section(root),
        "",
        HEADINGS[4],
        "",
        back_section(mode_id),
        "",
        HEADINGS[5],
        "",
        after_section(mode_id),
    ]
    text = "\n".join(parts).rstrip("\n") + "\n"

    # Over the hard limit: trim the example's comments first, then say so in the last
    # line, so a person knows the example they see is slightly shorter than the file.
    if len(text) > MAX_CHARS:
        text = text.replace(example_section(root), example_section(root, trim_comments=True), 1)
        text = text.rstrip("\n") + "\n\n(Some comments were removed from the example to keep this message short.)\n"

    return text


def missing_sections(text):
    """Headings whose section is absent or empty."""
    missing = []
    for i, heading in enumerate(HEADINGS):
        start = text.find(heading)
        if start < 0:
            missing.append(heading)
            continue
        body_start = start + len(heading)
        end = text.find(HEADINGS[i + 1], body_start) if i + 1 < len(HEADINGS) else len(text)
        if end < 0:
            end = len(text)
        if not text[body_start:end].strip():
            missing.append(heading)
    return missing


def forbidden_hits(text):
    """Self-containment failures, with the offending word and a little context."""
    hits = []
    low = text.lower()
    for word in FORBIDDEN:
        if word not in low:
            continue
        if word == "@":
            match = re.search(r"@[A-Za-z0-9_./~-]", text)
            if not match:
                continue
            at = match.start()
        else:
            at = low.find(word)
        line = text.count("\n", 0, at) + 1
        hits.append("%s on line %d" % (word, line))
    ticket = TICKET_RE.search(text)
    if ticket:
        line = text.count("\n", 0, ticket.start()) + 1
        hits.append("ticket id %s on line %d" % (ticket.group(0), line))
    return hits


def check(root=REPO):
    """Return (exit code, problems). Writes nothing."""
    problems = []
    try:
        ids = brief_ids(root)
        menu = menu_ids(root)
    except OSError as e:
        return 2, ["I cannot read docs/modes: " + str(e)]
    if not ids:
        return 2, ["docs/modes has no briefs."]

    for mode_id in menu:
        if mode_id not in ids:
            problems.append("the menu lists \"" + mode_id + "\" but docs/modes/" + mode_id + ".md is missing")
    for mode_id in ids:
        try:
            brief = read_text(Path(root) / BRIEFS / (mode_id + ".md")).strip()
            if not brief:
                problems.append(mode_id + ": the brief is empty")
                continue
            text = build_packet(root, mode_id)
        except (OSError, SystemExit) as e:
            problems.append(mode_id + ": " + str(e))
            continue
        for heading in missing_sections(text):
            problems.append(mode_id + ": the packet has no " + heading)
        for hit in forbidden_hits(text):
            problems.append(mode_id + ": the packet is not self-contained (" + hit + ")")
    return (2 if problems else 0), problems


def readme_text(root=REPO):
    ids = brief_ids(root)
    lines = [
        "NEXTBOOK MODE PACKETS",
        "",
        "Each file here is one message to paste into a chat window. The chat has no repo, no",
        "tools and no memory of this project: the packet carries the brief, the rules, a worked",
        "example, what to ask for back, and what to do with the answer. Paste one packet whole,",
        "send it, and ask for the file it describes.",
        "",
        "The app checks every answer. It runs the mode against several shelves and drops anything",
        "the mode invents: a pick that is not in the library list, a repeat, a seventh pick, or a",
        "book with no reason. A mode that is not in the list never reaches a person's screen.",
        "",
        "The packets:",
        "",
    ]
    for mode_id in ids:
        words = plain_words(root, mode_id)
        lines.append("  " + (mode_id + ".txt").ljust(22) + words)
    words = "Other books by authors you rated well. The worked example, not on the menu."
    lines.append("  " + (EXAMPLE_ID + ".txt").ljust(22) + words)
    lines += [
        "",
        "Ten briefs and one worked example: eleven packets. The briefs are deliberately unbuilt;",
        "writing one is the work the app leaves to its reader. The example is there to be read.",
        "",
        "If you have no repo and no one to run the check, the packet still works: the chat writes",
        "the file and a helper saves it into the app, adds its id to the mode list, and runs the",
        "check. Nothing in a packet asks you to fetch or install anything.",
        "",
    ]
    return "\n".join(lines)


def write_all(root=REPO, out=DEFAULT_OUT):
    """Write every packet and the README. Returns the paths written."""
    out_dir = Path(out)
    if not out_dir.is_absolute():
        out_dir = Path(root) / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for mode_id in brief_ids(root):
        path = out_dir / (mode_id + ".txt")
        path.write_text(build_packet(root, mode_id), encoding="utf-8", newline="\n")
        written.append(path)
    path = out_dir / "README.txt"
    path.write_text(readme_text(root), encoding="utf-8", newline="\n")
    written.append(path)
    return written


def main(argv=None, root=REPO, out=DEFAULT_OUT):
    argv = list(sys.argv[1:] if argv is None else argv)
    root = Path(root)

    if argv == ["--check"]:
        code, problems = check(root)
        for problem in problems:
            print("FAIL " + problem)
        if problems:
            print("FAILED: " + str(len(problems)) + " problem(s); nothing was written.")
        else:
            print("OK: " + str(len(brief_ids(root))) + " packets, all six sections, nothing to write.")
        return code

    if len(argv) > 1 or (argv and argv[0].startswith("-")):
        sys.stderr.write("Use: python3 tools/packets.py [<id> | --check]\n")
        return 2

    if argv:
        mode_id = argv[0]
        if not ID_RE.match(mode_id) or mode_id not in brief_ids(root):
            sys.stderr.write("I do not know the brief \"" + mode_id + "\". Try one of: " +
                             ", ".join(brief_ids(root)) + "\n")
            return 2
        sys.stdout.write(build_packet(root, mode_id))
        return 0

    try:
        written = write_all(root, out)
    except (OSError, SystemExit) as e:
        sys.stderr.write(str(e) + "\n")
        return 2
    sizes = [len(p.read_text(encoding="utf-8")) for p in written if p.suffix == ".txt"]
    largest = max(sizes) if sizes else 0
    print("Wrote " + str(len(written)) + " files to " + str(out) + " (largest " + str(largest) + " characters).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
