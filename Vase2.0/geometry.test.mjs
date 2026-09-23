import assert from 'node:assert/strict';
import { CONTROLS, PALETTE, fromSeed, geometry, normalize, resolve, svg } from './geometry.mjs';

let checked = 0;

function expectedOriginalPath(p, j) {
  const usableW = p.canvasWMM - p.marginMM * 2;
  const usableH = p.canvasHMM - p.marginMM * 2;
  const plantH = p.showBranch ? usableH * p.branchHeightRatio : 0;
  const vaseH = usableH - plantH;
  const vaseY = p.canvasHMM / 2 - usableH / 2 + plantH;
  const maxW = (usableW * 0.9) / 1.5;
  const factor = -1 + (2 * j) / p.vaseLines;
  const gap = maxW * factor;
  const format = value => Number(value.toFixed(3));
  const clamp = value => Math.max(-maxW, Math.min(maxW, value));
  const x = multiplier => format(p.canvasWMM / 2 + clamp(gap * multiplier));
  const top = format(vaseY);
  const neckEnd = format(vaseY + p.neckDepth);
  const bulb = format(vaseY + p.neckDepth + vaseH * p.bulbHeightRatio);
  const baseStart = format(vaseY + vaseH - p.baseDepth);
  const bottom = format(vaseY + vaseH);
  return `M ${x(p.neckWidth)} ${top} L ${x(p.neckWidth)} ${neckEnd} C ${x(p.rimFlare)} ${neckEnd}, ${x(p.a2)} ${bulb}, ${x(p.bellyWidth)} ${bulb} C ${x(p.a3)} ${bulb}, ${x(p.a4)} ${baseStart}, ${x(p.baseWidth)} ${baseStart} L ${x(p.baseWidth)} ${baseStart} L ${x(p.baseWidth)} ${bottom}`;
}

function check(input) {
  const state = normalize(input);
  const p = resolve(state);
  const drawing = geometry(state);

  assert.equal(drawing.paths.length, p.vaseLines + 1);
  assert.equal(drawing.paths[0], expectedOriginalPath(p, 0));
  assert.equal(drawing.paths[Math.floor(p.vaseLines / 2)], expectedOriginalPath(p, Math.floor(p.vaseLines / 2)));
  assert.equal(drawing.paths[p.vaseLines], expectedOriginalPath(p, p.vaseLines));
  assert.ok(p.neckWidth >= 0.14 && p.neckWidth <= 0.65);
  assert.ok(p.rimFlare >= 0.16 && p.rimFlare <= 0.85);
  assert.ok(p.baseWidth >= 0.18 && p.baseWidth <= 0.8);
  assert.ok(p.a4 >= 0.2 && p.a4 <= 1);
  assert.ok(p.bellyWidth >= 0.35 && p.bellyWidth <= 1);
  assert.ok(p.a2 >= 0.3 && p.a2 <= 1.25 && p.a3 >= 0.3 && p.a3 <= 1.25);
  assert.ok(p.bulbHeightRatio >= 0.28 && p.bulbHeightRatio <= 0.7);
  assert.ok(p.neckDepth >= 3 && p.neckDepth <= 24);
  assert.ok(p.baseDepth >= 3 && p.baseDepth <= 24);
  assert.ok(p.vaseLines >= 30 && p.vaseLines <= 140);
  assert.ok(p.branchHeightRatio >= 0.18 && p.branchHeightRatio <= 0.45);
  assert.ok(p.branchAngle >= 0.18 && p.branchAngle <= 0.7);
  assert.ok(p.branchSeed >= 0 && p.branchSeed <= 9999);

  for (const path of drawing.paths) {
    const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.ok(numbers.every(Number.isFinite));
    for (let index = 0; index < numbers.length; index += 2) {
      assert.ok(numbers[index] >= 0 && numbers[index] <= 210, 'Vase x-coordinate stays on paper');
      assert.ok(numbers[index + 1] >= 0 && numbers[index + 1] <= 210, 'Vase y-coordinate stays on paper');
    }
  }

  if (p.showBranch) {
    assert.ok(drawing.branchLines.length > 1);
    assert.ok(drawing.branchDots.length > 0);
    for (const line of drawing.branchLines) {
      assert.ok([line.x1, line.y1, line.x2, line.y2].every(value => value >= 0 && value <= 210));
    }
  } else {
    assert.equal(drawing.branchLines.length, 0);
    assert.equal(drawing.branchDots.length, 0);
  }

  const output = svg(state);
  assert.equal(output, svg(state), 'State and seed reproduce exactly');
  assert.ok(output.includes(`<g id="vase" fill="none" stroke="${PALETTE.find(color => color.id === state.color).hex}"`));
  assert.ok(output.includes('<g id="branches" fill="none" stroke="#111111"'));
  assert.ok(!output.includes('<rect'), 'SVG has no paper/background plot path');
  checked += 1;
}

const cornerStates = [
  Object.fromEntries(CONTROLS.map(control => [control.key, 0])),
  Object.fromEntries(CONTROLS.map(control => [control.key, 1])),
];
for (const control of CONTROLS) {
  for (const value of [0, 1]) {
    cornerStates.push({ ...Object.fromEntries(CONTROLS.map(item => [item.key, 0.5])), [control.key]: value });
  }
}
for (const corner of cornerStates) {
  for (const growth of [false, true]) {
    for (const seed of [0, 42, 0xffffffff]) {
      check({ ...corner, seed, growth });
    }
  }
}
for (let index = 0; index < 1500; index += 1) check(fromSeed(index * 7187));

const state = fromSeed(8121);
assert.equal(svg(JSON.parse(JSON.stringify(state))), svg(state), 'JSON round-trip preserves drawing');
assert.notEqual(svg({ ...state, color: 'black' }), svg({ ...state, color: 'cobalt' }), 'Color changes only the vase group');

const colored = svg({ ...state, growth: true, color: 'vermilion' });
assert.match(colored, /<g id="vase"[^>]+stroke="#c43f2d"/);
assert.match(colored, /<g id="branches"[^>]+stroke="#111111"/);
assert.match(colored, /<g id="branch-tips" fill="#111111"/);

console.log(`Passed: ${checked} states across all 14 control limits; original path equivalence, branch structure, deterministic SVG, and color isolation.`);
