# Calligraphy Composer — UI audit and redesign

The original workspace placed six expanded settings groups and two action panels over the canvas. Mode selection was buried in document setup, the initial text layer was unselected, and Fit / 1:1 controls existed only in a hidden container. At narrower widths, the stacked layout conflicted with the fixed-height shell. Alignment icons also depended on remote Figma asset URLs, and generated fields lacked accessible names.

## Changes implemented

- A warm paper and forest-ink visual system, a typographic identity, quieter controls, and distinct workbench / paper / composition areas.
- Four settings categories: Lettering, Ink, Paper, and Plot. Drawing exposes brush controls contextually. Plotter actions appear with Plot settings.
- A floating tool dock for Compose, Draw, Lasso, Transform, and Focus. The mode and active tool stay synchronized with the existing engine.
- A selectable layer stack with text previews, counts, and immediate updates. The first layer starts selected; adding a layer focuses and selects its text for replacement.
- Searchable quick actions with keyboard navigation, native dialog focus containment, and Escape dismissal.
- Visible zoom, Fit, 1:1, and guide controls. Fixed the existing 1:1 behavior and reserved canvas space for the dock.
- Full-canvas focus mode, contextual interaction hints, and reduced-motion support.
- Desktop columns, compact tablet panels, and a scrollable phone layout with the canvas first.
- Local SVG alignment icons and favicon; accessible labels, pressed states, disabled selection actions, and keyboard focus styling.

## Shortcuts

| Key | Action |
| --- | --- |
| Cmd/Ctrl K | Search quick actions |
| T | Compose text |
| B | Draw |
| L | Lasso strokes |
| V | Transform selected strokes |
| N | Add text layer |
| F | Toggle focus |
| 0 | Fit paper |
| Escape | Close quick actions / exit focus |

Single-key shortcuts are ignored inside editable fields. Plotting is never triggered by a new shortcut.

## Validation

- JavaScript syntax checks passed for `sketch.js` and `studio.js`.
- Live Chrome checks: contextual mode controls, quick-action search and execution, layer creation/deletion, text editing, shortcut isolation while typing, focus mode, Fit, and 1:1 (100%) zoom.
- Desktop and 390px phone visual checks; verified phone settings and text editor remain reachable by scrolling.
- No JavaScript errors in the tested preview. Physical plotting was not exercised.

Existing composition-preset and textured-brush changes were preserved. This update does not add document persistence or full history undo; those remain useful future improvements for longer composition sessions.
