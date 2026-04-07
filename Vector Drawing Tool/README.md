# Vector Drawing Tool

Editable multi-stroke vector sketch with:

- drag-to-draw polyline capture
- sparse editable anchors
- A5 to A3 canvas presets
- brush width presets
- flat nib brush preset with nib width and angle
- optional Chaikin smoothing for preview/export
- SVG export in millimeters

## Use

1. Open `index.html` in a static server.
2. Drag on the canvas to create a stroke.
3. Drag an anchor to edit it.
4. Use `Export SVG` to save all strokes.

## Notes

- Each drag creates a new stroke.
- Raw anchors stay editable even when smoothing is enabled.
- `Min Spacing` and `Turn Threshold` keep anchors from blowing up in number.
- `Corner Cut` controls how aggressively Chaikin rounds corners on the live preview and export.
- `FlatNib` stamps fixed-angle nib marks along the stroke for preview and SVG export.
- `Export Spine SVG` exports only the stroke centerlines using the current smoothing mode.
