# Cloth Studio

An interactive p5 cloth sketch with two mask layers and a local DialKit control panel.

## Run

From the repository root:

```sh
python3 -m http.server 8765
```

Open `http://localhost:8765/ClothSimulation/`. The page has no build step. It uses the repository's shared export helper, a locally vendored DialKit 2.0.2 browser build, and p5 from jsDelivr.

## Using the cloth

- Drag a free point to pull it. Anchored points remain fixed.
- Choose **Tear cloth** to cut threads with a click or stroke. Hold **C** for a temporary tear brush while in Pull mode.
- **Rebuild cloth** restores the current settings and clears manual pulls and cuts. **R** is its shortcut.
- **New random seed** changes organic masks and initial jitter when those features are in use.
- Export the canvas as PNG or the current threads as SVG. **S** exports SVG.
- The ring around the pointer shows the active brush radius. It is a DOM overlay, so it is not included in PNG exports.

## Control behavior

| Group | What it changes | When it takes effect |
| --- | --- | --- |
| Cloth Shape | Grid size, location, anchoring, diagonal threads | Rebuilds the cloth and clears manual edits |
| Motion | Gravity, damping, stiffness, solver passes, rest length, stretch limit | Updates the current cloth immediately |
| Brushes | Grab and cut radii | Applies on the next pointer interaction |
| Appearance | Background clearing, thread width, point and anchor display | Updates the canvas immediately |
| Mesh Mask | Which areas contain cloth points | Rebuilds the mesh mask and cloth |
| Tear Mask | Optional cuts made during a rebuild | Rebuilds the tear mask; only resets cloth when Apply On Rebuild is on |
| Mask Shapes | Rectangle, circle, and organic island geometry shared by both layers | Rebuilds layers currently using that shape |
| Randomness | Seed, initial jitter, noise scale, mask resolution | Rebuilds only the affected layers or cloth |
| Export Options | SVG line width and point inclusion | Used at export time |

The masks are black and white, so their old threshold sliders had no useful effect. They were removed from the UI. The default cloth starts uncut; enable **Tear Mask → Apply On Rebuild** to pre-cut it. DialKit stores values and saved versions in browser storage; **Restore defaults** resets the controls and cloth to the sketch defaults.

The **Background Clearing** slider runs from 0 (long trails) to 255 (fully clear each frame). **Edge Sensitivity** matters when Anchoring is set to Edges. **Start Jitter** must be above zero for Jitter Scale to affect the mesh.

DialKit browser assets and their license are in `vendor/dialkit/`. The implementation uses the documented plain JavaScript adapter and inline root.
