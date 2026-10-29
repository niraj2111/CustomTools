(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StrokeFontObject = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BRUSH = Object.freeze({
    model: 'pointed',
    width: 44,
    contrast: 0.62,
    angle: 35,
    tin: 0.2,
    tout: 0.35,
  });

  const DEFAULT_FINE = Object.freeze({
    steady: 0.4,
    simplify: 0.4,
    corner: 0.5,
    tension: 0.5,
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createBlankFont(name, sets, brush) {
    const glyphs = {};
    for (const set of sets) {
      for (const character of set.chars) {
        glyphs[character] = {
          adv: set.adv,
          cur: 0,
          v: [{ s: [] }],
        };
      }
    }

    return {
      name: String(name || '').trim() || 'Untitled stroke font',
      fine: clone(DEFAULT_FINE),
      brush: Object.assign({}, DEFAULT_BRUSH, brush || {}),
      glyphs,
    };
  }

  function toFontObject(font, metrics, fineFromSmooth) {
    return {
      format: 'stroke-font/1',
      name: font.name,
      metrics: clone(metrics),
      brush: clone(font.brush),
      glyphs: Object.fromEntries(
        Object.entries(font.glyphs).map(([key, glyph]) => [
          key,
          {
            adv: glyph.adv,
            variants: glyph.v.map((variant) => ({
              strokes: variant.s.map((stroke) => ({
                smooth: stroke.s,
                fine: clone(stroke.f || fineFromSmooth(stroke.s)),
                nodes: stroke.n.map((node) => [
                  node.x,
                  node.y,
                  node.ix,
                  node.iy,
                  node.ox,
                  node.oy,
                  node.c ? 1 : node.sy ? 2 : 0,
                ]),
                raw: clone(stroke.raw),
              })),
            })),
          },
        ]),
      ),
    };
  }

  function safeFilename(name) {
    const base = String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return `${base || 'untitled-stroke-font'}.stroke-font.json`;
  }

  return { createBlankFont, toFontObject, safeFilename };
});
