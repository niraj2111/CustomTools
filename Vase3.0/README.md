# Vase 3.0

A compact, self-guided workshop tool for making a vase as a portrait without a face.

## Run

```sh
cd Vase3.0
python3 server.py
```

Open <http://localhost:8765>.

## Flow

1. Enter a participant name or code and begin a new journey.
2. Build a vase with adjustable parameters and per-parameter locks. Randomise uses the smooth eased transition from the original `Vases` project and preserves locked values.
3. Add one or more forms, compare them in a compact Choose grid, and select one.
4. Save and download the selected SVG.

The participant name or code is included in the filename, for example `P12-vase.svg`.

## Fixed workshop settings

- Every vase includes a branch.
- Total drawing height: 165 mm.
- Vase body height: 115 mm.
- Branch area: 50 mm.
- Vase line count: 80 and not exposed as a control.
- Paper: A5.

The participant can return home through the logo and jump between available steps once a journey has started. The canvas stays visible in Build and Download. Controls appear in a height-limited overlay that scrolls independently.

## Verify

```sh
node geometry.test.mjs
node workshop.test.mjs
python3 -m unittest test_server.py
```
