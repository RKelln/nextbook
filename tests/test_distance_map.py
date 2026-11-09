"""tools/distance-map.py with a fake network: the start point is rounded before anything is sent,
nothing is sent on a dry run, null is never a guess, a retry honours Retry-After, the transit
cache resumes and is not shared between start points, and the page file never holds the start point.
No test reaches a real network or waits."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("distance_map", REPO / "tools" / "distance-map.py")
dm = importlib.util.module_from_spec(spec)
sys.modules["distance_map"] = dm
spec.loader.exec_module(dm)


class FakeResponse:
    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Net:
    """Answers each request from the URL: routing tables with a plausible time per branch, transit
    itineraries for some branches, nothing for the rest."""

    def __init__(self, walk_factor=3.0, errors=None):
        self.calls, self.sleeps, self.walk_factor, self.errors = [], [], walk_factor, list(errors or [])
        self.transit_fail = None      # a function of the url: an HTTP status to answer with, or None

    def urlopen(self, req, timeout=0):
        url = req.full_url
        self.calls.append({"url": url, "ua": req.get_header("User-agent")})
        if self.errors:
            code, retry = self.errors.pop(0)
            raise urllib.error.HTTPError(url, code, "x", {"Retry-After": retry} if retry else {}, io.BytesIO(b"x"))
        if "/table/" in url:
            n = len(url.split("destinations=")[1].split("&")[0].split(";"))
            base = 600 if "router.project-osrm.org" in url else int(600 * self.walk_factor)
            return FakeResponse({"code": "Ok", "durations": [[base + 10 * i for i in range(n)]]})
        if "transitous" in url and self.transit_fail:
            code = self.transit_fail(url)
            if code:
                raise urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(b"x"))
        if "transitous" in url:
            to = url.split("toPlace=")[1].split("&")[0]
            if sum(map(ord, to)) % 2:
                return FakeResponse({"itineraries": []})
            return FakeResponse({"itineraries": [{"duration": 1500, "legs": [{"mode": "BUS", "routeShortName": "29"}]}]})
        raise AssertionError("unexpected url " + url)


class DistanceMapTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tmp = Path(self.tmp.name)
        self.saved = {k: getattr(dm, k) for k in ("MAP_PATH", "CACHE_PATH", "PAGE_PATH", "_urlopen", "_sleep")}
        dm.MAP_PATH, dm.CACHE_PATH, dm.PAGE_PATH = tmp / "map.json", tmp / "cache.json", tmp / "distance.js"
        self.net = Net()
        dm._urlopen = self.net.urlopen
        dm._sleep = lambda s: self.net.sleeps.append(s)
        self.addCleanup(lambda: [setattr(dm, k, v) for k, v in self.saved.items()])

    def run_tool(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = dm.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_the_origin_is_rounded_before_anything_is_sent_or_written(self):
        code, out, _ = self.run_tool("--origin", "43.70049,-79.39951", "--label", "test point")
        self.assertEqual(code, 0, out)
        self.assertIn("rounded to 43.700,-79.400", out)
        for call in self.net.calls:
            self.assertNotIn("43.70049", call["url"])
            self.assertNotIn("79.39951", call["url"])
        self.assertTrue(any("-79.4,43.7;" in c["url"] or "-79.400,43.700" in c["url"] or "43.7,-79.4" in c["url"] for c in self.net.calls))
        doc = json.loads(dm.MAP_PATH.read_text())
        self.assertEqual(doc["origin"], [43.7, -79.4])
        self.assertNotIn("43.70049", dm.MAP_PATH.read_text())

    def test_the_page_file_never_holds_the_start_point(self):
        self.run_tool("--origin", "43.7,-79.4", "--label", "test point", "--no-transit")
        page = dm.PAGE_PATH.read_text()
        self.assertTrue(page.startswith("Nextbook.data.put('distance', "))
        self.assertIn("test point", page)
        self.assertNotIn('"origin"', page)
        self.assertNotIn("-79.4,", page.split('"branches"')[0])

    def test_a_dry_run_sends_and_writes_nothing(self):
        code, out, _ = self.run_tool("--origin", "43.7,-79.4", "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(self.net.calls, [])
        self.assertFalse(dm.MAP_PATH.exists() or dm.PAGE_PATH.exists() or dm.CACHE_PATH.exists())
        self.assertIn("would GET", out)

    def test_no_transit_sends_nothing_to_transitous_and_saves_null(self):
        code, _, _ = self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertEqual(code, 0)
        self.assertFalse(any("transitous" in c["url"] for c in self.net.calls))
        rows = json.loads(dm.MAP_PATH.read_text())["branches"]
        self.assertEqual(len(rows), 92)
        self.assertTrue(all(r["transit_weekday_s"] is None and r["transit_weekend_s"] is None for r in rows))

    def test_null_is_never_a_guess(self):
        self.run_tool("--origin", "43.7,-79.4")
        rows = json.loads(dm.MAP_PATH.read_text())["branches"]
        some_none = [r for r in rows if r["transit_weekday_s"] is None]
        self.assertTrue(some_none, "branches with no itinerary stay null")
        self.assertTrue(all(r["transit_weekday_s"] != 0 for r in rows))

    def test_the_user_agent_names_the_project_and_no_person(self):
        self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        ua = self.net.calls[0]["ua"]
        self.assertIn("nextbook", ua)
        self.assertIn("github.com/RKelln/nextbook", ua)
        self.assertNotIn("@", ua)

    def test_a_router_that_ignores_the_profile_stops_the_run(self):
        dm._urlopen = Net(walk_factor=1.0).urlopen
        code, _, err = self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertEqual(code, 1)
        self.assertIn("Sanity check failed", err)
        self.assertFalse(dm.MAP_PATH.exists() or dm.PAGE_PATH.exists())

    def test_a_429_waits_for_the_servers_retry_after(self):
        self.net.errors = [(429, "7")]
        code, _, _ = self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertEqual(code, 0)
        self.assertIn(7, self.net.sleeps)

    def test_repeated_refusal_stops_the_run(self):
        self.net.errors = [(503, None)] * 10
        code, _, err = self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertEqual(code, 1)
        self.assertIn("Stopping", err)

    def test_the_transit_cache_resumes_and_is_not_shared_between_start_points(self):
        self.run_tool("--origin", "43.7,-79.4")
        first = sum(1 for c in self.net.calls if "transitous" in c["url"])
        self.assertEqual(first, 184)
        self.net.calls.clear()
        self.run_tool("--origin", "43.7,-79.4", "--refresh-transit")   # asks again
        self.assertEqual(sum(1 for c in self.net.calls if "transitous" in c["url"]), 184)
        self.net.calls.clear()
        self.run_tool("--origin", "43.7,-79.4")                          # everything is saved
        self.assertEqual(self.net.calls, [], "the same start point asks for nothing again")
        self.run_tool("--origin", "43.8,-79.5")                          # another point
        self.assertEqual(sum(1 for c in self.net.calls if "transitous" in c["url"]), 184, "its own cache")

    def first_branch_to(self):
        row = json.loads((REPO / "data" / "branches.json").read_text())["branches"][0]
        return "toPlace=%s%%2C%s" % (row["lat"], row["lon"]), row

    def test_a_failed_transit_request_is_not_cached_as_no_itinerary(self):
        needle, _ = self.first_branch_to()
        lat = needle.split("=")[1].split("%2C")[0]
        self.net.transit_fail = lambda url: 503 if ("toPlace=" + lat) in url else None
        code, out, _ = self.run_tool("--origin", "43.7,-79.4")
        self.assertEqual(code, 0, out)
        cache = json.loads(dm.CACHE_PATH.read_text())
        self.assertEqual(len(cache), 184 - 2, "the two queries that failed are not saved")
        self.assertIn("got no answer", out)
        # A rerun asks for exactly those two, and now they are saved.
        self.net.calls.clear()
        self.net.transit_fail = None
        self.run_tool("--origin", "43.7,-79.4", "--refresh-transit")
        self.run_tool("--origin", "43.7,-79.4")
        self.assertEqual(len(json.loads(dm.CACHE_PATH.read_text())), 184)

    def test_a_missing_page_or_a_bad_request_is_not_cached_either(self):
        for code in (404, 400):
            dm.CACHE_PATH.unlink(missing_ok=True)
            self.net.transit_fail = lambda url, c=code: c if "toPlace=43.7" in url else None
            self.run_tool("--origin", "43.7,-79.4")
            cache = json.loads(dm.CACHE_PATH.read_text())
            self.assertTrue(all(v is None or "seconds" in v for v in cache.values()))
            self.assertLess(len(cache), 184, "a %d is a failure, not an answer" % code)

    def test_a_run_of_transit_failures_stops_the_run_and_keeps_what_was_saved(self):
        seen = {"n": 0}

        def fail(url):
            seen["n"] += 1
            return 503 if seen["n"] > 12 else None        # 12 requests answer, then every one fails
        self.net.transit_fail = fail
        code, _, err = self.run_tool("--origin", "43.7,-79.4")
        self.assertEqual(code, 1)
        self.assertIn("Transit failed 5 times", err)
        self.assertIn("run the same command again", err)
        cache = json.loads(dm.CACHE_PATH.read_text())
        self.assertEqual(len(cache), 12, "what was saved is kept so a rerun resumes")
        self.assertFalse(dm.MAP_PATH.exists(), "no half map is written")
        # And a rerun carries on from there.
        self.net.transit_fail = None
        self.net.calls.clear()
        self.assertEqual(self.run_tool("--origin", "43.7,-79.4")[0], 0)
        self.assertEqual(sum(1 for c in self.net.calls if "transitous" in c["url"]), 184 - 12)

    def test_a_long_retry_after_is_capped(self):
        self.net.errors = [(429, "99999")]
        self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertTrue(self.net.sleeps)
        self.assertLessEqual(max(self.net.sleeps), dm.MAX_WAIT)

    def test_a_router_that_keeps_saying_429_stops_the_run(self):
        self.net.errors = [(429, "1")] * 10
        code, _, err = self.run_tool("--origin", "43.7,-79.4", "--no-transit")
        self.assertEqual(code, 1)
        self.assertIn("HTTP 429", err)
        self.assertFalse(dm.MAP_PATH.exists() or dm.PAGE_PATH.exists())

    def test_the_page_file_has_no_straight_line_distances_and_the_run_says_where_the_label_goes(self):
        code, out, _ = self.run_tool("--origin", "43.7,-79.4", "--label", "test point", "--no-transit")
        self.assertIn("shown on the page", out)
        self.assertIn("straight_km", dm.MAP_PATH.read_text())
        self.assertNotIn("straight_km", dm.PAGE_PATH.read_text())
        self.assertIn("test point", dm.PAGE_PATH.read_text())

    def test_the_cache_for_another_start_point_is_dropped(self):
        self.run_tool("--origin", "43.7,-79.4")
        self.run_tool("--origin", "43.8,-79.5")
        keys = json.loads(dm.CACHE_PATH.read_text()).keys()
        self.assertEqual({k.split("|")[0] for k in keys}, {dm.origin_key((43.8, -79.5))})

    def test_a_missing_or_bad_origin_is_refused(self):
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                dm.main([])
        code, _, err = self.run_tool("--origin", "nowhere")
        self.assertEqual(code, 1)
        self.assertIn("LAT,LON", err)
        self.assertEqual(self.run_tool("--origin", "95,10")[0], 1)

    def test_the_tool_names_no_event_and_no_home(self):
        text = (REPO / "tools" / "distance-map.py").read_text(encoding="utf-8").lower()
        for word in ("town hall", "demo", "christie", "@"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
