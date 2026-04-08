# Calligraphy Object Tool

Editable calligraphy-object sketch with:

- drag-to-draw spine capture
- sparse editable spine anchors
- A5 to A3 canvas presets
- object-level brush and nib settings
- object-level smoothing and export mode
- SVG export in millimeters

## Use

1. Open `index.html` in a static server.
2. Drag on the canvas to create a calligraphy object.
3. Use the `Layers` panel to select the active object.
4. Drag an anchor to edit the object's spine.
5. Use `Export SVG` or `Export Spine SVG` depending on your output goal.

## Notes

- Each drag creates a new object.
- Raw anchors stay editable even when smoothing is enabled.
- `New Object Defaults` affect only newly created objects.
- `Active Object` controls affect only the selected object.
- `Export Spine SVG` exports object centerlines using the current smoothing mode.
