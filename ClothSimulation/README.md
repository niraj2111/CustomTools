# Masked Cloth Tool

Interactive cloth sketch with two independent masks:

- `Mesh Mask` decides where cloth points and constraints exist
- `Tear Mask` pre-cuts the mesh during rebuild
- Tweakpane controls for grid, anchoring, physics, masks, randomness, and rendering
- PNG export plus plain-text SVG export through the shared repo export helpers

## Use

1. Open `index.html` in a static server.
2. Drag to pull the cloth.
3. Hold `C` while dragging, or switch `Interaction > mode` to `tear`, to cut constraints.
4. Adjust mask controls to reshape the mesh and rebuild.
5. Use `Export PNG` or `Export SVG` when you have the result you want.

## Notes

- The sketch now reuses offscreen mask buffers instead of recreating them every rebuild.
- Voronoi seed layouts are cached per mask layer until their settings change.
- Constraint solving uses scalar math in the hot loop to reduce frame-time allocations.
