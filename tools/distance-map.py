#!/usr/bin/env python3
"""Travel times from one start point to every branch, saved for the events screen.

    python3 tools/distance-map.py --origin 43.700,-79.400 --label "Yonge and Sheppard"
    python3 tools/distance-map.py --origin 43.700,-79.400 --no-transit     # walk, bike and car only
    python3 tools/distance-map.py --origin 43.700,-79.400 --dry-run        # say what would be sent

Ported from a one-off script by the same author (MIT), made generic: the library, its branches
and its time zone come from this repo's data, and there is no default start point.

WHAT LEAVES THIS COMPUTER. The start point goes to public routing and transit servers:
router.project-osrm.org (car), routing.openstreetmap.de (walk and bike) and api.transitous.org
(transit). Their operators can see it. To keep it coarse, the start point is rounded to 3
decimals (about 100 metres) before any request and before anything is written. Choose a nearby
intersection rather than a home address. Nothing else about you is sent.

What it writes (all of it is yours, none of it is committed, none of it is ever packed into a
one-file build, because times from one point show where that point is):
    data/distance-map.json            the map, with the rounded start point and your label
    app/data/distance.js              the same times for the page, without the start point
    data/distance-transit-cache.json  transit answers saved as they arrive, so an interrupted run resumes
Delete those three files to remove every trace. The events screen can also take the map file
with its "Add your travel times" control, and keeps it in that browser only.

Transit depends on the day and hour, so it is saved as two rough guides per branch: a weekday
evening and a Saturday afternoon, from one query each to Transitous for the next such day.
Transitous knows about three weeks ahead, so the guides go stale after about three weeks:
run again with --refresh-transit. A branch with no answer is saved as null, never as a guess.
Walking to the first stop and from the last is allowed up to 30 minutes each end.

How polite it is:
  - one request per mode (the routing table service answers one start to many branches at
    once), chunked to 40 branches: about 9 routing requests in all;
  - transit is one query per branch per time slot (about 190), 1.5 seconds apart, so a full run
    takes about 5 minutes;
  - at least 2 seconds between routing requests and 0.5 seconds between feed pages;
  - a User-Agent that names this project and its page;
  - 429 and 5xx answers are retried after the server's own Retry-After (or a growing wait),
    then the run stops rather than pushing on;
  - nothing is fetched again if the output already holds this start point (use --refresh).

The routing servers (checked 2026-10-23): router.project-osrm.org ignores the profile in the
path and always answers with driving time, so it is used for CAR only. Walk and bike use
routing.openstreetmap.de/routed-foot and /routed-bike (the path still says "driving"). The run
checks for the failure this was written to avoid: if walking is not clearly slower than driving
for most branches, it stops and saves nothing.

Options:
  --origin LAT,LON    the start point (required), rounded to 3 decimals
  --label TEXT        a name for it, shown on the page; the only place the place is written in words
  --no-transit        skip transit (no request to Transitous)
  --refresh           redo the branch list from the library's events feed, and the distances
  --refresh-transit   redo only the transit guides
  --days N            the feed window used to find branches when refreshing (default 14)
  --dry-run           print what would be requested and send nothing
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for _p in (str(ROOT), str(ROOT / "tools")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import gen_data  # noqa: E402  (the page file is written the same safe way as the other data)
from adapters.bibliocommons import events as feed_events  # noqa: E402
from adapters.bibliocommons import fetch as catalogue  # noqa: E402

DATA = ROOT / "data"
APP_DATA = ROOT / "app" / "data"
BRANCHES = DATA / "branches.json"
MAP_PATH = DATA / "distance-map.json"
CACHE_PATH = DATA / "distance-transit-cache.json"
PAGE_PATH = APP_DATA / "distance.js"

UA = "nextbook-distance-map/1.0 (+https://github.com/RKelln/nextbook; a polite one-off lookup)"
BC = "{http://bibliocommons.com/rss/1.0/modules/event/}"
ROUTERS = {
    "car": "https://router.project-osrm.org/table/v1/driving/",
    "walk": "https://routing.openstreetmap.de/routed-foot/table/v1/driving/",
    "bike": "https://routing.openstreetmap.de/routed-bike/table/v1/driving/",
}
TRANSIT = "https://api.transitous.org/api/v1/plan"
CHUNK = 40
ROUTE_PAUSE = 2.0
FEED_PAUSE = 0.5
TRANSIT_PAUSE = 1.5
FILL_WALK_S = 1200      # no transit itinerary and a walk this short or shorter: use the walk
MAX_WALK_S = 1800       # walking to the first stop and from the last: 30 minutes each end
MAX_PAGES = 90
DECIMALS = 3

# Tests replace these, so no test reaches a network or waits.
_urlopen = urllib.request.urlopen
_sleep = time.sleep


class Stop(Exception):
    """The run cannot go on honestly. `main` says it in one line and exits."""


def get(url, what, tries=4, fatal=True):
    """GET with a polite retry. Returns bytes. Stops the run on repeated refusal, or returns None
    instead when fatal is False."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    wait = 5
    for attempt in range(tries):
        try:
            with _urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                try:
                    wait = int(e.headers.get("Retry-After") or wait)
                except (TypeError, ValueError):
                    pass
                print(f"  {what}: HTTP {e.code}, waiting {wait}s", file=sys.stderr)
                _sleep(wait)
                wait *= 2
                continue
            if not fatal:
                print(f"  {what}: HTTP {e.code}, skipped", file=sys.stderr)
                return None
            raise Stop(f"{what}: HTTP {e.code}. Stopping rather than pushing on.")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < tries - 1:
                _sleep(wait)
                wait *= 2
                continue
            if not fatal:
                print(f"  {what}: {e}, skipped", file=sys.stderr)
                return None
            raise Stop(f"{what}: {e}. Stopping.")


# ---- the start point --------------------------------------------------------------------------

def parse_origin(text):
    """(lat, lon) rounded to 3 decimals, or a Stop that says what is wrong."""
    try:
        lat, lon = (float(x) for x in str(text).split(","))
    except ValueError:
        raise Stop("--origin must be LAT,LON, for example 43.700,-79.400")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise Stop("--origin is not a place on earth: latitude -90 to 90, longitude -180 to 180")
    return round(lat, DECIMALS), round(lon, DECIMALS)


def origin_key(origin):
    """A short fingerprint of the rounded start point, so a cache made for another point is not reused."""
    return hashlib.sha1(("%.3f,%.3f" % origin).encode()).hexdigest()[:10]


# ---- the branch list --------------------------------------------------------------------------

def load_branches(path=None):
    doc = json.loads(Path(path or BRANCHES).read_text(encoding="utf-8"))
    return doc["branches"]


def feed_url(start, end, page):
    lib = catalogue.load_library("tpl")
    path = catalogue.EVENTS_PATH.format(library=lib["subdomain"])
    q = urllib.parse.urlencode({"startDate": start, "endDate": end, "page": page})
    return f"{catalogue.GATEWAY_HOST}{path}?{q}"


def harvest_branches(days, dry):
    start = date.today()
    end = start + timedelta(days=days)
    print(f"Branches: reading the library's events feed {start} to {end}, one page every {FEED_PAUSE}s")
    if dry:
        print("  (dry run: would page until an empty page, at most %d pages)" % MAX_PAGES)
        return {}
    found, seen, page = {}, set(), 0
    for page in range(1, MAX_PAGES + 1):
        root = ET.fromstring(get(feed_url(start, end, page), f"feed page {page}"))
        items = root.findall(".//item")
        if not items:
            break
        for it in items:
            guid = it.findtext("guid")
            if guid in seen:
                continue
            seen.add(guid)
            loc = it.find(BC + "location")
            if loc is None:
                continue                       # an online event
            code = loc.findtext(BC + "id")
            lat, lon = loc.findtext(BC + "latitude"), loc.findtext(BC + "longitude")
            if not (code and lat and lon):
                continue
            if (loc.findtext(BC + "name") or "").strip().lower().endswith("closed"):
                continue                       # the feed names closed branches "<name> - Closed"
            found.setdefault(code, {
                "code": code, "name": (loc.findtext(BC + "name") or "").strip(),
                "street": (loc.findtext(BC + "street") or "").strip(),
                "lat": float(lat), "lon": float(lon)})
        _sleep(FEED_PAUSE)
    else:
        raise Stop(f"Hit {MAX_PAGES} pages without an empty one; stopping.")
    print(f"  {len(seen)} events across {max(page - 1, 0)} pages, {len(found)} branches")
    return found


def refresh_branch_list(days, dry, path=None):
    """The branch list from the feed. Aliases written by hand in the old file are kept by code."""
    found = harvest_branches(days, dry)
    if dry:
        return load_branches(path)
    if not found:
        raise Stop("The feed returned no branches, so data/branches.json was left as it was.")
    old = {b["code"]: b for b in load_branches(path)} if Path(path or BRANCHES).exists() else {}
    rows = sorted(found.values(), key=lambda b: b["name"])
    for row in rows:
        if old.get(row["code"], {}).get("aliases"):
            row["aliases"] = old[row["code"]]["aliases"]
    doc = {"fetched": str(date.today()), "source": feed_url("", "", 1).split("?")[0], "branches": rows}
    Path(path or BRANCHES).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return rows


# ---- routing ----------------------------------------------------------------------------------

def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(radians, (a[0], a[1], b[0], b[1]))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(h))


def table_times(mode, origin, branches, dry):
    """Seconds from origin to each branch, in the order given. None where unroutable."""
    out = []
    for i in range(0, len(branches), CHUNK):
        part = branches[i:i + CHUNK]
        coords = [origin] + [(b["lat"], b["lon"]) for b in part]
        path = ";".join(f"{lon},{lat}" for lat, lon in coords)
        dest = ";".join(str(n + 1) for n in range(len(part)))
        url = f"{ROUTERS[mode]}{path}?sources=0&destinations={dest}&annotations=duration"
        if dry:
            print(f"  {mode}: would GET {url.split('/table/')[0]}/table/... ({len(part)} branches)")
            out += [None] * len(part)
            continue
        data = json.loads(get(url, f"{mode} table"))
        if data.get("code") != "Ok":
            raise Stop(f"{mode}: router said {data.get('code')}: {data.get('message')}")
        out += data["durations"][0]
        _sleep(ROUTE_PAUSE)
    return out


def sanity_check(times):
    """The bug this tool exists to avoid: a server that ignores the profile. Walking must be
    clearly slower than driving for most branches, or nothing is saved."""
    ok = [(w, c) for w, c in zip(times["walk"], times["car"]) if w and c and c > 120]
    slower = sum(1 for w, c in ok if w > c * 1.5)
    if not ok or slower < 0.8 * len(ok):
        raise Stop("Sanity check failed: walking is not clearly slower than driving for most branches "
                   f"({slower} of {len(ok)}). A router is probably ignoring the profile. Nothing saved.")


# ---- transit ----------------------------------------------------------------------------------

def next_day(weekday, hour, zone, now=None):
    """The next date (strictly after today) on this weekday (Mon=0), at the hour, library time."""
    d = (now or datetime.now(zone)).replace(hour=hour, minute=0, second=0, microsecond=0)
    d += timedelta(days=1)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def transit_slots(zone, now=None):
    return {"weekday": next_day(2, 18, zone, now), "weekend": next_day(5, 13, zone, now)}   # Wed 18:00, Sat 13:00


def _leg_word(leg):
    mode = str(leg.get("mode", "")).title()
    name = leg.get("routeShortName")
    return f"{mode} {name}" if name else mode


def transit_guides(origin, rows, cache_path, refresh, slots, dry=False):
    """The fastest transit itinerary to each branch at two representative times. Each answer is
    saved as it arrives, so an interrupted run resumes."""
    fp = origin_key(origin)

    def key(row, slot):
        return f"{fp}|{row['code']}|{slot}|{slots[slot].date()}|w{MAX_WALK_S}"

    cache = {}
    if cache_path.exists() and not refresh:
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except ValueError:
            cache = {}
    todo = [(r, s) for r in rows for s in slots if key(r, s) not in cache]
    print("Transit: slots " + ", ".join(f"{k} {v:%a %b %d %H:%M}" for k, v in slots.items())
          + f"; {len(todo)} queries to send, {len(rows) * len(slots) - len(todo)} already saved, {TRANSIT_PAUSE}s apart")
    if dry:
        print(f"  (dry run: would send {len(todo)} queries to {urllib.parse.urlsplit(TRANSIT).netloc})")
        return
    for n, (r, s) in enumerate(todo, 1):
        q = urllib.parse.urlencode({
            "fromPlace": f"{origin[0]},{origin[1]}", "toPlace": f"{r['lat']},{r['lon']}",
            "time": slots[s].isoformat(), "numItineraries": 3,
            "maxPreTransitTime": MAX_WALK_S, "maxPostTransitTime": MAX_WALK_S}, safe=",:")
        raw = get(f"{TRANSIT}?{q}", f"transit {r['name']} {s}", fatal=False)
        guide = None
        if raw:
            try:
                its = json.loads(raw).get("itineraries") or []
                if its:
                    best = min(its, key=lambda i: i["duration"])
                    legs = []
                    for leg in best["legs"]:
                        step = _leg_word(leg)
                        if not legs or legs[-1] != step:
                            legs.append(step)
                    guide = {"seconds": best["duration"], "route": ", ".join(legs)}
            except (ValueError, KeyError, TypeError):
                guide = None                       # an odd answer is no answer, never a guess
        cache[key(r, s)] = guide
        if n % 10 == 0 or n == len(todo):
            cache_path.write_text(json.dumps(cache), encoding="utf-8")
            print(f"  {n}/{len(todo)}")
        _sleep(TRANSIT_PAUSE)
    for r in rows:
        for s in slots:
            g = cache.get(key(r, s))
            r[f"transit_{s}_s"] = g["seconds"] if g else None
            r[f"transit_{s}_route"] = g["route"] if g else None
    # A branch with no itinerary that is a short walk away must not look unreachable by transit:
    # anyone can walk there. Fill it with the walk, marked.
    for r in rows:
        for s in slots:
            if r[f"transit_{s}_s"] is None and r["walk_s"] is not None and r["walk_s"] <= FILL_WALK_S:
                r[f"transit_{s}_s"], r[f"transit_{s}_route"] = r["walk_s"], "walk (no transit needed)"


# ---- writing ----------------------------------------------------------------------------------

def write_outputs(doc, map_path, page_path):
    """The map file (with the rounded start point, for resuming) and the page file (without it)."""
    map_path.parent.mkdir(parents=True, exist_ok=True)
    map_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    page = {k: v for k, v in doc.items() if k != "origin"}
    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text(gen_data.js_text("distance", page), encoding="utf-8")


def run(args):
    origin = parse_origin(args.origin)
    label = (args.label or "my start point").strip()[:80]
    print(f"Start point rounded to {origin[0]:.3f},{origin[1]:.3f} (about 100 m). That rounded point is what is sent.")
    print("It goes to public routing servers (router.project-osrm.org, routing.openstreetmap.de"
          + ("" if args.no_transit else ", api.transitous.org") + ").")

    if args.refresh:
        branches = refresh_branch_list(args.days, args.dry_run)
    else:
        branches = load_branches()
        print(f"Branches: {len(branches)} in data/branches.json (--refresh reads the feed again)")
    if not branches:
        print("No branches to route.")
        return 0

    old = {}
    if MAP_PATH.exists():
        try:
            old = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        except ValueError:
            old = {}
    same = old.get("origin") == list(origin) and old.get("branches") and not args.refresh and not args.dry_run
    if same:
        rows = old["branches"]
        for r in rows:                       # a new alias in the branch list reaches an old map
            match = next((b for b in branches if b["code"] == r["code"]), None)
            if match is not None:
                r["aliases"] = match.get("aliases", [])
        print(f"Distances: {MAP_PATH.name} already holds this start point, keeping walk, bike and car")
    else:
        print(f"Distances to {len(branches)} branches, {-(-len(branches) // CHUNK)} request(s) per mode, {ROUTE_PAUSE}s apart")
        times = {m: table_times(m, origin, branches, args.dry_run) for m in ("car", "bike", "walk")}
        if args.dry_run:
            slots = transit_slots(feed_events.library_timezone())
            if not args.no_transit:
                transit_guides(origin, [dict(b, walk_s=None) for b in branches], CACHE_PATH, args.refresh or args.refresh_transit, slots, dry=True)
            print("Dry run: nothing was sent and nothing was written.")
            return 0
        sanity_check(times)
        rows = []
        for i, b in enumerate(branches):
            row = dict(b)
            row["straight_km"] = round(haversine_km(origin, (b["lat"], b["lon"])), 2)
            for mode in ("walk", "bike", "car"):
                row[mode + "_s"] = round(times[mode][i]) if times[mode][i] is not None else None
            rows.append(row)
        rows.sort(key=lambda r: r["straight_km"])

    slots = transit_slots(feed_events.library_timezone())
    if args.no_transit:
        for r in rows:
            for s in slots:
                r[f"transit_{s}_s"], r[f"transit_{s}_route"] = None, None
        slot_info = {}
    else:
        transit_guides(origin, rows, CACHE_PATH, args.refresh or args.refresh_transit, slots)
        slot_info = {k: v.isoformat() for k, v in slots.items()}

    doc = {
        "origin": list(origin), "label": label, "built": str(date.today()),
        "note": "Rough guides. Walk, bike and car are free-flow with no time of day or parking. Transit is one "
                "query at each of two times (the 'transit_slots'). Any time can be null: no answer was found. "
                "Readers must handle null and never treat it as zero.",
        "transit_slots": slot_info,
        "routers": {"car": "router.project-osrm.org", "walk": "routing.openstreetmap.de/routed-foot",
                    "bike": "routing.openstreetmap.de/routed-bike",
                    "transit": "none" if args.no_transit else "api.transitous.org"},
        "branches": rows,
    }
    write_outputs(doc, MAP_PATH, PAGE_PATH)
    print(f"Saved {len(rows)} branches to data/distance-map.json and app/data/distance.js. Nearest:")
    mins = lambda s: f"{-(-s // 60)}" if s else "?"
    for r in rows[:5]:
        print(f"  {r['name'][:30]:30} {r['straight_km']:5.1f} km  walk {mins(r['walk_s'])}  bike {mins(r['bike_s'])}  car {mins(r['car_s'])} min")
    if not args.no_transit:
        missing = sum(1 for r in rows for s in slots if r[f"transit_{s}_s"] is None)
        print(f"Transit: {len(rows) * 2 - missing} of {len(rows) * 2} guides found, {missing} with no itinerary (saved as null)")
    print("To remove: delete data/distance-map.json, data/distance-transit-cache.json and app/data/distance.js.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Travel times from one start point to every branch.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--origin", required=True, help="LAT,LON of the start point (rounded to 3 decimals)")
    ap.add_argument("--label", default="", help="a name for the start point, shown on the page")
    ap.add_argument("--no-transit", action="store_true", help="skip transit")
    ap.add_argument("--refresh", action="store_true", help="redo the branch list from the feed, and the distances")
    ap.add_argument("--refresh-transit", action="store_true", help="redo only the transit guides")
    ap.add_argument("--days", type=int, default=14, help="feed window used to find branches (with --refresh)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be requested; send nothing")
    args = ap.parse_args(argv)
    try:
        return run(args)
    except Stop as e:
        print("distance-map: " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
