# Feather

Run the repository with `python3 -m http.server 5173` and open http://localhost:5173/Feather/.

Uses p5.js and Tweakpane 3 with the shared paper and export modules. Nine geometry controls combine the original generator's envelope, barb, noise, and fray settings. The spine is an unfilled closed outline tapering to both tips; barbs start at its edges.

Set 1–12 rows and columns to create up to 144 feathers, drag to position, or rearrange the grid. Changing either grid value immediately creates or removes copies and fits them to the paper. Each instance has independent shape parameters, size, seed, placement, and rotation. Click an instance to load its settings into Tweakpane. New selected changes that feather's seed; New all regenerates every seed. Rearrange grid fits every complete feather into its cell and resets rotations. Size is the nominal spine length in millimeters. Extreme geometry may extend beyond the paper; use Rearrange grid to fit it again.

The preview shows a dashed rectangle for every grid cell and a darker boundary for the selected paper margin. `Show grid guides` under Paper & preview toggles all grid and margin guides. Guides never appear in SVG or PNG exports.

SVG exports physical millimeter dimensions and one group per feather. PNG uses the selected paper size and DPI. Both exclude selection guides. The preview uses the same paths as SVG export. Paper controls include A3/A4/A5 orientations, custom dimensions, zoom and fit.

Two barb colors can be distributed with pattern presets: alternating barbs, fine or broad bands, split sides, base/tip division, chevron bands, or a deterministic seeded mix. The closed spine uses color A. Both colors are preserved as individual path strokes in SVG export.

p5.js and Tweakpane load from the same CDN used by the other projects.
