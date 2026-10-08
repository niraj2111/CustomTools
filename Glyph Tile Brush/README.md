# Glyph Tile Brush

A neighbour-aware tile drawing tool adapted from the original p5 sketch. Paint or erase cells and the tool automatically selects one of 16 connector glyphs from the chosen four-set library.

## Features

- Four original glyph libraries with automatic corner, terminal, junction, and crossing selection.
- Millimetre-based paper presets and viewport fitting through `shared/paper.js`.
- DialKit controls for the brush, paper, appearance, and export settings.
- Standalone vector SVG export through `shared/export.js`; glyph artwork is embedded as SVG symbols.
- Click/drag painting, right-drag erasing, optional grid overlay, random fill, and keyboard shortcuts.

Serve the repository over HTTP and open `Glyph Tile Brush/` from the tool index.
