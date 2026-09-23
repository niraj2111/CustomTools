# Vase 2.0

A configurable vase generator based on the original `Vases` sketch. No build step or third-party runtime dependencies.

## Run locally

```sh
cd Vase2.0
python3 server.py
```

Open http://localhost:8765. Change the port with `--port 8766`.

The local server saves records in `data/vases.sqlite3` (ignored by Git). Back up this file to preserve your archive. It listens only on the local computer. This is a local studio, not an authenticated public backend. Before public launch, add user ownership, authentication for the production archive, request limits, and a hosted database.

Opening the static files through another HTTP server also works, with browser storage instead of the studio database. The UI identifies where forms are stored. Browser records can be transferred using their JSON downloads.

## Experience

- Gallery of 11 starting points, with another set available on demand.
- Fourteen controls cover every form and branch parameter from the original sketch: Presence, Openness, Expression, Approach, Release, Stance, Grounding, Center of gravity, Reserve, Foundation, Complexity, Reach, Curiosity, and Variation.
- Six vase colors. The interface and branch remain black and white.
- Optional original seeded recursive branch.
- Lock a control to preserve its value when generating a random vase; Reset restores the editor's starting state.
- Name and save immutable snapshots. Saved forms can be reopened and adjusted as new snapshots.
- Archive workflow: saved → queued → plotted → delivered. Status changes are manual; nothing automatically operates a plotter.
- Download the exact SVG or a portable JSON record; import a record to reopen it.

## Geometry and reproduction

`geometry.mjs` is the single renderer for gallery, editor, and export. It uses the original sketch's usable area, maximum-width formula, vertical line interpolation, straight neck and base segments, two Bézier curves, branch recursion, seeded branching, and terminal dots. Each public control maps directly to one original sketch parameter through a conservative range. Shape and branch are deterministic from state. Line count ranges from 30 to 140 intervals.

Records include schema and generator versions, all control values, seed, resolved original-sketch parameters, chosen color, exact SVG, 210 mm square paper dimensions, name, timestamps, unique ID, and plot status. The vase is exported in its chosen color. The branch is exported in black with the original filled terminal dots. Color is a pen choice, not an automatic pen-change instruction.

## Sharing and backend access

The server binds to `127.0.0.1`, so only this computer can open it. The Saved vases page is the current backend view, and the records are stored in `data/vases.sqlite3`. To share the app publicly, deploy it with a hosted database and access control for the saved-vases view; the local SQLite database is intentionally not public.

The generator version is checked on import. Keep the stored SVG for exact plotting after future generator changes. Draft edits are also retained in the current browser.

## Verify

```sh
node geometry.test.mjs
python3 -m unittest test_server.py
```

The geometry checks cover every control corner and randomized states, sampled profile continuity, canvas bounds, and deterministic rendering. Server checks use isolated temporary databases.
