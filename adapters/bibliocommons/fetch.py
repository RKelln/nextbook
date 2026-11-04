"""The only code that talks to the catalogue.

`get(url, kind)` reads a search page or the new-titles page, politely: it refuses
any path the adapter was not built to read (after resolving `..`, `%2e%2e` and
backslashes, because the server would), refuses anything `robots.txt` disallows,
waits between requests (the stricter delay of the two adjacent requests: 120 s
whenever a batch read is one of them, 5 s between two searches a person asked
for; the robots.txt read is itself a request and is paced like one), and keeps
every body it has already seen, so a second read of the same URL makes no request
and waits for nothing.

The whole module is built around a `Fetcher` object so a test can inject the
opener, the sleep function and the clock. Nothing outside this module calls the
network.

House rules (AGENTS.md, docs/DATA.md): never a record page, never
`/item/read_alike_list/`, never a loop. One command reads at most three pages.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "nextbook/1.0 (+https://github.com/RKelln/nextbook)"

# The only paths this adapter was built to read (docs/DATA.md, "The rules of the house").
ALLOWED_PATHS = ("/v2/search", "/v2/browse/titles/new")

# The events feed lives on the platform's gateway, not the library's own host,
# and that host carries nothing else we read. Its robots.txt answers 404
# (checked 2026-11-03), so the whole host is governed by the allow-list here:
# one path, read a page at a time (`page=1`, `page=2`, ...), each page paced and
# cached like every other request, exactly as the catalogue pages are.
GATEWAY_HOST = "https://gateway.bibliocommons.com"
EVENTS_PATH = "/v2/libraries/{library}/rss/events"

KINDS = ("on-demand", "batch")
# The robots.txt read is paced like the mildest kind: it is a request like any
# other, but a cold run should not wait 120 s before saying hello.
ROBOTS_KIND = "on-demand"
MAX_ON_DEMAND_PAGES = 3
ON_DEMAND_DELAY = 5.0
BATCH_FLOOR = 120.0
TIMEOUT = 60

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[1]
DEFAULT_CACHE_DIR = _REPO_ROOT / ".cache" / "tpl"
LIBRARY_DIR = _HERE / "libraries"


class FetchError(Exception):
    """The adapter will not make this request."""


class DisallowedPath(FetchError):
    """The path is not one this adapter reads, or robots.txt forbids it."""


class RobotsRefused(FetchError):
    """robots.txt forbids the search path or asks for a longer delay than we honour."""


class TooManyPages(FetchError):
    """One command asked for a fourth page."""


# --- the library file -------------------------------------------------------

def load_library(name: str = "tpl") -> dict:
    """Read `libraries/<name>.json` and build the host from its subdomain."""
    path = LIBRARY_DIR / f"{name}.json"
    with open(path, encoding="utf-8") as handle:
        spec = json.load(handle)
    host = f"https://{spec['subdomain']}.bibliocommons.com"
    library = dict(spec)
    library["host"] = host
    for key in ("search_url", "new_titles_url", "record_url"):
        if key in library:
            library[key] = library[key].replace("{host}", host)
    return library


def search_url(query: str, page: int = 1, library: str = "tpl") -> str:
    """The search address for a person's words, on page `page` (1-based)."""
    template = load_library(library)["search_url"]
    return template.format(query=urllib.parse.quote(str(query)), page=int(page))


def new_titles_url(page: int = 1, library: str = "tpl") -> str:
    """The new-and-on-order shelf, page `page` (1-based)."""
    template = load_library(library)["new_titles_url"]
    return template.format(page=int(page))


def events_url(branch: str, start: str, end: str, page: int = 1,
               library: str = "tpl") -> str:
    """One page of one branch's events, for the inclusive window start..end.

    `start` and `end` are ISO dates. The date filter is mandatory: without it
    the feed carries events that have already happened (docs/RESEARCH.md).
    """
    path = EVENTS_PATH.format(library=load_library(library)["subdomain"])
    query = urllib.parse.urlencode({"locations": branch, "startDate": start,
                                    "endDate": end, "page": int(page)})
    return f"{GATEWAY_HOST}{path}?{query}"


# --- robots.txt -------------------------------------------------------------

def _rule_regex(pattern: str):
    """A robots pattern as a regex.

    The pattern is a prefix; `*` matches any run of characters; a trailing `$`
    anchors the end; every other character is literal, `?` included (a
    `Disallow: /*?` means "a query string", not "the empty prefix").
    """
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    literal = ".*".join(re.escape(part) for part in body.split("*"))
    return re.compile("^" + literal + ("$" if anchored else ""))


class Robots:
    """What one robots.txt group says, for our user agent."""

    def __init__(self, crawl_delay=None, rules=()):
        self.crawl_delay = crawl_delay
        self.rules = list(rules)  # [(allow: bool, pattern: str)]
        self._compiled = [(_rule_regex(pattern), allow, len(pattern))
                          for allow, pattern in self.rules]

    def allowed(self, path: str) -> bool:
        """Longest matching rule wins; a tie goes to Allow (RFC 9309)."""
        path = path or "/"
        best_length = -1
        best_allow = True
        for regex, allow, length in self._compiled:
            if not regex.match(path):
                continue
            if length > best_length or (length == best_length and allow):
                best_length = length
                best_allow = allow
        return best_allow


def parse_robots(text: str, agent: str = "nextbook") -> Robots:
    """Parse robots.txt and return the group that applies to `agent`.

    Consecutive `User-agent` lines share one group's rules. The most specific
    matching group wins; `*` is the fallback.
    """
    groups = []
    current = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        field, _, value = line.partition(":")
        field = field.strip().lower()
        value = value.strip()
        if field == "user-agent":
            if current is None or current["rules"] or current["delay"] is not None:
                current = {"agents": [], "rules": [], "delay": None}
                groups.append(current)
            current["agents"].append(value.lower())
        elif field in ("allow", "disallow"):
            if current is None or not value:
                continue  # an empty Disallow means "allow everything"
            current["rules"].append((field == "allow", value))
        elif field == "crawl-delay" and current is not None:
            try:
                current["delay"] = float(value)
            except ValueError:
                pass

    exact = [g for g in groups if agent.lower() in g["agents"]]
    generic = [g for g in groups if "*" in g["agents"]]
    chosen = (exact or generic or [None])[0]
    if chosen is None:
        return Robots()
    return Robots(crawl_delay=chosen["delay"], rules=chosen["rules"])


# --- the fetcher ------------------------------------------------------------

def _default_open(request, timeout=TIMEOUT):
    return urllib.request.urlopen(request, timeout=timeout)


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# Characters a path may carry in the request we rebuild (RFC 3986 pchar, plus `/`).
_PATH_SAFE = "/:@!$&'()*+,;=-._~"


def normalise_path(path: str) -> str:
    """The path a server would resolve, so the guard cannot be walked around.

    urllib sends `..` and `%2e%2e` verbatim and the server resolves them, so the
    guard must see the resolved path: percent-decode, turn backslashes into
    slashes, refuse a `..` segment or a decoded control character, then drop the
    `.` and empty segments.
    """
    path = urllib.parse.unquote(str(path or "/")).replace("\\", "/")
    if _CONTROL.search(path):
        raise DisallowedPath(f"{path!r} carries a control character")
    segments = []
    for segment in path.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            raise DisallowedPath(f"{path!r} climbs out of its directory")
        segments.append(segment)
    return "/" + "/".join(segments)


def _path_under(path: str, allowed_paths=ALLOWED_PATHS, exact: bool = False) -> bool:
    """Whether `path` is one of `allowed_paths`, or under one when not `exact`."""
    for allowed in allowed_paths:
        if path == allowed or (not exact and path.startswith(allowed + "/")):
            return True
    return False


def _request_url(parts, path: str) -> str:
    """The address to fetch, rebuilt from the normalised path and the query."""
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, urllib.parse.quote(path, safe=_PATH_SAFE),
         parts.query, ""))


class Fetcher:
    """One run: one robots.txt read, one clock, one page budget.

    `opener` has the signature of `urllib.request.urlopen(request, timeout=...)`
    and returns an object with `.read()`. `sleep` takes seconds. `clock` returns
    monotonic seconds. All three can be replaced in a test.
    """

    def __init__(self, *, library: str = "tpl", opener=None, sleep=None, clock=None,
                 cache_dir=None, robots_text=None):
        self.library = load_library(library)
        self._opener = opener or _default_open
        self._sleep = sleep or time.sleep
        self._clock = clock or time.monotonic
        self.cache_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE_DIR
        self._robots_text = robots_text
        self._robots = None
        self._last_request = None
        self._last_kind = None
        self._pages = {"on-demand": 0, "batch": 0}

    # -- public ------------------------------------------------------------

    @property
    def host(self) -> str:
        return self.library["host"]

    def _allowed_paths(self, hostname=None):
        """The paths this adapter reads on `hostname`, and none besides.

        The gateway carries the events feed and nothing else: one endpoint, no
        path under it (`exact` at the call site). The library's own host keeps
        its two catalogue paths.
        """
        gateway_host = urllib.parse.urlsplit(GATEWAY_HOST).hostname
        if hostname == gateway_host:
            return (EVENTS_PATH.format(library=self.library["subdomain"]),)
        return ALLOWED_PATHS

    def get(self, url: str, kind: str = "on-demand") -> str:
        """Return the body at `url`, from the cache when it is already there."""
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}, not {kind!r}")
        parts = urllib.parse.urlsplit(url)
        library_host = urllib.parse.urlsplit(self.host).hostname
        gateway_host = urllib.parse.urlsplit(GATEWAY_HOST).hostname
        if parts.scheme != "https" or parts.hostname not in (library_host, gateway_host):
            raise DisallowedPath(f"{url} is not on {self.host} or the events gateway")
        # The guard and robots.txt see the path the server would resolve. The
        # gateway's feed is one endpoint with a query, so a path *under* it is
        # not a page of the feed and is refused too.
        path = normalise_path(parts.path or "/")
        on_gateway = parts.hostname == gateway_host
        if not _path_under(path, self._allowed_paths(parts.hostname), exact=on_gateway):
            raise DisallowedPath(f"{path} is not a path this adapter reads")
        cached = self._cache_path(url)
        if cached.is_file():
            # A body already in the cache costs no request and no wait.
            return cached.read_text(encoding="utf-8", errors="replace")
        # The gateway answers 404 for robots.txt, so its one path is governed by
        # the allow-list above; the library's own host is checked as before.
        robots = Robots() if on_gateway else self.robots()
        target = path + ("?" + parts.query if parts.query else "")
        if not robots.allowed(target):
            raise DisallowedPath(f"robots.txt disallows {path}")
        if kind == "on-demand" and self._pages[kind] >= MAX_ON_DEMAND_PAGES:
            raise TooManyPages("one command reads at most "
                               f"{MAX_ON_DEMAND_PAGES} pages; this would be page "
                               f"{self._pages[kind] + 1}")
        self._wait(kind, robots.crawl_delay)
        body = self._request(_request_url(parts, path))
        self._pages[kind] += 1
        self._record(kind)
        self._write_cache(cached, body)
        return body

    def robots(self) -> Robots:
        """Read and check robots.txt once per run."""
        if self._robots is not None:
            return self._robots
        text = self._robots_text
        if text is None:
            # The robots read is a request like any other: it counts against the
            # pacing, so a cold run does not send robots.txt and a search back
            # to back.
            self._wait(ROBOTS_KIND)
            text = self._request(self.host + "/robots.txt")
            self._record(ROBOTS_KIND)
        parsed = parse_robots(text)
        if not parsed.allowed("/v2/search"):
            raise RobotsRefused("robots.txt now disallows /v2/search")
        if parsed.crawl_delay is not None and parsed.crawl_delay > BATCH_FLOOR:
            raise RobotsRefused(
                f"robots.txt asks for Crawl-delay {parsed.crawl_delay:g}s, "
                f"more than the {BATCH_FLOOR:g}s this adapter honours")
        self._robots = parsed
        return parsed

    # -- internals ---------------------------------------------------------

    def _request(self, url: str) -> str:
        request = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT,
                          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"})
        response = self._opener(request, timeout=TIMEOUT)
        try:
            data = response.read()
        finally:
            close = getattr(response, "close", None)
            if close is not None:
                close()
        if isinstance(data, bytes):
            return data.decode("utf-8", "replace")
        return data

    def _delay(self, kind, crawl_delay=None) -> float:
        if kind == "batch":
            return max(BATCH_FLOOR, crawl_delay or 0.0)
        return ON_DEMAND_DELAY

    def _wait(self, kind, crawl_delay=None) -> None:
        """Wait the stricter delay of this request's kind and the previous one."""
        if self._last_request is None:
            return  # the first request of a run goes straight out
        delay = max(self._delay(kind, crawl_delay),
                    self._delay(self._last_kind, crawl_delay))
        remaining = delay - (self._clock() - self._last_request)
        if remaining > 0:
            self._sleep(remaining)

    def _record(self, kind) -> None:
        self._last_request = self._clock()
        self._last_kind = kind

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.html"

    def _write_cache(self, path: Path, body: str) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        except OSError:
            pass  # a full disk must not lose the body we already have


# --- the module-level run ---------------------------------------------------

_default_fetcher = None


def get(url: str, kind: str = "on-demand") -> str:
    """Read `url` in this command's single run."""
    global _default_fetcher
    if _default_fetcher is None:
        _default_fetcher = Fetcher()
    return _default_fetcher.get(url, kind)


def reset() -> None:
    """Start a new run (a new robots read and a new page budget)."""
    global _default_fetcher
    _default_fetcher = None
