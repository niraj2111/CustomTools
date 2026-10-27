const test = require("node:test");
const assert = require("node:assert/strict");
const MediaSourceUtils = require("./media-utils.js");
const GlyphAssetData = require("./glyph-data.js");

test("bundled glyph data contains all four complete SVG sets", () => {
  assert.deepEqual(Object.keys(GlyphAssetData).sort(), ["data1", "data2", "data3", "data6"]);
  for (const set of Object.values(GlyphAssetData)) {
    assert.equal(Object.keys(set).length, 16);
    for (const source of Object.values(set)) assert.match(source, /<svg[\s>]/i);
  }
});

test("Cover crops the long source axis", () => {
  assert.deepEqual(MediaSourceUtils.computeSourceDraw(200, 100, 100, 100, "Cover"), {
    sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100,
  });
});

test("Contain letterboxes the short target axis", () => {
  assert.deepEqual(MediaSourceUtils.computeSourceDraw(200, 100, 100, 100, "Contain"), {
    sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50,
  });
});

test("Threshold maps dark pixels and composites transparency onto white", () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 0,
    128, 128, 128, 255,
  ]);
  const grid = MediaSourceUtils.mapPixelsToGrid(pixels, 4, 1, {
    mode: "Threshold", threshold: 128, toneBias: 0, invert: false,
  });
  assert.deepEqual([...grid], [1, 0, 0, 1]);
});

test("Inversion activates bright pixels", () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const grid = MediaSourceUtils.mapPixelsToGrid(pixels, 2, 1, {
    mode: "Threshold", threshold: 128, invert: true,
  });
  assert.deepEqual([...grid], [0, 1]);
});

test("Ordered dither is deterministic and distributes a midtone", () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < 16; index += 1) {
    pixels.set([127, 127, 127, 255], index * 4);
  }
  const first = MediaSourceUtils.mapPixelsToGrid(pixels, 4, 4, { mode: "Ordered Dither" });
  const second = MediaSourceUtils.mapPixelsToGrid(pixels, 4, 4, { mode: "Ordered Dither" });
  assert.deepEqual([...first], [...second]);
  assert.equal([...first].reduce((sum, value) => sum + value, 0), 8);
});

test("all Bayer sizes distribute a midtone across half their matrix", () => {
  for (const [mode, size] of [["Bayer 2×2", 2], ["Bayer 4×4", 4], ["Bayer 8×8", 8]]) {
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let index = 0; index < size * size; index += 1) {
      pixels.set([127, 127, 127, 255], index * 4);
    }
    const grid = MediaSourceUtils.mapPixelsToGrid(pixels, size, size, {
      mode,
      threshold: 128,
      ditherStrength: 100,
    });
    assert.equal([...grid].reduce((sum, value) => sum + value, 0), size * size / 2, mode);
  }
});

test("zero dither strength reduces Bayer mapping to threshold mapping", () => {
  const pixels = new Uint8ClampedArray([
    100, 100, 100, 255,
    140, 140, 140, 255,
    120, 120, 120, 255,
    160, 160, 160, 255,
  ]);
  const threshold = MediaSourceUtils.mapPixelsToGrid(pixels, 4, 1, {
    mode: "Threshold", threshold: 128,
  });
  const bayer = MediaSourceUtils.mapPixelsToGrid(pixels, 4, 1, {
    mode: "Bayer 8×8", threshold: 128, ditherStrength: 0,
  });
  assert.deepEqual([...bayer], [...threshold]);
});

test("error-diffusion modes create deterministic mixed-tone patterns", () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) pixels.set([127, 127, 127, 255], index * 4);
  for (const mode of ["Floyd–Steinberg", "Atkinson"]) {
    const work = new Float32Array(64);
    const first = MediaSourceUtils.mapPixelsToGrid(pixels, 8, 8, {
      mode, threshold: 128, ditherStrength: 100, serpentine: true,
    }, undefined, work);
    const second = MediaSourceUtils.mapPixelsToGrid(pixels, 8, 8, {
      mode, threshold: 128, ditherStrength: 100, serpentine: true,
    }, undefined, work);
    const active = [...first].reduce((sum, value) => sum + value, 0);
    assert.ok(active > 0 && active < 64, mode);
    assert.deepEqual([...first], [...second], mode);
  }
});

test("Connectivity keeps the original neighbour-to-glyph mapping", () => {
  const grid = new Uint8Array([
    0, 1, 0,
    1, 1, 1,
    0, 1, 0,
  ]);
  const glyphs = MediaSourceUtils.buildGlyphIds(grid, 3, 3);
  assert.equal(glyphs[4], 13);
  assert.equal(glyphs[1], 1);
  assert.equal(glyphs[3], 4);
  assert.equal(glyphs[5], 2);
  assert.equal(glyphs[7], 3);
});
