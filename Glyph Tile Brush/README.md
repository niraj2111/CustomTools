# Glyph Tile Brush

A neighbour-aware tile drawing tool adapted from the original p5 sketch. Paint or erase cells and the tool automatically selects one of 16 connector glyphs from the chosen four-set library.

## Features

- Four original glyph libraries with automatic corner, terminal, junction, and crossing selection.
- Millimetre-based paper presets and viewport fitting through `shared/paper.js`.
- DialKit controls for the brush, paper, appearance, and export settings.
- Portable vector SVG export through `shared/export.js`; glyph paths are embedded inline for reliable import into design and plotter software.
- Click/drag painting, right-drag erasing, optional grid overlay, random fill, and keyboard shortcuts.
- Local photo, video, and webcam input with threshold, Bayer, Floyd–Steinberg, and Atkinson mapping.
- Adaptive live processing, pause/capture editing, and current-frame vector export.

## Media input

Drop or import a browser-supported image or video, or choose **Use Webcam**. Dark source areas activate cells by default. Use the Media Source controls to choose Threshold, Bayer 2×2/4×4/8×8, Floyd–Steinberg, or Atkinson mapping; adjust dither strength, serpentine scanning, framing, inversion, and live frame rate. Pause or capture a moving source before editing the generated grid by hand.

All media processing stays in the browser. Webcam access requires a secure context such as HTTPS or localhost. SVG export includes only the generated glyph artwork, never the source media.

Open `Glyph Tile Brush/index.html` directly or serve the repository over HTTP and open `Glyph Tile Brush/` from the tool index. `glyph-data.js` is the browser-safe runtime bundle generated from the editable `data*/*.svg` source assets; it prevents local `file://` security restrictions from stalling p5 during startup.
