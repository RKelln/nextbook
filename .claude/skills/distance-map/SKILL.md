---
name: distance-map
description: Make a personal travel-time map so the events screen can show how long each branch takes to reach. Use when a person asks for travel times, distances or "how far" to library events, not for developing app features.
---

Making the map sends the person's start point to public servers, so tell them this before anything runs, in your own plain words:

“To work out travel times, your start point is sent to public routing and transit servers: router.project-osrm.org, routing.openstreetmap.de and api.transitous.org. Their operators can see it. I can see it too, because you tell it to me here. Please give me a nearby intersection or corner, not a home address. The tool rounds it to about 100 metres before it sends anything. The full run takes about 5 minutes. Transit times are a rough guide at two times (a weekday evening and a Saturday afternoon) and go stale after about three weeks. Do you want to go ahead?”

Wait for a yes. Do not run anything before it. If they would rather not send a start point at all, offer `--no-transit` only if they still want walk, bike and car; it still sends the start point to the routing servers, so say so.

## Run

1. Ask for the start point as an intersection or a place name, and for the coordinates if they have them. Work out `LAT,LON` with them; do not guess a place you are not sure of. Show the numbers you will use and the label, and let them change either.
2. Dry run first: `python3 tools/distance-map.py --origin LAT,LON --label "their label" --dry-run`. It sends nothing. Show them what it says it would request.
   The label is saved in the map and shown on the page, so tell them to keep any home address out of it.
3. Then the real run, in the background if your tools allow, because it takes about 5 minutes. Add `--no-transit` for a fast run with no transit guide.
4. If a server answers "too many requests" the tool waits as the server asks (never more than two minutes), then stops. After five transit requests in a row fail it stops too, keeping what it saved, and the same command carries on from there. A failed request is never saved as "no route". Do not loop it or hammer it. Tell the person and try later.

Other options: `--refresh` (read the branch list from the library's feed again, and redo the distances), `--refresh-transit` (redo only transit, for example after three weeks).

## Privacy of what you keep

- Store the start point nowhere except the map's label that the person chose, which the tool saves and the events screen shows, so it must not be a home address. Do not write it into notes, memory, the conversation summary, a commit, a file in the repo, or a message. The tool's own files are the only place it lives.
- The map files are `data/distance-map.json`, `data/distance-transit-cache.json` and `app/data/distance.js`. They are ignored by git and the build never packs them. Never copy them anywhere or paste their contents.
- Tell them where the files are and how to remove every trace: delete those three files. In a browser, "Remove my travel times" on the events screen forgets the copy kept there.

## Finish

Tell them how to see it: open the app from its folder (a folder copy loads `app/data/distance.js` by itself), or on any copy press "Add your travel times" on the events screen and choose `data/distance-map.json`. The times are rough guides; the screen says so.
