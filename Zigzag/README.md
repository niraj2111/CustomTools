# P5 Tweakpane SVG Boilerplate

Starter sketch with:

- `p5.js`
- `tweakpane` controls
- canvas size set in millimeters (`mm`) with configurable DPI
- SVG renderer + export button

## Run

Use any static file server and open `index.html`.

Example:

```bash
cd "/Users/niraj/Desktop/Niraj/P5 Sketches/P5 Tweakpane SVG Boilerplate"
python3 -m http.server 5173
```

Then open: `http://localhost:5173`

## Notes

- `widthMM`, `heightMM` and `dpi` are converted to pixels internally:
  - `px = (mm / 25.4) * dpi`
- `Export SVG` downloads a vector `.svg` file of the current render.
