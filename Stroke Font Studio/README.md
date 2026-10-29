# Stroke Font Studio

Stroke Font Studio is a dependency-free browser editor for drawing single-line font skeletons, shaping their brush outlines, previewing text, and exporting reusable font objects.

## Run locally

```sh
cd "Stroke Font Studio"
npm start
```

Open <http://localhost:4173>.

## Font workflow

- Choose **New font…** from the overflow menu to start with a blank character set or a fresh copy of the sample font.
- Draw directly in a glyph tile, or open the detailed editor to adjust curves and stroke order.
- Choose **Export font object (.json)** to download the complete font object.
- Choose **View or import font data…** to inspect, copy, paste, or load the same JSON format.

The exported `stroke-font/1` object includes font metrics, brush settings, glyph advances, alternates, raw pen input, and editable centerline nodes.

## Test

```sh
npm test
```
