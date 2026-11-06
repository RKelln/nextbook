---
name: use-nextbook
description: Read or update a person's Nextbook shelf through the local mirror and inbox. Use for requests about their books, ratings, or reading status, not for developing app features.
---

Before the first shelf read or write in a session, say:

“Reading your shelf shares its book titles and ratings with this AI. Writing to the app also exposes the titles and details you ask the AI to add or change. The local connection does not itself send data to an AI service, but anything I read becomes part of this AI conversation.”

If the person has already requested this work, give the warning and proceed within that request. Do not repeat the warning for every operation. Do not enable sharing just to build or test app features. Use practice data for workshops.

## Read

- **Reuse the running app first.** Before starting anything, check whether the app is already being served (the person's project may have a launcher for it, or the address may answer). Use that server and the browser tab already open on it. Never start a second server or open a second tab: a second copy is a separate, empty shelf and confuses people. Sharing is fixed when a server starts, so turning it on may need that one server restarted. Say so in one line first (the app restarts for a moment, and the open tab reloads itself once), restart on the same address and port, and do not start a new server beside it.
- Start `python3 tools/serve.py --mirror` only if nothing is serving the app, and only for an authorized shelf task. Add `--workshop` for practice-only use. Use the printed `127.0.0.1` address. If a server is already running without the flag, explain that it needs restarting with the flag; preserve its port and workshop settings.
- The open page copies only the active shelf to `nextbook-live.json`, about once a second after changes. No manual export is needed. Keep one app tab open for this workflow: multiple tabs can overwrite the mirror with their active shelves.
- Use `python3 tools/read-shelf.py --find 'Piranesi'`, `--key KEY`, or `--state want`. The default limit is 20; request more only when needed. Check `which` (practice or own). The file is a snapshot, not proof a browser is still connected.
- A shelf at `file://` or another port is separate browser storage. Open the person's existing served address; do not claim a fresh empty shelf is their old one. Moving between addresses still needs export/import.

## Write

- Use `python3 tools/inbox.py --add 'Piranesi' --author 'Susanna Clarke' --state read --rating loved`, or `--file records.json` for complete entries. No shelf export is required.
- Inbox records replace whole entries. For a partial update, read the existing entry first and preserve fields the person did not ask to change. If reading is unwanted, explain that you cannot safely preserve unknown fields.
- The inbox applies to the active shelf on reload; confirm the intended shelf before writing. A live-reload server refreshes automatically; otherwise reload. Read the refreshed mirror to verify, and mention the app's “Undo these changes” control.
- Do not edit generated `app/data/inbox.js` by hand. Never invent catalogue identifiers or links.

## Finish

The mirror is off by default. Stop the mirror server to stop updates. The last snapshot remains on disk; tell the person this and remove it if they ask. Never commit or package `nextbook-live.json` or inbox data. Ordinary offline use and the copy/paste AI box do not enable the mirror.
