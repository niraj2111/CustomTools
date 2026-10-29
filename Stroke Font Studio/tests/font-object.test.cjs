const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBlankFont,
  toFontObject,
  safeFilename,
} = require('../font-object.js');

const sets = [
  { chars: ['a', 'b'], adv: 380 },
  { chars: ['A'], adv: 500 },
];

test('createBlankFont builds editable blank glyphs', () => {
  const font = createBlankFont('New Hand', sets, { model: 'mono', width: 20 });

  assert.equal(font.name, 'New Hand');
  assert.deepEqual(Object.keys(font.glyphs), ['a', 'b', 'A']);
  assert.deepEqual(font.glyphs.a, { adv: 380, cur: 0, v: [{ s: [] }] });
  assert.equal(font.brush.model, 'mono');
  assert.equal(font.brush.width, 20);
});

test('toFontObject exports the public stroke-font schema without editor state', () => {
  const font = createBlankFont('Export Test', sets);
  font.glyphs.a.v[0].s.push({
    s: 0.25,
    raw: [[10, 20], [30, 40]],
    n: [{ x: 10, y: 20, ix: 9, iy: 19, ox: 11, oy: 21, c: true, sy: false }],
  });

  const object = toFontObject(font, { asc: 60, base: 600 }, (smooth) => ({ steady: smooth }));

  assert.equal(object.format, 'stroke-font/1');
  assert.equal(object.glyphs.a.variants[0].strokes[0].nodes[0][6], 1);
  assert.deepEqual(object.glyphs.a.variants[0].strokes[0].fine, { steady: 0.25 });
  assert.equal('cur' in object.glyphs.a, false);
});

test('safeFilename produces a portable JSON filename', () => {
  assert.equal(safeFilename('Caf\u00e9 Hand / 02'), 'cafe-hand-02.stroke-font.json');
  assert.equal(safeFilename(''), 'untitled-stroke-font.stroke-font.json');
});
