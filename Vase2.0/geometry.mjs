export const VERSION = '2.2.0';

export const PALETTE = [
  { id: 'cobalt', name: 'Blue', hex: '#2447c6' },
  { id: 'vermilion', name: 'Red', hex: '#c43f2d' },
  { id: 'forest', name: 'Green', hex: '#286247' },
  { id: 'violet', name: 'Violet', hex: '#70469a' },
  { id: 'ochre', name: 'Ochre', hex: '#a16e10' },
  { id: 'black', name: 'Black', hex: '#111111' },
];

export const CONTROLS = [
  { key: 'presence', group: 'body', name: 'Presence', low: 'Quiet', high: 'Expansive' },
  { key: 'openness', group: 'body', name: 'Openness', low: 'Closed', high: 'Open' },
  { key: 'expression', group: 'body', name: 'Expression', low: 'Contained', high: 'Outward' },
  { key: 'approach', group: 'body', name: 'Approach', low: 'Direct', high: 'Gentle' },
  { key: 'release', group: 'body', name: 'Release', low: 'Taut', high: 'Soft' },
  { key: 'stance', group: 'body', name: 'Stance', low: 'Narrow', high: 'Broad' },
  { key: 'grounding', group: 'body', name: 'Grounding', low: 'Light', high: 'Rooted' },
  { key: 'center', group: 'body', name: 'Center of gravity', low: 'High', high: 'Low' },
  { key: 'reserve', group: 'proportion', name: 'Reserve', low: 'Immediate', high: 'Distant' },
  { key: 'foundation', group: 'proportion', name: 'Foundation', low: 'Subtle', high: 'Strong' },
  { key: 'complexity', group: 'proportion', name: 'Complexity', low: 'Spare', high: 'Layered' },
  { key: 'reach', group: 'branch', name: 'Reach', low: 'Near', high: 'Far' },
  { key: 'curiosity', group: 'branch', name: 'Curiosity', low: 'Focused', high: 'Exploring' },
  { key: 'variation', group: 'branch', name: 'Variation', low: 'Ordered', high: 'Unexpected' },
];

export const CONTROL_GROUPS = [
  { id: 'body', name: 'Vase body' },
  { id: 'proportion', name: 'Proportions' },
  { id: 'branch', name: 'Branch' },
];

export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalize(input = {}) {
  const legacyColors = { terracotta: 'vermilion', olive: 'forest', plum: 'violet', ink: 'black' };
  const requestedColor = legacyColors[input.color] || input.color;
  const result = {
    seed: Number.isInteger(input.seed) ? input.seed >>> 0 : 42,
    color: PALETTE.some(color => color.id === requestedColor) ? requestedColor : 'cobalt',
    growth: input.growth === true,
  };
  const legacy = {
    expression: input.openness,
    approach: input.softness,
    release: input.softness,
    stance: input.grounding,
    center: input.grounding,
    complexity: input.texture,
    curiosity: input.softness,
    variation: Number.isInteger(input.seed) ? (input.seed % 10000) / 9999 : undefined,
  };
  for (const { key } of CONTROLS) {
    const value = Number.isFinite(input[key]) ? input[key] : legacy[key];
    result[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  }
  return result;
}

export function fromSeed(seed) {
  const random = rng(seed);
  return normalize({
    seed,
    ...Object.fromEntries(CONTROLS.map(control => [control.key, random()])),
    growth: random() > 0.58,
    color: PALETTE[Math.floor(random() * PALETTE.length)].id,
  });
}

// The controls map into conservative subsets of the original sketch ranges.
// Rendering below still uses the original construction without added shapes.
export function resolve(input) {
  const state = normalize(input);
  return {
    canvasWMM: 210,
    canvasHMM: 210,
    marginMM: 20,
    strokeWeightMM: 0.35,
    neckWidth: 0.14 + state.openness * 0.51,
    rimFlare: 0.16 + state.expression * 0.69,
    baseWidth: 0.18 + state.grounding * 0.62,
    a4: 0.2 + state.stance * 0.8,
    bellyWidth: 0.35 + state.presence * 0.65,
    a2: 0.3 + state.approach * 0.95,
    a3: 0.3 + state.release * 0.95,
    bulbHeightRatio: 0.28 + state.center * 0.42,
    neckDepth: 3 + state.reserve * 21,
    baseDepth: 3 + state.foundation * 21,
    vaseLines: Math.round(30 + state.complexity * 110),
    showBranch: state.growth,
    branchHeightRatio: 0.18 + state.reach * 0.27,
    branchSeed: Math.round(state.variation * 9999),
    branchAngle: 0.18 + state.curiosity * 0.52,
  };
}

const format = value => Number(value.toFixed(3));

// Same construction as Vases/sketch.js: usable area, max-width formula,
// interpolated vertical lines, straight neck/base, and two Bézier curves.
export function geometry(input) {
  const state = normalize(input);
  const p = resolve(state);
  const centerX = p.canvasWMM / 2;
  const centerY = p.canvasHMM / 2;
  const usableW = p.canvasWMM - p.marginMM * 2;
  const usableH = p.canvasHMM - p.marginMM * 2;
  const plantH = p.showBranch ? usableH * p.branchHeightRatio : 0;
  const vaseH = usableH - plantH;
  const artTop = centerY - usableH / 2;
  const vaseY = artTop + plantH;
  const bulbY = vaseH * p.bulbHeightRatio;
  const maxW = (usableW * 0.9) / 1.5;
  const clamp = value => Math.max(-maxW, Math.min(maxW, value));
  const paths = [];

  for (let j = 0; j <= p.vaseLines; j += 1) {
    const factor = -1 + (2 * j) / p.vaseLines;
    const gap = maxW * factor;
    const x = multiplier => format(centerX + clamp(gap * multiplier));
    const top = format(vaseY);
    const neckEnd = format(vaseY + p.neckDepth);
    const bulb = format(vaseY + p.neckDepth + bulbY);
    const baseStart = format(vaseY + vaseH - p.baseDepth);
    const bottom = format(vaseY + vaseH);
    paths.push(`M ${x(p.neckWidth)} ${top} L ${x(p.neckWidth)} ${neckEnd} C ${x(p.rimFlare)} ${neckEnd}, ${x(p.a2)} ${bulb}, ${x(p.bellyWidth)} ${bulb} C ${x(p.a3)} ${bulb}, ${x(p.a4)} ${baseStart}, ${x(p.baseWidth)} ${baseStart} L ${x(p.baseWidth)} ${baseStart} L ${x(p.baseWidth)} ${bottom}`);
  }

  const branchLines = [];
  const branchDots = [];
  if (p.showBranch) {
    const random = rng(p.branchSeed);
    const recurse = (startX, startY, angle, length) => {
      const step = length * 0.4;
      const endX = startX + Math.sin(angle) * step;
      const endY = startY - Math.cos(angle) * step;
      branchLines.push({ x1: format(startX), y1: format(startY), x2: format(endX), y2: format(endY) });
      if (length > 15) {
        recurse(endX, endY, angle + p.branchAngle * (random() * 0.8 + 0.6), length * 0.65);
        recurse(endX, endY, angle - p.branchAngle * (random() * 0.8 + 0.6), length * 0.55);
      } else {
        branchDots.push({ cx: format(endX), cy: format(endY), r: 0.75 });
      }
    };
    recurse(centerX, artTop + plantH, 0, plantH);
  }

  return { params: p, paths, branchLines, branchDots };
}

export function svg(input, { title = 'Vase drawing', record = null } = {}) {
  const state = normalize(input);
  const color = PALETTE.find(item => item.id === state.color).hex;
  const { paths, branchLines, branchDots, params } = geometry(state);
  const escape = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
  const metadata = record ? `<metadata>${escape(JSON.stringify(record))}</metadata>` : '';
  const vase = paths.map(d => `<path d="${d}"/>`).join('');
  const branches = branchLines.map(line => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"/>`).join('');
  const dots = branchDots.map(dot => `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="210mm" viewBox="0 0 210 210" role="img"><title>${escape(title)}</title>${metadata}<g id="vase" fill="none" stroke="${color}" stroke-width="${params.strokeWeightMM}" stroke-linecap="round" stroke-linejoin="round">${vase}</g><g id="branches" fill="none" stroke="#111111" stroke-width="${format(params.strokeWeightMM * 0.7)}" stroke-linecap="round">${branches}</g><g id="branch-tips" fill="#111111" stroke="none">${dots}</g></svg>`;
}
