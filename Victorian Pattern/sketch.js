// ============================= CORE (pure, no rendering deps) =============================
const TAU = Math.PI * 2;
const PI = Math.PI;
const BASE_W = 1500;
const BASE_H = 900;
const { CANVAS_PRESETS, applyMotifPreset, createAppState, resetAppState } = window.VictorianPatternState;
const { bindButtons, buildPane, updateStats } = window.VictorianPatternControls;
const { downloadPng, downloadSvg } = window.VictorianPatternExport;
const { resetCanvasView, syncCanvasSize, updateCanvasDisplaySize } = window.VictorianPatternCanvas;

// ---- seeded RNG (mulberry32) ----
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

let R = mulberry32(1);
const rnd = (a = 1, b) => (b === undefined ? R() * a : a + R() * (b - a));
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const chance = (p) => R() < p;
const normalizeVec = (x, y) => {
  const mag = Math.hypot(x, y) || 1;
  return [x / mag, y / mag];
};

// ---- exact arc primitives ----
// An arc is {cx, cy, r, a0, da}. Point(t) at angle a0 + da*t, t in [0,1].
// arcFrom: given start point P, UNIT tangent T, radius r, turn sign s (+1 = center on
// left of T = counter-clockwise travel), sweep phi (>0) -> returns arc + exact end
// point/tangent. Tangency is by construction: center sits on the normal through P.
function arcFrom(px, py, tx, ty, r, s, phi) {
  const cx = px + s * -ty * r;
  const cy = py + s * tx * r;
  const a0 = Math.atan2(py - cy, px - cx);
  const da = s * phi;
  const a1 = a0 + da;
  const ex = cx + Math.cos(a1) * r;
  const ey = cy + Math.sin(a1) * r;
  const c = Math.cos(da);
  const sn = Math.sin(da);
  return {
    arc: { cx, cy, r, a0, da },
    ex,
    ey,
    etx: tx * c - ty * sn,
    ety: tx * sn + ty * c,
  };
}

const arcLen = (a) => Math.abs(a.da) * a.r;

function arcPointAt(a, t) {
  const g = a.a0 + a.da * t;
  return [a.cx + Math.cos(g) * a.r, a.cy + Math.sin(g) * a.r];
}

function arcTangentAt(a, t) {
  const g = a.a0 + a.da * t;
  const s = Math.sign(a.da) || 1;
  return [-Math.sin(g) * s, Math.cos(g) * s];
}

function reverseArcs(arcs) {
  return arcs
    .slice()
    .reverse()
    .map((a) => ({ cx: a.cx, cy: a.cy, r: a.r, a0: a.a0 + a.da, da: -a.da }));
}

function arcToPointWithTangent(px, py, tx, ty, qx, qy, preferredSign = 1) {
  const normalX = -ty;
  const normalY = tx;
  const dx = qx - px;
  const dy = qy - py;
  const distanceSq = dx * dx + dy * dy;
  const signs = preferredSign >= 0 ? [1, -1] : [-1, 1];

  for (const sign of signs) {
    const normalDot = dx * normalX + dy * normalY;
    const denom = 2 * sign * normalDot;
    if (Math.abs(denom) < 1e-6) {
      continue;
    }

    const radius = distanceSq / denom;
    if (!(radius > 1e-6)) {
      continue;
    }

    const cx = px + sign * normalX * radius;
    const cy = py + sign * normalY * radius;
    const a0 = Math.atan2(py - cy, px - cx);
    let a1 = Math.atan2(qy - cy, qx - cx);
    let da = a1 - a0;

    if (sign > 0) {
      while (da <= 0) da += TAU;
    } else {
      while (da >= 0) da -= TAU;
    }

    if (Math.abs(da) < 1e-4 || Math.abs(da) > Math.PI * 1.85) {
      continue;
    }

    return { cx, cy, r: radius, a0, da };
  }

  return null;
}

// ---- logarithmic spiral as chained quarter-arcs (classical construction) ----
// Each successive quarter-arc's radius is r *= k. The next center lies on the radial
// line through the join point, so tangency is exact. This is a G1 piecewise-circular
// approximation of r = r0 * e^(b*theta) with k = e^(b*PI/2).
function spiralArcs(px, py, tx, ty, s, r0, k, quarters) {
  const arcs = [];
  let P = [px, py];
  let T = [tx, ty];
  let r = r0;

  for (let i = 0; i < quarters; i++) {
    if (r < 1.1) {
      break;
    }
    const { arc, ex, ey, etx, ety } = arcFrom(P[0], P[1], T[0], T[1], r, s, PI / 2);
    arcs.push(arc);
    P = [ex, ey];
    T = [etx, ety];
    r *= k;
  }

  return { arcs, end: P, endT: T };
}

// ---- teardrop leaf: two exact circular arcs (vesica), pointed at both ends ----
function teardropArcs(P, d, L) {
  const Tp = [P[0] + d[0] * L, P[1] + d[1] * L];
  const mid = [(P[0] + Tp[0]) / 2, (P[1] + Tp[1]) / 2];
  const n = [-d[1], d[0]];
  const sag = L * 0.33;
  const r = (L * L / 4 + sag * sag) / (2 * sag);
  const out = [];

  for (const sig of [1, -1]) {
    const C = [mid[0] + sig * n[0] * (r - sag), mid[1] + sig * n[1] * (r - sag)];
    const a0 = Math.atan2(P[1] - C[1], P[0] - C[0]);
    let a1 = Math.atan2(Tp[1] - C[1], Tp[0] - C[0]);
    let da = a1 - a0;
    while (da > PI) da -= TAU;
    while (da < -PI) da += TAU;
    out.push({ cx: C[0], cy: C[1], r, a0, da });
  }

  return out;
}

// ---- sampling a chain of arcs (for collision + rendering) ----
function sampleArcs(arcs, step) {
  const out = [];
  let acc = 0;

  for (const a of arcs) {
    const L = arcLen(a);
    const n = Math.max(2, Math.ceil(L / step));
    for (let i = 0; i <= n; i++) {
      if (out.length && i === 0) {
        continue;
      }
      const t = i / n;
      const [x, y] = arcPointAt(a, t);
      const [tx, ty] = arcTangentAt(a, t);
      out.push({
        x,
        y,
        tx,
        ty,
        s: acc + L * t,
        r: a.r,
        dir: Math.sign(a.da) || 1,
        cx: a.cx,
        cy: a.cy,
        arc: a,
      });
    }
    acc += L;
  }

  return out;
}

const chainLen = (arcs) => arcs.reduce((s, a) => s + arcLen(a), 0);

// ---- spatial hash grid ----
function makeGrid(cell) {
  const map = new Map();
  const key = (i, j) => i * 100003 + j;

  return {
    insert(x, y) {
      const i = Math.floor(x / cell);
      const j = Math.floor(y / cell);
      const k = key(i, j);
      let bucket = map.get(k);
      if (!bucket) {
        bucket = [];
        map.set(k, bucket);
      }
      bucket.push([x, y]);
    },
    near(x, y, rad) {
      const i0 = Math.floor((x - rad) / cell);
      const i1 = Math.floor((x + rad) / cell);
      const j0 = Math.floor((y - rad) / cell);
      const j1 = Math.floor((y + rad) / cell);
      const r2 = rad * rad;

      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const bucket = map.get(key(i, j));
          if (!bucket) {
            continue;
          }
          for (const p of bucket) {
            const dx = p[0] - x;
            const dy = p[1] - y;
            if (dx * dx + dy * dy < r2) {
              return true;
            }
          }
        }
      }
      return false;
    },
  };
}

// ============================= GROWTH SYSTEM =============================
const appState = createAppState({ canvasWidth: BASE_W, canvasHeight: BASE_H });
let params = appState.params;
let model = null;
let compositionFlow = null;
let pane;
let cnv;
let activeManualSpawnIndex = -1;
let isDraggingManualSpawnAngle = false;

const BASE_MARGIN = 30;
const STROKE_WEIGHT = 2;

function stageWidth() {
  return appState.designWidth || BASE_W;
}

function stageHeight() {
  return appState.designHeight || BASE_H;
}

function stageScale() {
  return Math.min(stageWidth() / BASE_W, stageHeight() / BASE_H);
}

function su(value) {
  return value * stageScale();
}

function margin() {
  return BASE_MARGIN * stageScale();
}

function isPlacedSpawnMotif() {
  return appState.motifPreset === "placedSpawns";
}

function reflectedPlacementPoints(point) {
  const points = [{ x: point.x, y: point.y }];

  if (params.mirror) {
    points.push({ x: stageWidth() - point.x, y: point.y });
  }
  if (params.verticalSymmetry) {
    points.push(...points.map((item) => ({ x: item.x, y: stageHeight() - item.y })));
  }

  return points.filter(
    (item, index, all) =>
      all.findIndex(
        (other) => Math.abs(other.x - item.x) < 0.001 && Math.abs(other.y - item.y) < 0.001
      ) === index
  );
}

function pointFromCanvasEvent(event) {
  if (!cnv?.elt || !event) {
    return null;
  }

  const rect = cnv.elt.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * stageWidth(),
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * stageHeight(),
  };
}

function launchAngleForPoint(point) {
  return point.launchAngle ?? flowAngleAt(point.x, point.y, "spine");
}

function mirrorAngleX(angle) {
  return PI - angle;
}

function mirrorAngleY(angle) {
  return -angle;
}

function reflectedPlacementCopies(point) {
  const copies = [{ x: point.x, y: point.y, launchAngle: launchAngleForPoint(point), isBase: true }];

  if (params.mirror) {
    copies.push({
      x: stageWidth() - point.x,
      y: point.y,
      launchAngle: mirrorAngleX(launchAngleForPoint(point)),
      isBase: false,
    });
  }
  if (params.verticalSymmetry) {
    copies.push(
      ...copies.map((item) => ({
        x: item.x,
        y: stageHeight() - item.y,
        launchAngle: mirrorAngleY(item.launchAngle),
        isBase: false,
      }))
    );
  }

  return copies.filter(
    (item, index, all) =>
      all.findIndex(
        (other) =>
          Math.abs(other.x - item.x) < 0.001 &&
          Math.abs(other.y - item.y) < 0.001 &&
          Math.abs(angleBetween(other.launchAngle, item.launchAngle)) < 0.001
      ) === index
  );
}

function updateManualSpawnLaunchAngle(index, x, y) {
  const point = appState.manualSpawnPoints[index];
  if (!point) {
    return false;
  }

  const dx = x - point.x;
  const dy = y - point.y;
  if (Math.hypot(dx, dy) < su(8)) {
    return false;
  }

  point.launchAngle = Math.atan2(dy, dx);
  return true;
}

function findManualSpawnIndex(x, y, threshold = su(22)) {
  let bestIndex = -1;
  let bestDist = threshold;

  for (let i = 0; i < appState.manualSpawnPoints.length; i++) {
    const point = appState.manualSpawnPoints[i];
    const dist = Math.hypot(point.x - x, point.y - y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function stageVoid() {
  const mask = appState.voidMask;
  const width = stageWidth();
  const height = stageHeight();
  const w = (width * mask.wPct) / 100;
  const h = (height * mask.hPct) / 100;
  const cx = (width * mask.xPct) / 100;
  const cy = (height * mask.yPct) / 100;
  return {
    shape: mask.shape,
    cx,
    cy,
    rx: w * 0.5,
    ry: h * 0.5,
    x: cx - w * 0.5,
    y: cy - h * 0.5,
    width: w,
    height: h,
  };
}

function inVoid(x, y) {
  if (!params.voidOn) {
    return false;
  }
  const currentVoid = stageVoid();
  if (currentVoid.shape === "rect") {
    return (
      x > currentVoid.x &&
      x < currentVoid.x + currentVoid.width &&
      y > currentVoid.y &&
      y < currentVoid.y + currentVoid.height
    );
  }
  const dx = (x - currentVoid.cx) / currentVoid.rx;
  const dy = (y - currentVoid.cy) / currentVoid.ry;
  return dx * dx + dy * dy < 1;
}

function inVoidWithSymmetry(x, y) {
  if (inVoid(x, y)) {
    return true;
  }
  if (params.mirror && inVoid(stageWidth() - x, y)) {
    return true;
  }
  if (params.verticalSymmetry && inVoid(x, stageHeight() - y)) {
    return true;
  }
  if (params.mirror && params.verticalSymmetry && inVoid(stageWidth() - x, stageHeight() - y)) {
    return true;
  }
  return false;
}

function manualSpawnAllowed(point) {
  return !inVoidWithSymmetry(point.x, point.y);
}

function drawVoidMask() {
  if (!params.voidOn) {
    return;
  }
  const currentVoid = stageVoid();
  push();
  noStroke();
  fill(appState.invertPreview ? "#f6f4ee" : "#0e0e10");
  if (currentVoid.shape === "rect") {
    rect(currentVoid.x, currentVoid.y, currentVoid.width, currentVoid.height);
  } else {
    ellipse(currentVoid.cx, currentVoid.cy, currentVoid.rx * 2, currentVoid.ry * 2);
  }
  pop();
}

function inBounds(x, y) {
  const m = margin();
  return x > m && x < stageWidth() - m && y > m && y < stageHeight() - m;
}

function testChain(samples, grid, skipLen = 0, skipTailLen = 0) {
  const cl = params.clearance;
  const seamX = params.mirror ? stageWidth() / 2 - cl * 0.5 : Infinity;
  const seamY = params.verticalSymmetry ? stageHeight() / 2 + cl * 0.5 : -Infinity;
  const total = samples.length ? samples[samples.length - 1].s : 0;

  for (const p of samples) {
    if (!inBounds(p.x, p.y) || inVoidWithSymmetry(p.x, p.y) || p.x > seamX || p.y < seamY) {
      return false;
    }
    let rad = cl;
    if (skipLen > 0 && p.s < skipLen) {
      rad = Math.min(rad, cl * Math.pow(p.s / skipLen, 2));
    }
    if (skipTailLen > 0 && total - p.s < skipTailLen) {
      rad = Math.min(rad, cl * Math.pow((total - p.s) / skipTailLen, 2));
    }
    if (rad > 0.5 && grid.near(p.x, p.y, rad)) {
      return false;
    }
  }
  return true;
}

function acceptChain(chain, samples, grid) {
  const width = stageWidth();
  const height = stageHeight();
  for (const p of samples) {
    grid.insert(p.x, p.y);
    if (params.mirror) {
      grid.insert(width - p.x, p.y);
    }
    if (params.verticalSymmetry) {
      grid.insert(p.x, height - p.y);
    }
    if (params.mirror && params.verticalSymmetry) {
      grid.insert(width - p.x, height - p.y);
    }
  }
  model.chains.push(chain);
}

function sampleClosedPath(points, closed = true) {
  if (!points || points.length < 2) {
    return [];
  }

  const out = [];
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (i > 0) {
      s += Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y);
    }
    out.push({ x: point.x, y: point.y, s });
  }

  if (closed) {
    const first = points[0];
    const last = points[points.length - 1];
    s += Math.hypot(first.x - last.x, first.y - last.y);
    out.push({ x: first.x, y: first.y, s });
  }

  return out;
}

function sampleOrnamentPaths(paths) {
  const samples = [];
  let offset = 0;

  for (const path of paths) {
    const pathSamples = sampleClosedPath(path, true);
    for (const sample of pathSamples) {
      samples.push({ x: sample.x, y: sample.y, s: sample.s + offset });
    }
    if (pathSamples.length) {
      offset = samples[samples.length - 1].s;
    }
  }

  return samples;
}

function rotatePoint(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  };
}

function translatePath(points, cx, cy, angle = 0) {
  return points.map((point) => {
    const rotated = angle === 0 ? point : rotatePoint(point, angle);
    return {
      x: cx + rotated.x,
      y: cy + rotated.y,
    };
  });
}

function buildFlowerPetalLocalPoints(rx, ry, count = 32) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1)) * TAU;
    points.push({
      x: Math.sin(t) * rx,
      y: -Math.cos(t) * ry,
    });
  }
  return points;
}

function buildCurvedDiamondLocalPoints(rx, ry, count = 72) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU;
    const x = rx * Math.pow(Math.cos(t), 3);
    const y = ry * Math.pow(Math.sin(t), 3);
    const rotated = rotatePoint({ x, y }, PI / 4);
    points.push(rotated);
  }
  return points;
}

function buildSpaceOrnamentAt(x, y) {
  const angle = flowAngleAt(x, y, "floating") + rnd(-0.5, 0.5);
  const type = chance(0.55) ? "flower" : "diamond";
  const paths = [];

  if (type === "flower") {
    const petalW = rnd(su(10), su(18));
    const petalH = rnd(su(18), su(30));
    const centerOffset = petalH * 0.58;
    const petal = buildFlowerPetalLocalPoints(petalW, petalH, 28);
    for (let i = 0; i < 4; i++) {
      const petalAngle = angle + i * (PI / 2);
      const center = rotatePoint({ x: 0, y: -centerOffset }, petalAngle);
      paths.push(
        translatePath(petal, x + center.x, y + center.y, petalAngle)
      );
    }
  } else {
    const rx = rnd(su(18), su(30));
    const ry = rnd(su(18), su(30));
    paths.push(translatePath(buildCurvedDiamondLocalPoints(rx, ry, 64), x, y, angle));
  }

  const samples = sampleOrnamentPaths(paths);
  if (!samples.length) {
    return null;
  }

  return {
    kind: "ornament",
    ornamentType: type,
    paths,
    wBase: STROKE_WEIGHT,
    samples,
  };
}

function tryPlaceSpaceOrnament(grid, seed) {
  for (let tries = 0; tries < 4; tries++) {
    const ornament = buildSpaceOrnamentAt(seed.x, seed.y);
    if (!ornament) {
      continue;
    }
    if (!testChain(ornament.samples, grid, 0)) {
      continue;
    }
    acceptChain(ornament, ornament.samples, grid);
    return ornament;
  }

  return null;
}

function quartersFromTurns() {
  return Math.round(params.turns * 4);
}

function initCompositionFlow() {
  const baseAngle = rnd(-1.18, -0.72);
  const spineJitter = rnd(0.14, 0.24);
  const floatingJitter = spineJitter * 0.65;
  const lateralFan = rnd(0.22, 0.42);
  const verticalLift = rnd(0.08, 0.2);
  const waveAmp = rnd(0.05, 0.12);
  const waveFreq = rnd(1.4, 2.3);
  const noiseScale = rnd(1.6, 3.4);
  compositionFlow = {
    baseAngle,
    spineJitter,
    floatingJitter,
    lateralFan,
    verticalLift,
    waveAmp,
    waveFreq,
    noiseScale,
  };
}

function flowAngleAt(x, y, role = "spine") {
  const width = stageWidth();
  const height = stageHeight();
  const nx = constrain(x / Math.max(1, width), 0, 1);
  const ny = constrain(y / Math.max(1, height), 0, 1);
  const centeredX = nx - 0.5;
  const centeredY = ny - 0.5;
  const jitter = role === "floating" ? compositionFlow.floatingJitter : compositionFlow.spineJitter;

  // Fan inward from the sides so the composition wraps toward the center.
  const fan = -centeredX * compositionFlow.lateralFan;
  // Lower stems launch more upright; higher stems relax into lateral motion.
  const verticalBias = (0.5 - ny) * compositionFlow.verticalLift;
  // Add a gentle engraved-wave drift so the field is not purely linear.
  const wave =
    Math.sin(nx * Math.PI * compositionFlow.waveFreq + ny * Math.PI * 0.85) *
    compositionFlow.waveAmp;
  // Spatial noise adds local variation while preserving the global sweep.
  const local =
    map(
      noise(
        nx * compositionFlow.noiseScale + 17.3,
        ny * compositionFlow.noiseScale + 41.7,
        role === "floating" ? 0.73 : 0.31
      ),
      0,
      1,
      -jitter,
      jitter
    ) *
    (role === "floating" ? 1.15 : 0.9);
  const centerSettling = -centeredY * 0.03;

  return compositionFlow.baseAngle + fan + verticalBias + wave + local + centerSettling;
}

function appendArcPhase(arcs, P, T, sign, radiusRange, sweepRange) {
  const { arc, ex, ey, etx, ety } = arcFrom(
    P[0],
    P[1],
    T[0],
    T[1],
    rnd(radiusRange[0], radiusRange[1]),
    sign,
    rnd(sweepRange[0], sweepRange[1])
  );
  arcs.push(arc);
  return { P: [ex, ey], T: [etx, ety] };
}

function derivedSpiralRadius(hostRadius, role, scale = 1) {
  const unit = stageScale();
  let factor = 0.22;
  let minRadius = 16 * unit;
  let maxRadius = 56 * unit;

  if (role === "branch") {
    factor = 0.42;
    minRadius = 14 * unit;
    maxRadius = 44 * unit;
  } else if (role === "floating") {
    factor = 0.38;
    minRadius = 14 * unit;
    maxRadius = 40 * unit;
  }

  return Math.max(minRadius * scale, Math.min(maxRadius * scale, hostRadius * factor * rnd(0.85, 1.15)));
}

function growthBoost(depth, scale, terminalBias = 0.5) {
  const depthBoost = Math.min(1.4, 1 + depth * 0.16);
  const scaleBoost = Math.min(1.25, 0.9 + scale * 0.45);
  const terminalBoost = 0.9 + terminalBias * 0.35;
  return depthBoost * scaleBoost * terminalBoost;
}

function appendTerminalTransition(
  arcs,
  P,
  T,
  sign,
  hostRadius,
  targetRadius,
  scale = 1,
  role = "spine"
) {
  let sweepMin = 0.18;
  let sweepMax = 0.34;
  let mix = 0.6;

  if (role === "spine") {
    sweepMin = 0.16;
    sweepMax = 0.28;
    mix = 0.72;
  }

  const blendedRadius = hostRadius * mix + targetRadius * (1 - mix);
  const radius = Math.max(targetRadius * 1.18, Math.min(hostRadius * 0.96, blendedRadius));
  return appendArcPhase(arcs, P, T, sign, [radius, radius * 1.06], [sweepMin, sweepMax]);
}

function terminalQuarterTurns(hasReversal, role) {
  if (hasReversal) {
    return role === "spine" ? 1 : 1;
  }
  return role === "spine" ? Math.min(2, quartersFromTurns()) : quartersFromTurns();
}

function makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex) {
  return { bodyEndIndex, transitionIndex, terminalStartIndex };
}

function buildTerminalLeafFromSpiral(terminalArcs, role = "branch") {
  if (!terminalArcs || !terminalArcs.length) {
    return null;
  }

  const outer = terminalArcs.map((arc) => ({ ...arc }));
  const first = terminalArcs[0];
  const last = terminalArcs[terminalArcs.length - 1];
  const outerStart = arcPointAt(first, 0);
  const outerStartTangent = arcTangentAt(first, 0);
  const outerTip = arcPointAt(last, 1);
  const outerTipTangent = arcTangentAt(last, 1);
  const sign = Math.sign(last.da) || 1;
  const inner = [];
  const curveAmount = Math.max(0, Math.min(1, params.leafCurvature ?? 0.62));
  const innerBaseShift = 0.4;
  const terminalSamples = sampleArcs(terminalArcs, 2);
  const terminalTotal = terminalSamples.length ? terminalSamples[terminalSamples.length - 1].s : 0;
  const innerStartSample =
    terminalSamples.find((sample) => terminalTotal > 0 && sample.s / terminalTotal >= innerBaseShift) ||
    terminalSamples[0];
  const innerStart = innerStartSample ? [innerStartSample.x, innerStartSample.y] : outerStart;
  const innerStartTangent = innerStartSample
    ? [innerStartSample.tx, innerStartSample.ty]
    : outerStartTangent;
  const innerStartRadius = innerStartSample?.r ?? first.r;
  const siblingScale =
    role === "spine" ? lerp(0.18, 0.4, curveAmount) : lerp(0.16, 0.36, curveAmount);
  const siblingDecay = constrain(params.decay * lerp(0.72, 0.88, curveAmount), 0.15, 0.92);
  const siblingQuarters = Math.max(
    1,
    Math.min(terminalArcs.length + 1, Math.round(terminalArcs.length + lerp(0, 1, curveAmount)))
  );
  const siblingSpiral = spiralArcs(
    innerStart[0],
    innerStart[1],
    innerStartTangent[0],
    innerStartTangent[1],
    sign,
    Math.max(su(3), innerStartRadius * siblingScale),
    siblingDecay,
    siblingQuarters
  );
  const siblingArcs = siblingSpiral.arcs;

  if (siblingArcs.length) {
    const siblingEnd = siblingSpiral.end;
    const closingPreferredSign = curveAmount < 0.45 ? -sign : sign;
    let backwardClosingArc = arcToPointWithTangent(
      outerTip[0],
      outerTip[1],
      -outerTipTangent[0],
      -outerTipTangent[1],
      siblingEnd[0],
      siblingEnd[1],
      closingPreferredSign
    );
    if (!backwardClosingArc) {
      backwardClosingArc = arcToPointWithTangent(
        outerTip[0],
        outerTip[1],
        -outerTipTangent[0],
        -outerTipTangent[1],
        siblingEnd[0],
        siblingEnd[1],
        -closingPreferredSign
      );
    }

    if (backwardClosingArc) {
      const closingArc = reverseArcs([backwardClosingArc])[0];
      const maxClosingSweep = lerp(1.2, 2.55, curveAmount);
      if (Math.abs(closingArc.da) <= maxClosingSweep) {
        inner.push(...siblingArcs, closingArc);
      }
    }
  }

  if (!inner.length) {
    const chordTangent = normalizeVec(outerTip[0] - outerStart[0], outerTip[1] - outerStart[1]);
    const tangentBias = Math.min(1, curveAmount * 0.75);
    const tangentBlend = normalizeVec(
      chordTangent[0] * (1 - tangentBias) + innerStartTangent[0] * tangentBias,
      chordTangent[1] * (1 - tangentBias) + innerStartTangent[1] * tangentBias
    );
    let fallback = arcToPointWithTangent(
      innerStart[0],
      innerStart[1],
      tangentBlend[0],
      tangentBlend[1],
      outerTip[0],
      outerTip[1],
      sign
    );
    if (!fallback) {
      fallback = arcToPointWithTangent(
        innerStart[0],
        innerStart[1],
        tangentBlend[0],
        tangentBlend[1],
        outerTip[0],
        outerTip[1],
        -sign
      );
    }
    if (!fallback) {
      return null;
    }
    inner.push(fallback);
  }

  return {
    outer,
    inner,
    role,
  };
}

function findBranchAnchor(chain, startT = 0.58, endT = 0.82) {
  const samples = sampleArcs(chain.arcs, 4);
  const total = samples[samples.length - 1].s;
  let best = null;
  let bestScore = -Infinity;

  for (const p of samples) {
    const t = p.s / total;
    if (t < startT || t > endT || p.r < 14) {
      continue;
    }
    const lateBias = t;
    const score = p.r * 0.5 + lateBias * 30;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

function tryRequiredOffshoot(chain, scale, grid, queue) {
  if (chain.kind !== "stroke" || chain.depth >= params.depth) {
    return false;
  }

  const anchor = findBranchAnchor(chain);
  if (!anchor) {
    return false;
  }

  const childScale = scale * params.falloff * 0.68;
  const anchorSamples = sampleArcs(chain.arcs, 4);
  const anchorTotal = anchorSamples[anchorSamples.length - 1].s;
  const terminalBias = anchor.s / anchorTotal;
  const preferredSides = [-anchor.dir, anchor.dir];
  for (const side of preferredSides) {
    const child = buildChild(
      [anchor.x, anchor.y],
      [anchor.tx, anchor.ty],
      side,
      anchor.r,
      anchor.dir,
      chain.depth + 1,
      childScale,
      grid,
      terminalBias
    );
    if (child && child.kind === "stroke") {
      queue.push({ chain: child, scale: childScale });
      return true;
    }
  }

  return false;
}

function shouldSuppressUnresolvedCurl(chain) {
  return Boolean(chain && chain.mustHaveOffshoot && !chain.hasOffshoot);
}

function angleBetween(a, b) {
  let d = a - b;
  while (d > PI) d -= TAU;
  while (d < -PI) d += TAU;
  return d;
}

function probeClearanceAlongRay(grid, x, y, angle, maxDistance, step = 16, startOffset = 0) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const limit = Math.max(step, maxDistance);

  for (let dist = Math.max(0, startOffset); dist <= limit; dist += step) {
    const px = x + dx * dist;
    const py = y + dy * dist;
    if (!inBounds(px, py) || inVoid(px, py)) {
      return dist;
    }
    if (dist > startOffset + 2 && grid.near(px, py, params.clearance * 0.92)) {
      return dist;
    }
  }

  return limit;
}

function findOpenLaunchAngle(grid, spawnPoint, fallbackAngle = 0, avoidAngle = null) {
  const maxDistance = Math.max(su(180), params.spacing * 5);
  const step = Math.max(10, params.clearance * 0.9);
  let bestAngle = fallbackAngle;
  let bestScore = -Infinity;

  for (let i = 0; i < 24; i++) {
    const angle = (-PI + (TAU * i) / 24) + rnd(-0.03, 0.03);
    const forward = probeClearanceAlongRay(grid, spawnPoint.x, spawnPoint.y, angle, maxDistance, step, step);
    const sideA = probeClearanceAlongRay(grid, spawnPoint.x, spawnPoint.y, angle + 0.42, maxDistance * 0.7, step, step);
    const sideB = probeClearanceAlongRay(grid, spawnPoint.x, spawnPoint.y, angle - 0.42, maxDistance * 0.7, step, step);
    const alignScore = Math.cos(angleBetween(angle, fallbackAngle)) * maxDistance * 0.12;
    const avoidPenalty =
      avoidAngle === null ? 0 : Math.max(0, Math.cos(angleBetween(angle, avoidAngle))) * maxDistance * 0.28;
    const upwardBias = Math.max(0, -Math.sin(angle)) * maxDistance * 0.08;
    const score = forward * 1.4 + Math.min(sideA, sideB) * 0.55 + alignScore + upwardBias - avoidPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

function nearestTangentialTarget(spawnPoint, maxDistance = su(96)) {
  let best = null;
  let bestDist = maxDistance;

  for (const chain of model.chains) {
    if (chain.kind === "stroke" && chain.spawnPoint) {
      if (Math.hypot(chain.spawnPoint.x - spawnPoint.x, chain.spawnPoint.y - spawnPoint.y) < su(6)) {
        continue;
      }
    }

    const arcSets =
      chain.kind === "stroke"
        ? [chain.arcs]
        : chain.kind === "leaf"
          ? [chain.stem, chain.tear]
          : [];

    for (const arcs of arcSets) {
      const samples = sampleArcs(arcs, 5);
      for (const sample of samples) {
        const dist = Math.hypot(sample.x - spawnPoint.x, sample.y - spawnPoint.y);
        if (dist < su(18) || dist > bestDist) {
          continue;
        }
        best = sample;
        bestDist = dist;
      }
    }
  }

  return best;
}

function tryAddTangentialSpawnBridge(grid, spawnPoint) {
  const target = nearestTangentialTarget(spawnPoint);
  if (!target) {
    return null;
  }

  let backwardArc = arcToPointWithTangent(
    target.x,
    target.y,
    -target.tx,
    -target.ty,
    spawnPoint.x,
    spawnPoint.y,
    target.dir ?? 1
  );
  if (!backwardArc) {
    backwardArc = arcToPointWithTangent(
      target.x,
      target.y,
      -target.tx,
      -target.ty,
      spawnPoint.x,
      spawnPoint.y,
      -(target.dir ?? 1)
    );
  }
  if (!backwardArc) {
    return null;
  }

  const bridgeArc = reverseArcs([backwardArc])[0];
  if (Math.abs(bridgeArc.da) > PI * 0.92) {
    return null;
  }

  const samples = sampleArcs([bridgeArc], 3);
  const skip = Math.max(params.clearance * 2.2, su(18));
  if (!testChain(samples, grid, skip, skip)) {
    return null;
  }

  const bridge = {
    kind: "stroke",
    arcs: [bridgeArc],
    depth: 0,
    profile: "bridge",
    terminalLeaf: null,
    wBase: STROKE_WEIGHT * 0.92,
  };
  acceptChain(bridge, samples, grid);
  return bridge;
}

function runSecondPassSpines(grid, queue, bounds, baseTier) {
  const sourceSpines = model.chains.filter(
    (chain) => chain.kind === "stroke" && chain.profile === "spine" && chain.spawnPoint
  );

  for (const source of sourceSpines) {
    const spawn = source.spawnPoint;
    if (!spawn || !inBounds(spawn.x, spawn.y) || inVoid(spawn.x, spawn.y)) {
      continue;
    }

    const fallbackAngle = flowAngleAt(spawn.x, spawn.y, "spine");
    const avoidAngle = source.launchAngle ?? fallbackAngle;
    const launchAngle = findOpenLaunchAngle(grid, spawn, fallbackAngle, avoidAngle);
    const directSpace = probeClearanceAlongRay(
      grid,
      spawn.x,
      spawn.y,
      launchAngle,
      Math.max(su(160), params.spacing * 4.5),
      Math.max(10, params.clearance * 0.9),
      Math.max(10, params.clearance * 0.9)
    );

    if (directSpace < Math.max(su(42), params.spacing * 1.4)) {
      tryAddTangentialSpawnBridge(grid, spawn);
      continue;
    }

    const secondPassScale = (source.rootScale ?? baseTier.rootScale ?? 1) * 0.68;
    const secondPass = buildSpine(grid, 0, 1, {
      ...baseTier,
      rootScale: secondPassScale,
      bodyChance: 0.46,
      weightScale: 0.82,
      preferredPoint: {
        x: spawn.x,
        y: spawn.y,
        launchAngle,
        lockToGuide: true,
      },
      spreadX: 0,
      spreadY: 0,
      yMin: bounds.yMin,
      yMax: bounds.yMax,
      startClearanceSkip: Math.max(params.clearance * 3.6, su(34)),
    });

    if (secondPass) {
      secondPass.pass = 2;
      queue.push({ chain: secondPass, scale: secondPassScale });
      tryAddTangentialSpawnBridge(grid, spawn);
    }
  }
}

function sourceBounds() {
  const m = margin();
  const width = stageWidth();
  const height = stageHeight();
  return {
    xMin: m + su(28),
    xMax: (params.mirror ? width / 2 : width) - su(38),
    yMin: params.verticalSymmetry ? height / 2 + su(28) : m + su(28),
    yMax: height - m - su(28),
  };
}

function collectPocketSeeds(grid, count, radius, bounds) {
  const seeds = [];
  const step = Math.max(24, Math.floor(radius * 0.8));

  for (let y = bounds.yMin; y <= bounds.yMax; y += step) {
    for (let x = bounds.xMin; x <= bounds.xMax; x += step) {
      if (!inBounds(x, y) || inVoid(x, y)) {
        continue;
      }
      if (grid.near(x, y, radius * 0.7)) {
        continue;
      }

      let score = 0;
      const probes = [radius * 0.8, radius * 1.15, radius * 1.5];
      for (const probe of probes) {
        if (!grid.near(x, y, probe)) {
          score += probe;
        }
      }

      if (score <= 0) {
        continue;
      }

      seeds.push({ x, y, score: score + rnd(0, 0.001) });
    }
  }

  seeds.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const seed of seeds) {
    if (chosen.length >= count) {
      break;
    }
    if (chosen.some((other) => Math.hypot(other.x - seed.x, other.y - seed.y) < radius * 1.5)) {
      continue;
    }
    chosen.push(seed);
  }

  return chosen;
}

function createDistributedPoints(count, bounds, options = {}) {
  if (count <= 0) {
    return [];
  }

  const width = Math.max(1, bounds.xMax - bounds.xMin);
  const height = Math.max(1, bounds.yMax - bounds.yMin);
  const aspect = width / height;
  const rowBias = options.rowBias ?? 1;
  const rows = Math.max(1, Math.round(Math.sqrt((count / Math.max(0.25, aspect)) * rowBias)));
  const cols = Math.max(1, Math.ceil(count / rows));
  const jitterX = options.jitterX ?? 0.18;
  const jitterY = options.jitterY ?? 0.16;
  const points = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const xT = cols === 1 ? 0.5 : constrain((col + 0.5 + rnd(-jitterX, jitterX)) / cols, 0.06, 0.94);
    const yT = rows === 1 ? 0.5 : constrain((row + 0.5 + rnd(-jitterY, jitterY)) / rows, 0.06, 0.94);
    points.push({
      x: lerp(bounds.xMin, bounds.xMax, xT),
      y: lerp(bounds.yMin, bounds.yMax, yT),
    });
  }

  return points.sort((a, b) => a.y - b.y || a.x - b.x);
}

function buildDistributedSpines(grid, count, tier, queue, placement = {}) {
  const points = createDistributedPoints(count, placement.bounds, {
    rowBias: placement.rowBias,
    jitterX: placement.jitterX,
    jitterY: placement.jitterY,
  });

  for (const point of points) {
    const spine = buildSpine(grid, 0, 1, {
      ...tier,
      preferredPoint: point,
      spreadX: placement.spreadX ?? su(18),
      spreadY: placement.spreadY ?? su(24),
      yMin: placement.bounds.yMin,
      yMax: placement.bounds.yMax,
    });
    if (spine) {
      queue.push({ chain: spine, scale: tier.rootScale ?? 1 });
    }
  }
}

function buildDistributedFloating(grid, count, tier, queue, placement = {}) {
  const points = createDistributedPoints(count, placement.bounds, {
    rowBias: placement.rowBias,
    jitterX: placement.jitterX ?? 0.22,
    jitterY: placement.jitterY ?? 0.22,
  });

  for (const point of points) {
    const spine = buildFloating(grid, {
      ...tier,
      preferredPoint: point,
      spreadX: placement.spreadX ?? su(18),
      spreadY: placement.spreadY ?? su(18),
      yMin: placement.bounds.yMin,
      yMax: placement.bounds.yMax,
    });
    if (spine) {
      queue.push({ chain: spine, scale: tier.scaleMax ?? 1 });
    }
  }
}

function pushIfChain(queue, chain, scale) {
  if (chain) {
    queue.push({ chain, scale });
  }
}

function createLineGuidePoints(x0, y0, x1, y1, count, options = {}) {
  if (count <= 0) {
    return [];
  }
  const points = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const baseAngle = Math.atan2(dy, dx);
  const spread = options.spread ?? 0;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / Math.max(1, count - 1);
    const angleOffset =
      options.angleOffsetAtT?.(t, i) ?? (spread ? lerp(-spread, spread, t) : 0);
    points.push({
      x: lerp(x0, x1, t),
      y: lerp(y0, y1, t),
      launchAngle: baseAngle + angleOffset,
      lockToGuide: true,
    });
  }

  return points;
}

function createEllipseGuidePoints(cx, cy, rx, ry, count, options = {}) {
  if (count <= 0) {
    return [];
  }
  const points = [];
  const startAngle = options.startAngle ?? -PI * 0.1;
  const endAngle = options.endAngle ?? PI * 1.1;
  const inward = options.inward ?? true;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / Math.max(1, count - 1);
    const angle = lerp(startAngle, endAngle, t);
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    const nx = Math.cos(angle) / Math.max(1e-6, rx);
    const ny = Math.sin(angle) / Math.max(1e-6, ry);
    const radial = Math.atan2(ny, nx);
    points.push({
      x,
      y,
      launchAngle: inward ? radial + PI : radial,
      lockToGuide: true,
    });
  }
  return points;
}

function chooseBoundaryTangentDirection(x, y, tangentAngle, role = "spine") {
  const flowAngle = flowAngleAt(x, y, role);
  const opposite = tangentAngle + PI;
  return Math.abs(angleBetween(tangentAngle, flowAngle)) <= Math.abs(angleBetween(opposite, flowAngle))
    ? tangentAngle
    : opposite;
}

function createVoidBoundaryGuidePoints(count, role = "spine", options = {}) {
  if (!params.voidOn || count <= 0) {
    return [];
  }

  const currentVoid = stageVoid();
  const bounds = options.bounds ?? sourceBounds();
  const points = [];

  if (currentVoid.shape === "rect") {
    const perimeter = currentVoid.width * 2 + currentVoid.height * 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      let dist = perimeter * t;
      let x = currentVoid.x;
      let y = currentVoid.y;
      let tx = 1;
      let ty = 0;
      let nx = 0;
      let ny = -1;

      if (dist < currentVoid.width) {
        x += dist;
      } else if ((dist -= currentVoid.width) < currentVoid.height) {
        x += currentVoid.width;
        y += dist;
        tx = 0;
        ty = 1;
        nx = 1;
        ny = 0;
      } else if ((dist -= currentVoid.height) < currentVoid.width) {
        x += currentVoid.width - dist;
        y += currentVoid.height;
        tx = -1;
        ty = 0;
        nx = 0;
        ny = 1;
      } else {
        dist -= currentVoid.width;
        y += currentVoid.height - dist;
        tx = 0;
        ty = -1;
        nx = -1;
        ny = 0;
      }

      if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) {
        continue;
      }

      const tangentAngle = Math.atan2(ty, tx);
      const launchAngle = chooseBoundaryTangentDirection(x, y, tangentAngle, role);
      const leftNormal = [-Math.sin(launchAngle), Math.cos(launchAngle)];
      const preferredSign = leftNormal[0] * nx + leftNormal[1] * ny >= 0 ? 1 : -1;
      points.push({ x, y, launchAngle, preferredSign, lockToGuide: true });
    }
    return points;
  }

  const startAngle = options.startAngle ?? 0;
  const sweep = options.sweep ?? TAU;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const angle = startAngle + sweep * t;
    const x = currentVoid.cx + Math.cos(angle) * currentVoid.rx;
    const y = currentVoid.cy + Math.sin(angle) * currentVoid.ry;
    if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) {
      continue;
    }

    const tx = -Math.sin(angle) * currentVoid.rx;
    const ty = Math.cos(angle) * currentVoid.ry;
    const tangentAngle = Math.atan2(ty, tx);
    const nx = Math.cos(angle) / Math.max(currentVoid.rx, 1e-6);
    const ny = Math.sin(angle) / Math.max(currentVoid.ry, 1e-6);
    const launchAngle = chooseBoundaryTangentDirection(x, y, tangentAngle, role);
    const leftNormal = [-Math.sin(launchAngle), Math.cos(launchAngle)];
    const preferredSign = leftNormal[0] * nx + leftNormal[1] * ny >= 0 ? 1 : -1;
    points.push({ x, y, launchAngle, preferredSign, lockToGuide: true });
  }

  return points;
}

function queuePointsAsSpines(grid, points, tier, queue, placement = {}) {
  for (const point of points) {
    pushIfChain(
      queue,
      buildSpine(grid, 0, 1, {
        ...tier,
        preferredPoint: point,
        spreadX: placement.spreadX ?? su(14),
        spreadY: placement.spreadY ?? su(14),
        yMin: placement.bounds?.yMin ?? tier.yMin,
        yMax: placement.bounds?.yMax ?? tier.yMax,
      }),
      tier.rootScale ?? 1
    );
  }
}

function queuePointsAsFloating(grid, points, tier, queue, placement = {}) {
  for (const point of points) {
    pushIfChain(
      queue,
      buildFloating(grid, {
        ...tier,
        preferredPoint: point,
        spreadX: placement.spreadX ?? su(12),
        spreadY: placement.spreadY ?? su(12),
        yMin: placement.bounds?.yMin ?? tier.yMin,
        yMax: placement.bounds?.yMax ?? tier.yMax,
      }),
      tier.scaleMax ?? 1
    );
  }
}

function seedFreeFieldMotif(grid, queue, tiers, bounds, aspect) {
  const largeBounds = {
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: tiers.large.yMin,
    yMax: tiers.large.yMax,
  };
  const mediumBounds = {
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: tiers.medium.yMin,
    yMax: tiers.medium.yMax,
  };
  const floatingBounds = {
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: tiers.small.yMin,
    yMax: tiers.small.yMax,
  };

  buildDistributedSpines(grid, params.largeSpines, tiers.large, queue, {
    bounds: largeBounds,
    rowBias: aspect < 0.85 ? 1.8 : 1.1,
    spreadX: su(18),
    spreadY: su(26),
  });
  buildDistributedSpines(grid, params.mediumSpines, tiers.medium, queue, {
    bounds: mediumBounds,
    rowBias: aspect < 0.85 ? 2.2 : 1.3,
    spreadX: su(20),
    spreadY: su(28),
  });
  buildDistributedFloating(grid, params.smallSpines, tiers.small, queue, {
    bounds: floatingBounds,
    rowBias: aspect < 0.85 ? 2.4 : 1.4,
    spreadX: su(16),
    spreadY: su(20),
  });
}

function seedBottomBaselineMotif(grid, queue, tiers, bounds) {
  const baselineY = bounds.yMax - su(18);
  const largePoints = createLineGuidePoints(bounds.xMin, baselineY, bounds.xMax, baselineY, params.largeSpines, {
    spread: 0.24,
  });
  const mediumPoints = createLineGuidePoints(bounds.xMin, baselineY - su(12), bounds.xMax, baselineY - su(12), params.mediumSpines, {
    spread: 0.36,
  });
  const floatingPoints = createLineGuidePoints(bounds.xMin, baselineY - su(22), bounds.xMax, baselineY - su(22), params.smallSpines, {
    spread: 0.44,
  });
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: su(12), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: su(14), spreadY: su(12), bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: su(10), spreadY: su(10), bounds });
}

function seedCenterAxisMotif(grid, queue, tiers, bounds) {
  const axisX = (bounds.xMin + bounds.xMax) * 0.5;
  const y0 = lerp(bounds.yMin, bounds.yMax, 0.18);
  const y1 = lerp(bounds.yMin, bounds.yMax, 0.92);
  const makeAxisPoints = (count, spreadBase) =>
    Array.from({ length: count }, (_, i) => {
      const t = count === 1 ? 0.5 : i / Math.max(1, count - 1);
      const side = i % 2 === 0 ? -1 : 1;
      return {
        x: axisX + side * su(spreadBase),
        y: lerp(y0, y1, t),
        launchAngle: -PI / 2 + lerp(-0.12, 0.12, t),
        lockToGuide: true,
      };
    });
  queuePointsAsSpines(grid, makeAxisPoints(params.largeSpines, 10), tiers.large, queue, { spreadX: su(10), spreadY: su(12), bounds });
  queuePointsAsSpines(grid, makeAxisPoints(params.mediumSpines, 18), tiers.medium, queue, { spreadX: su(12), spreadY: su(12), bounds });
  queuePointsAsFloating(grid, makeAxisPoints(params.smallSpines, 24), tiers.small, queue, { spreadX: su(12), spreadY: su(12), bounds });
}

function seedTwinRailsMotif(grid, queue, tiers, bounds) {
  const leftX = lerp(bounds.xMin, bounds.xMax, 0.16);
  const rightX = lerp(bounds.xMin, bounds.xMax, 0.84);
  const y0 = lerp(bounds.yMin, bounds.yMax, 0.12);
  const y1 = lerp(bounds.yMin, bounds.yMax, 0.9);
  const splitCounts = (count) => [Math.ceil(count / 2), Math.floor(count / 2)];
  const [lLarge, rLarge] = splitCounts(params.largeSpines);
  const [lMedium, rMedium] = splitCounts(params.mediumSpines);
  const [lSmall, rSmall] = splitCounts(params.smallSpines);
  const leftLarge = createLineGuidePoints(leftX, y0, leftX, y1, lLarge, { spread: 0.18 });
  const rightLarge = createLineGuidePoints(rightX, y0, rightX, y1, rLarge, { spread: 0.18 });
  leftLarge.forEach((p) => (p.launchAngle += 0.78));
  rightLarge.forEach((p) => (p.launchAngle -= 0.78));
  const leftMedium = createLineGuidePoints(leftX, y0, leftX, y1, lMedium, { spread: 0.28 });
  const rightMedium = createLineGuidePoints(rightX, y0, rightX, y1, rMedium, { spread: 0.28 });
  leftMedium.forEach((p) => (p.launchAngle += 0.62));
  rightMedium.forEach((p) => (p.launchAngle -= 0.62));
  const leftSmall = createLineGuidePoints(leftX, y0, leftX, y1, lSmall, { spread: 0.34 });
  const rightSmall = createLineGuidePoints(rightX, y0, rightX, y1, rSmall, { spread: 0.34 });
  leftSmall.forEach((p) => (p.launchAngle += 0.55));
  rightSmall.forEach((p) => (p.launchAngle -= 0.55));
  queuePointsAsSpines(grid, leftLarge.concat(rightLarge), tiers.large, queue, { spreadX: su(12), spreadY: su(14), bounds });
  queuePointsAsSpines(grid, leftMedium.concat(rightMedium), tiers.medium, queue, { spreadX: su(12), spreadY: su(14), bounds });
  queuePointsAsFloating(grid, leftSmall.concat(rightSmall), tiers.small, queue, { spreadX: su(10), spreadY: su(12), bounds });
}

function seedMedallionMotif(grid, queue, tiers, bounds) {
  const cx = (bounds.xMin + bounds.xMax) * 0.5;
  const cy = (bounds.yMin + bounds.yMax) * 0.54;
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  const largePoints = createEllipseGuidePoints(cx, cy, width * 0.34, height * 0.24, params.largeSpines, {
    startAngle: PI * 0.1,
    endAngle: PI * 0.9,
    inward: true,
  });
  const mediumPoints = createEllipseGuidePoints(cx, cy, width * 0.4, height * 0.3, params.mediumSpines, {
    startAngle: PI * 0.02,
    endAngle: PI * 0.98,
    inward: true,
  });
  const floatingPoints = createEllipseGuidePoints(cx, cy, width * 0.46, height * 0.36, params.smallSpines, {
    startAngle: -PI * 0.1,
    endAngle: PI * 1.1,
    inward: true,
  });
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: su(10), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: su(12), spreadY: su(12), bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: su(12), spreadY: su(12), bounds });
}

function seedBorderFrameMotif(grid, queue, tiers, bounds) {
  const topY = bounds.yMin + su(10);
  const bottomY = bounds.yMax - su(10);
  const leftX = bounds.xMin + su(10);
  const rightX = bounds.xMax - su(10);
  const largeBottom = createLineGuidePoints(bounds.xMin, bottomY, bounds.xMax, bottomY, Math.ceil(params.largeSpines * 0.6), { spread: 0.22 });
  const largeTop = createLineGuidePoints(bounds.xMin, topY, bounds.xMax, topY, Math.floor(params.largeSpines * 0.4), { spread: 0.18 });
  largeTop.forEach((p) => (p.launchAngle += PI));
  const mediumLeft = createLineGuidePoints(leftX, bounds.yMin, leftX, bounds.yMax, Math.ceil(params.mediumSpines / 2), { spread: 0.24 });
  const mediumRight = createLineGuidePoints(rightX, bounds.yMin, rightX, bounds.yMax, Math.floor(params.mediumSpines / 2), { spread: 0.24 });
  mediumLeft.forEach((p) => (p.launchAngle += 0.62));
  mediumRight.forEach((p) => (p.launchAngle -= 0.62));
  const floatingTop = createLineGuidePoints(bounds.xMin, topY + su(14), bounds.xMax, topY + su(14), Math.ceil(params.smallSpines / 2), { spread: 0.32 });
  const floatingBottom = createLineGuidePoints(bounds.xMin, bottomY - su(14), bounds.xMax, bottomY - su(14), Math.floor(params.smallSpines / 2), { spread: 0.32 });
  floatingTop.forEach((p) => (p.launchAngle += PI));
  queuePointsAsSpines(grid, largeBottom.concat(largeTop), tiers.large, queue, { spreadX: su(12), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumLeft.concat(mediumRight), tiers.medium, queue, { spreadX: su(10), spreadY: su(10), bounds });
  queuePointsAsFloating(grid, floatingTop.concat(floatingBottom), tiers.small, queue, { spreadX: su(10), spreadY: su(10), bounds });
}

function seedVoidContourMotif(grid, queue, tiers, bounds) {
  const largePoints = createVoidBoundaryGuidePoints(params.largeSpines, "spine", { bounds });
  const mediumPoints = createVoidBoundaryGuidePoints(params.mediumSpines, "spine", { bounds, startAngle: PI / Math.max(3, params.mediumSpines || 3) });
  const floatingPoints = createVoidBoundaryGuidePoints(params.smallSpines, "floating", { bounds, startAngle: PI / Math.max(5, params.smallSpines || 5) });
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: 0, spreadY: 0, bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: 0, spreadY: 0, bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: 0, spreadY: 0, bounds });
}

function seedPlacedSpawnsMotif(grid, queue, tiers, bounds) {
  const points = appState.manualSpawnPoints.filter(
    (point) =>
      point.x >= bounds.xMin &&
      point.x <= bounds.xMax &&
      point.y >= bounds.yMin &&
      point.y <= bounds.yMax &&
      !inVoid(point.x, point.y) &&
      manualSpawnAllowed(point)
  );

  queuePointsAsSpines(grid, points, tiers.large, queue, {
    spreadX: 0,
    spreadY: 0,
    bounds,
  });
}

function seedMotifPreset(grid, queue, tiers, bounds, aspect) {
  switch (appState.motifPreset) {
    case "bottomBaseline":
      seedBottomBaselineMotif(grid, queue, tiers, bounds);
      break;
    case "centerAxis":
      seedCenterAxisMotif(grid, queue, tiers, bounds);
      break;
    case "twinRails":
      seedTwinRailsMotif(grid, queue, tiers, bounds);
      break;
    case "medallion":
      seedMedallionMotif(grid, queue, tiers, bounds);
      break;
    case "borderFrame":
      seedBorderFrameMotif(grid, queue, tiers, bounds);
      break;
    case "voidContour":
      seedVoidContourMotif(grid, queue, tiers, bounds);
      break;
    case "placedSpawns":
      seedPlacedSpawnsMotif(grid, queue, tiers, bounds);
      break;
    case "freeField":
    default:
      seedFreeFieldMotif(grid, queue, tiers, bounds, aspect);
      break;
  }
}

function findNearbySpawnPoint(points, candidate, threshold) {
  if (!points || !points.length || !(threshold > 0)) {
    return null;
  }

  let nearest = null;
  let nearestDist = threshold;
  for (const point of points) {
    const dist = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (dist <= nearestDist) {
      nearest = point;
      nearestDist = dist;
    }
  }

  return nearest;
}

function buildSpine(grid, col, nCols, tier = {}) {
  const m = margin();
  const genW = params.mirror ? stageWidth() / 2 : stageWidth();
  const x0 = m + su(50);
  const x1 = genW - su(70);
  const cw = (x1 - x0) / nCols;
  const rootScale = tier.rootScale ?? 1;
  const yMin = tier.yMin ?? m + su(50);
  const yMax = tier.yMax ?? stageHeight() - m - su(50);
  const bodyChance = tier.bodyChance ?? 0.7;
  const weightScale = tier.weightScale ?? 1;
  const preferredPoint = tier.preferredPoint ?? null;
  const spreadX = tier.spreadX ?? 40;
  const spreadY = tier.spreadY ?? 40;
  const sharedSpawnPoints = tier.sharedSpawnPoints ?? null;
  const sharedSpawnThreshold = tier.sharedSpawnThreshold ?? 0;
  const sharedSpawnSkip = tier.sharedSpawnSkip ?? 0;
  const startClearanceSkipOverride = tier.startClearanceSkip ?? null;

  for (let tries = 0; tries < 30; tries++) {
    const rawPoint = {
      x: preferredPoint
        ? preferredPoint.lockToGuide
          ? constrain(preferredPoint.x, x0, x1)
          : constrain(preferredPoint.x + rnd(-spreadX, spreadX), x0, x1)
        : x0 + cw * (col + rnd(0.1, 0.9)),
      y: preferredPoint
        ? preferredPoint.lockToGuide
          ? constrain(preferredPoint.y, yMin, yMax)
          : constrain(preferredPoint.y + rnd(-spreadY, spreadY), yMin, yMax)
        : rnd(yMin, yMax),
    };
    const sharedPoint = preferredPoint
      ? null
      : findNearbySpawnPoint(sharedSpawnPoints, rawPoint, sharedSpawnThreshold);
    const px = sharedPoint ? sharedPoint.x : rawPoint.x;
    const py = sharedPoint ? sharedPoint.y : rawPoint.y;
    const startClearanceSkip =
      startClearanceSkipOverride ?? (sharedPoint ? sharedSpawnSkip : 0);
    const launchAngle =
      preferredPoint && preferredPoint.launchAngle !== undefined
        ? preferredPoint.launchAngle
        : flowAngleAt(px, py, "spine");
    const ang = launchAngle;
    const T = [Math.cos(ang), Math.sin(ang)];
    const sA = preferredPoint?.preferredSign ?? (chance(0.5) ? 1 : -1);
    const q = quartersFromTurns();
    const baseRadius = rnd(su(180), su(280)) * rootScale;
    const launchRadius = baseRadius * rnd(1.06, 1.18);
    const bodyRadius = baseRadius * rnd(0.82, 0.96);
    const returnRadius = baseRadius * rnd(0.56, 0.7);

    let arcs = [];
    let P = [px, py];
    let Tc = T.slice();
    let phase = appendArcPhase(
      arcs,
      P,
      Tc,
      sA,
      [launchRadius, launchRadius * 1.04],
      [0.62, 0.96]
    );
    P = phase.P;
    Tc = phase.T;

    if (chance(bodyChance)) {
      phase = appendArcPhase(
        arcs,
        P,
        Tc,
        sA,
        [bodyRadius, bodyRadius * 1.03],
        [0.42, 0.72]
      );
      P = phase.P;
      Tc = phase.T;
    }
    const bodyEndIndex = arcs.length - 1;

    const hasReturn = chance(0.55);
    let sClose = sA;
    if (hasReturn) {
      phase = appendArcPhase(
        arcs,
        P,
        Tc,
        -sA,
        [returnRadius, returnRadius * 1.03],
        [0.26, 0.48]
      );
      P = phase.P;
      Tc = phase.T;
      sClose = -sA;
    }

    const hostRadius = arcs[arcs.length - 1].r;
    const closingRadius = Math.max(su(18) * rootScale, Math.min(su(34) * rootScale, hostRadius * 0.22));
    phase = appendTerminalTransition(
      arcs,
      P,
      Tc,
      sClose,
      hostRadius,
      hasReturn ? closingRadius * 0.82 : closingRadius,
      rootScale,
      "spine"
    );
    P = phase.P;
    Tc = phase.T;
    const transitionIndex = arcs.length - 1;
    const sp1 = spiralArcs(
      P[0],
      P[1],
      Tc[0],
      Tc[1],
      sClose,
      hasReturn ? closingRadius * 0.82 : closingRadius,
      params.decay,
      terminalQuarterTurns(hasReturn, "spine")
    );
    arcs = arcs.concat(sp1.arcs);
    const terminalStartIndex = transitionIndex + 1;

    const samples = sampleArcs(arcs, 3);
    if (!testChain(samples, grid, startClearanceSkip)) {
      continue;
    }

    const chain = {
      kind: "stroke",
      arcs,
      depth: 0,
      profile: "spine",
      debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
      terminalLeaf: buildTerminalLeafFromSpiral(sp1.arcs, "spine"),
      wBase: STROKE_WEIGHT,
      spawnPoint: { x: px, y: py },
      launchAngle,
      rootScale,
    };
    acceptChain(chain, samples, grid);
    if (
      sharedSpawnPoints &&
      !findNearbySpawnPoint(sharedSpawnPoints, chain.spawnPoint, sharedSpawnThreshold * 0.35)
    ) {
      sharedSpawnPoints.push(chain.spawnPoint);
    }
    return chain;
  }

  return null;
}

function buildCornerSpine(grid, side = "left", tier = {}) {
  const rootScale = tier.rootScale ?? 1.16;
  const m = margin();
  const startX =
    side === "left"
      ? m + (tier.edgeInset ?? su(12))
      : stageWidth() - m - (tier.edgeInset ?? su(12));
  const startY = tier.startY ?? (stageHeight() - m - su(28));
  const angBase = -PI / 2 + (side === "left" ? 0.08 : -0.08);
  const ang = angBase + rnd(-0.06, 0.06);
  const T = [Math.cos(ang), Math.sin(ang)];
  const sA = side === "left" ? 1 : -1;

  for (let tries = 0; tries < 24; tries++) {
    const px = startX + rnd(-su(6), su(6));
    const py = startY + rnd(-su(18), su(18));
    const baseRadius = rnd(su(240), su(340)) * rootScale;
    const launchRadius = baseRadius * rnd(1.18, 1.28);
    const bodyRadius = baseRadius * rnd(0.88, 0.98);
    const returnRadius = baseRadius * rnd(0.58, 0.7);

    let arcs = [];
    let P = [px, py];
    let Tc = T.slice();
    let phase = appendArcPhase(
      arcs,
      P,
      Tc,
      sA,
      [launchRadius, launchRadius * 1.02],
      [0.24, 0.42]
    );
    P = phase.P;
    Tc = phase.T;

    phase = appendArcPhase(
      arcs,
      P,
      Tc,
      sA,
      [bodyRadius, bodyRadius * 1.02],
      [0.32, 0.56]
    );
    P = phase.P;
    Tc = phase.T;
    const bodyEndIndex = arcs.length - 1;

    const hasReturn = chance(0.45);
    let sClose = sA;
    if (hasReturn) {
      phase = appendArcPhase(
        arcs,
        P,
        Tc,
        -sA,
        [returnRadius, returnRadius * 1.02],
        [0.18, 0.34]
      );
      P = phase.P;
      Tc = phase.T;
      sClose = -sA;
    }

    const hostRadius = arcs[arcs.length - 1].r;
    const closingRadius = Math.max(su(20) * rootScale, Math.min(su(34) * rootScale, hostRadius * 0.2));
    phase = appendTerminalTransition(
      arcs,
      P,
      Tc,
      sClose,
      hostRadius,
      hasReturn ? closingRadius * 0.82 : closingRadius,
      rootScale,
      "spine"
    );
    P = phase.P;
    Tc = phase.T;
    const transitionIndex = arcs.length - 1;
    const sp = spiralArcs(
      P[0],
      P[1],
      Tc[0],
      Tc[1],
      sClose,
      hasReturn ? closingRadius * 0.82 : closingRadius,
      params.decay,
      terminalQuarterTurns(hasReturn, "spine")
    );
    arcs = arcs.concat(sp.arcs);
    const terminalStartIndex = transitionIndex + 1;

    const samples = sampleArcs(arcs, 3);
    if (!testChain(samples, grid, 0)) {
      continue;
    }

    const chain = {
      kind: "stroke",
      arcs,
      depth: 0,
      profile: "spine",
      debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
      terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "spine"),
      wBase: STROKE_WEIGHT,
    };
    acceptChain(chain, samples, grid);
    return chain;
  }

  return null;
}

function tangentialSkip(r1, sChild, pr, pdir) {
  const kRel = Math.abs(sChild / r1 - pdir / pr);
  if (kRel < (2 * params.clearance) / 3600) {
    return -1;
  }
  return Math.sqrt((2 * params.clearance) / kRel) * 1.1;
}

function buildChild(P, T, side, pr, pdir, depth, scale, grid, terminalBias = 0.5) {
  for (let tries = 0; tries < 10; tries++) {
    let Tc = T.slice();
    const r1 = rnd(su(24), su(62)) * scale;
    const skip = tangentialSkip(r1, side, pr, pdir);
    if (skip < 0) {
      continue;
    }

    let arcs = [];
    let Pp = P.slice();
    let phase = appendArcPhase(
      arcs,
      Pp,
      Tc,
      side,
      [r1, Math.max(r1 + 1, r1 * 1.25)],
      [0.55, 1.05]
    );
    Pp = phase.P;
    Tc = phase.T;
    const bodyEndIndex = arcs.length - 1;

    const hasReturn = false;
    const sSp = side;

    const hostRadius = arcs[arcs.length - 1].r;
    const spiralScale = growthBoost(depth, scale, terminalBias);
    const spiralRadius = hasReturn
      ? derivedSpiralRadius(hostRadius, "branch", scale * spiralScale) * 0.72
      : derivedSpiralRadius(hostRadius, "branch", scale * spiralScale);
    phase = appendTerminalTransition(arcs, Pp, Tc, sSp, hostRadius, spiralRadius, scale, "branch");
    Pp = phase.P;
    Tc = phase.T;
    const transitionIndex = arcs.length - 1;
    const sp = spiralArcs(
      Pp[0],
      Pp[1],
      Tc[0],
      Tc[1],
      sSp,
      spiralRadius,
      params.decay,
      terminalQuarterTurns(hasReturn, "branch")
    );
    arcs = arcs.concat(sp.arcs);
    const terminalStartIndex = transitionIndex + 1;

    const samples = sampleArcs(arcs, 3);
    if (samples[samples.length - 1].s < skip * 1.4 || !testChain(samples, grid, skip)) {
      continue;
    }

    const chain = {
      kind: "stroke",
      arcs,
      depth,
      profile: "branch",
      debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
      terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
      wBase: STROKE_WEIGHT,
      wantsOffshoot: true,
    };
    acceptChain(chain, samples, grid);
    return chain;
  }

  return null;
}

function buildLeaf(P, T, side, pr, pdir, depth, scale, grid) {
  for (let tries = 0; tries < 4; tries++) {
    const r1 = rnd(su(26), su(52)) * scale;
    const skip = tangentialSkip(r1, side, pr, pdir);
    if (skip < 0) {
      continue;
    }

    const { arc, ex, ey, etx, ety } = arcFrom(P[0], P[1], T[0], T[1], r1, side, rnd(0.7, 1.3));
    const L = rnd(su(9), su(19)) * Math.sqrt(scale) + su(4);
    const tear = teardropArcs([ex, ey], [etx, ety], L);
    const samples = sampleArcs([arc], 3).concat(
      sampleArcs(tear, 3).map((p) => ({ ...p, s: p.s + arcLen(arc) }))
    );

    if (samples[samples.length - 1].s < skip * 1.3 || !testChain(samples, grid, skip)) {
      continue;
    }

    const chain = {
      kind: "leaf",
      stem: [arc],
      tear,
      depth,
      wBase: STROKE_WEIGHT,
    };
    acceptChain(chain, samples, grid);
    return chain;
  }

  return null;
}

function buildAttachedInfill(P, T, side, pr, pdir, depth, scale, grid, terminalBias = 0.5) {
  for (let tries = 0; tries < 6; tries++) {
    let Tc = T.slice();
    const r1 = rnd(su(14), su(28)) * scale;
    const skip = tangentialSkip(r1, side, pr, pdir);
    if (skip < 0) {
      continue;
    }

    let arcs = [];
    let Pp = P.slice();
    let phase = appendArcPhase(arcs, Pp, Tc, side, [r1, Math.max(r1 + 1, r1 * 1.18)], [0.42, 0.82]);
    Pp = phase.P;
    Tc = phase.T;
    const bodyEndIndex = arcs.length - 1;

    const hostRadius = arcs[arcs.length - 1].r;
    const spiralScale = growthBoost(depth, scale, terminalBias) * 0.8;
    const targetRadius = derivedSpiralRadius(hostRadius, "floating", scale * spiralScale) * 0.62;
    phase = appendTerminalTransition(arcs, Pp, Tc, side, hostRadius, targetRadius, scale, "branch");
    Pp = phase.P;
    Tc = phase.T;
    const transitionIndex = arcs.length - 1;
    const sp = spiralArcs(
      Pp[0],
      Pp[1],
      Tc[0],
      Tc[1],
      side,
      targetRadius,
      params.decay,
      1
    );
    arcs = arcs.concat(sp.arcs);
    const terminalStartIndex = transitionIndex + 1;

    const samples = sampleArcs(arcs, 3);
    if (samples[samples.length - 1].s < skip * 1.05 || !testChain(samples, grid, skip)) {
      continue;
    }

    const chain = {
      kind: "stroke",
      arcs,
      depth,
      profile: "branch",
      debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
      terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
      wBase: STROKE_WEIGHT,
      wantsOffshoot: false,
      mustHaveOffshoot: false,
      hasOffshoot: true,
    };
    acceptChain(chain, samples, grid);
    return chain;
  }

  return null;
}

function enrichAttachedInfill(grid) {
  const sourceChains = model.chains.filter(
    (ch) => ch.kind === "stroke" && ch.profile && !shouldSuppressUnresolvedCurl(ch)
  );
  let added = 0;

  for (const chain of sourceChains) {
    if (added >= params.infillCurls) {
      break;
    }
    if (chain.depth > 1) {
      continue;
    }

    const samples = sampleArcs(chain.arcs, 5);
    const total = samples[samples.length - 1].s;
    let next = total * rnd(0.24, 0.36);

    for (const p of samples) {
      if (added >= params.infillCurls) {
        break;
      }
      if (p.s < next || p.s > total * 0.78 || p.r < 18) {
        continue;
      }

      next = p.s + params.spacing * rnd(1.15, 1.55);
      if (!chance(0.32)) {
        continue;
      }

      const childScale = Math.pow(params.falloff, chain.depth + 1) * rnd(0.42, 0.62);
      const side = -p.dir;
      const infill = buildAttachedInfill(
        [p.x, p.y],
        [p.tx, p.ty],
        side,
        p.r,
        p.dir,
        chain.depth + 1,
        childScale,
        grid,
        p.s / total
      );

      if (infill) {
        added++;
      }
    }
  }
}

function buildFloating(grid, tier = {}) {
  const m = margin();
  const genW = params.mirror ? stageWidth() / 2 : stageWidth();
  const scaleMin = tier.scaleMin ?? 0.5;
  const scaleMax = tier.scaleMax ?? 0.9;
  const yMin = tier.yMin ?? m + su(30);
  const yMax = tier.yMax ?? stageHeight() - m - su(30);
  const wantsOffshoot = tier.wantsOffshoot ?? true;
  const weightScale = tier.weightScale ?? 1;
  const preferredPoint = tier.preferredPoint ?? null;
  const spreadX = tier.spreadX ?? 30;
  const spreadY = tier.spreadY ?? 30;

  for (let tries = 0; tries < 10; tries++) {
    const P = preferredPoint
      ? [
          preferredPoint.lockToGuide
            ? constrain(preferredPoint.x, m + su(30), genW - su(40))
            : constrain(preferredPoint.x + rnd(-spreadX, spreadX), m + su(30), genW - su(40)),
          preferredPoint.lockToGuide
            ? constrain(preferredPoint.y, yMin, yMax)
            : constrain(preferredPoint.y + rnd(-spreadY, spreadY), yMin, yMax),
        ]
      : [rnd(m + su(30), genW - su(40)), rnd(yMin, yMax)];
    const launchAngle =
      preferredPoint && preferredPoint.launchAngle !== undefined
        ? preferredPoint.launchAngle
        : flowAngleAt(P[0], P[1], "floating");
    const ang = launchAngle;
    const T = [Math.cos(ang), Math.sin(ang)];
    const side = preferredPoint?.preferredSign ?? (chance(0.5) ? 1 : -1);
    const scale = rnd(scaleMin, scaleMax);
    let arcs = [];
    let Pp = P.slice();
    let Tc = T.slice();
    let phase = appendArcPhase(arcs, Pp, Tc, side, [su(34) * scale, su(82) * scale], [0.9, 1.5]);
    Pp = phase.P;
    Tc = phase.T;
    const bodyEndIndex = arcs.length - 1;

    let hasReturn = false;
    let sSp = side;
    if (chance(0.35)) {
      phase = appendArcPhase(arcs, Pp, Tc, -side, [su(24) * scale, su(56) * scale], [0.3, 0.75]);
      Pp = phase.P;
      Tc = phase.T;
      sSp = -side;
      hasReturn = true;
    }

    const hostRadius = arcs[arcs.length - 1].r;
    const targetRadius = hasReturn
      ? derivedSpiralRadius(hostRadius, "floating", scale) * 0.72
      : derivedSpiralRadius(hostRadius, "floating", scale);
    phase = appendTerminalTransition(arcs, Pp, Tc, sSp, hostRadius, targetRadius, scale, "branch");
    Pp = phase.P;
    Tc = phase.T;
    const transitionIndex = arcs.length - 1;
    const sp = spiralArcs(
      Pp[0],
      Pp[1],
      Tc[0],
      Tc[1],
      sSp,
      targetRadius,
      params.decay,
      terminalQuarterTurns(hasReturn, "branch")
    );
    arcs = arcs.concat(sp.arcs);
    const terminalStartIndex = transitionIndex + 1;

    const samples = sampleArcs(arcs, 3);
    if (!testChain(samples, grid, 0)) {
      continue;
    }

    const chain = {
      kind: "stroke",
      arcs,
      depth: 1,
      profile: "branch",
      debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
      terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
      wBase: STROKE_WEIGHT,
      wantsOffshoot,
      mustHaveOffshoot: wantsOffshoot,
      hasOffshoot: !wantsOffshoot,
    };
    acceptChain(chain, samples, grid);
    return chain;
  }

  return null;
}

function generate() {
  const motifHash = hashString(appState.motifPreset);
  const combinedSeed = ((appState.seed * 2654435761) ^ motifHash) >>> 0;
  R = mulberry32(combinedSeed || 1);
  model = { chains: [], stats: {} };
  initCompositionFlow();
  const grid = makeGrid(params.clearance);
  const queue = [];
  const cornerScale = 1.14;
  const bounds = sourceBounds();
  const aspect = stageWidth() / Math.max(1, stageHeight());

  const largeTier = {
    rootScale: 1.08,
    yMin: lerp(bounds.yMin, bounds.yMax, 0.34),
    yMax: lerp(bounds.yMin, bounds.yMax, 0.94),
    bodyChance: 0.82,
    weightScale: 1.08,
  };
  const mediumTier = {
    rootScale: 0.78,
    yMin: lerp(bounds.yMin, bounds.yMax, 0.14),
    yMax: lerp(bounds.yMin, bounds.yMax, 0.82),
    bodyChance: 0.58,
    weightScale: 0.9,
  };
  const smallTier = {
    scaleMin: 0.34,
    scaleMax: 0.55,
    yMin: lerp(bounds.yMin, bounds.yMax, 0.06),
    yMax: lerp(bounds.yMin, bounds.yMax, 0.88),
    wantsOffshoot: true,
    weightScale: 0.72,
  };

  if (!isPlacedSpawnMotif()) {
    const leftCorner = buildCornerSpine(grid, "left", {
      rootScale: cornerScale,
      startY: stageHeight() - margin() - su(26),
      edgeInset: su(10),
    });
    if (leftCorner) {
      queue.push({ chain: leftCorner, scale: cornerScale });
    }

    if (!params.mirror) {
      const rightCorner = buildCornerSpine(grid, "right", {
        rootScale: cornerScale,
        startY: stageHeight() - margin() - su(26),
        edgeInset: su(10),
      });
      if (rightCorner) {
        queue.push({ chain: rightCorner, scale: cornerScale });
      }
    }
  }

  seedMotifPreset(
    grid,
    queue,
    {
      large: largeTier,
      medium: mediumTier,
      small: smallTier,
    },
    bounds,
    aspect
  );

  if (appState.motifPreset === "freeField" || appState.motifPreset === "borderFrame") {
    const pockets = bounds;
    const mediumPocketSeeds = collectPocketSeeds(grid, 2, su(90), pockets);
    for (const seed of mediumPocketSeeds) {
      const sp = buildSpine(grid, 0, 1, {
        ...mediumTier,
        rootScale: 0.66,
        bodyChance: 0.42,
        weightScale: 0.8,
        preferredPoint: seed,
        spreadX: su(26),
        spreadY: su(34),
        yMin: pockets.yMin,
        yMax: pockets.yMax,
      });
      if (sp) {
        queue.push({ chain: sp, scale: 0.66 });
      }
    }

    const smallPocketSeeds = collectPocketSeeds(grid, 4, su(54), pockets);
    for (const seed of smallPocketSeeds) {
      const sp = buildFloating(grid, {
        ...smallTier,
        scaleMin: 0.24,
        scaleMax: 0.42,
        weightScale: 0.58,
        wantsOffshoot: true,
        preferredPoint: seed,
        spreadX: su(18),
        spreadY: su(18),
        yMin: pockets.yMin,
        yMax: pockets.yMax,
      });
      if (sp) {
        queue.push({ chain: sp, scale: 0.42 });
      }
    }

    const ornamentSeeds = collectPocketSeeds(
      grid,
      Math.max(2, Math.round((params.smallSpines + params.mediumSpines) * 0.6)),
      su(42),
      pockets
    );
    for (const seed of ornamentSeeds) {
      if (!chance(params.spaceMotifProb)) {
        continue;
      }
      tryPlaceSpaceOrnament(grid, seed);
    }
  }

  growQueue(queue, grid);
  runSecondPassSpines(grid, queue, bounds, largeTier);
  growQueue(queue, grid);
  enrichAttachedInfill(grid);
  finishStats();
}

function growQueue(queue, grid) {
  let guard = 0;

  while (queue.length && model.chains.length < 1400 && guard < 4000) {
    guard++;
    const { chain, scale } = queue.shift();
    if (chain.kind !== "stroke") {
      continue;
    }

    const d = chain.depth;
    if (d >= params.depth) {
      continue;
    }

    if (chain.wantsOffshoot) {
      chain.hasOffshoot = tryRequiredOffshoot(chain, scale, grid, queue) || chain.hasOffshoot;
    }

    const samples = sampleArcs(chain.arcs, 4);
    const total = samples[samples.length - 1].s;
    let next = params.spacing * rnd(0.6, 1.0) + total * 0.08;

    for (const p of samples) {
      if (p.s < next || p.r < 12 || p.s > total * 0.96) {
        continue;
      }
      next = p.s + params.spacing * rnd(0.8, 1.25);
      const side = chance(0.75) ? -p.dir : p.dir;
      const childScale = scale * params.falloff;
      const terminalBias = p.s / total;
      let child = null;

      if (chance(params.leafProb)) {
        child = buildLeaf([p.x, p.y], [p.tx, p.ty], side, p.r, p.dir, d + 1, childScale, grid);
      } else {
        child = buildChild(
          [p.x, p.y],
          [p.tx, p.ty],
          side,
          p.r,
          p.dir,
          d + 1,
          childScale,
          grid,
          terminalBias
        );
      }

      if (child && child.kind === "stroke") {
        chain.hasOffshoot = true;
        queue.push({ chain: child, scale: childScale });
      }
    }
  }
}

function finishStats() {
  let nArcs = 0;
  let len = 0;

  for (const ch of model.chains) {
    if (shouldSuppressUnresolvedCurl(ch)) {
      continue;
    }
    if (ch.kind === "stroke") {
      nArcs += ch.arcs.length;
      len += chainLen(ch.arcs);
    } else if (ch.kind === "leaf") {
      nArcs += ch.stem.length + ch.tear.length;
      len += chainLen(ch.stem) + chainLen(ch.tear);
    } else if (ch.kind === "ornament") {
      nArcs += ch.paths.reduce((sum, path) => sum + Math.max(0, path.length - 1), 0);
      len += ch.samples.length ? ch.samples[ch.samples.length - 1].s : 0;
    }
  }

  const m = (params.mirror ? 2 : 1) * (params.verticalSymmetry ? 2 : 1);
  model.stats = {
    arcs: nArcs * m,
    chains: model.chains.length * m,
    length: Math.round(len * m),
  };
}

function verifyG1() {
  let worst = 0;

  for (const ch of model.chains) {
    if (shouldSuppressUnresolvedCurl(ch)) {
      continue;
    }
    if (ch.kind !== "stroke") {
      continue;
    }
    for (let i = 0; i < ch.arcs.length - 1; i++) {
      const [t1x, t1y] = arcTangentAt(ch.arcs[i], 1);
      const [t2x, t2y] = arcTangentAt(ch.arcs[i + 1], 0);
      const [p1x, p1y] = arcPointAt(ch.arcs[i], 1);
      const [p2x, p2y] = arcPointAt(ch.arcs[i + 1], 0);
      const dot = Math.max(-1, Math.min(1, t1x * t2x + t1y * t2y));
      worst = Math.max(worst, Math.acos(dot), Math.hypot(p1x - p2x, p1y - p2y) * 0.001);
    }
  }

  return worst;
}

// ============================= RENDERING (p5) =============================
function widthAt(ch, t) {
  return ch.wBase;
}

function mirrorArc(a) {
  return { cx: stageWidth() - a.cx, cy: a.cy, r: a.r, a0: PI - a.a0, da: -a.da };
}

function mirrorArcY(a) {
  return { cx: a.cx, cy: stageHeight() - a.cy, r: a.r, a0: -a.a0, da: -a.da };
}

function mirrorChainX(ch) {
  if (ch.kind === "leaf") {
    return { ...ch, stem: ch.stem.map(mirrorArc), tear: ch.tear.map(mirrorArc) };
  }
  if (ch.kind === "ornament") {
    return {
      ...ch,
      paths: ch.paths.map((path) => path.map((point) => ({ x: stageWidth() - point.x, y: point.y }))),
    };
  }
  return {
    ...ch,
    arcs: ch.arcs.map(mirrorArc),
    terminalLeaf: ch.terminalLeaf
      ? {
          ...ch.terminalLeaf,
          outer: ch.terminalLeaf.outer.map(mirrorArc),
          inner: ch.terminalLeaf.inner.map(mirrorArc),
        }
      : null,
  };
}

function mirrorChainY(ch) {
  if (ch.kind === "leaf") {
    return { ...ch, stem: ch.stem.map(mirrorArcY), tear: ch.tear.map(mirrorArcY) };
  }
  if (ch.kind === "ornament") {
    return {
      ...ch,
      paths: ch.paths.map((path) => path.map((point) => ({ x: point.x, y: stageHeight() - point.y }))),
    };
  }
  return {
    ...ch,
    arcs: ch.arcs.map(mirrorArcY),
    terminalLeaf: ch.terminalLeaf
      ? {
          ...ch.terminalLeaf,
          outer: ch.terminalLeaf.outer.map(mirrorArcY),
          inner: ch.terminalLeaf.inner.map(mirrorArcY),
        }
      : null,
  };
}

function reflectedChains(ch) {
  let out = [ch];
  if (params.mirror) {
    out.push(mirrorChainX(ch));
  }
  if (params.verticalSymmetry) {
    out = out.concat(out.map((item) => mirrorChainY(item)));
  }
  return out;
}

function drawRibbon(ch) {
  const samples = sampleArcs(ch.arcs, 2.2);
  const total = samples[samples.length - 1].s;
  const left = [];
  const right = [];

  for (const p of samples) {
    const w = widthAt(ch, p.s / total) / 2;
    const nx = -p.ty;
    const ny = p.tx;
    left.push([p.x + nx * w, p.y + ny * w]);
    right.push([p.x - nx * w, p.y - ny * w]);
  }

  beginShape();
  for (const v of left) vertex(v[0], v[1]);
  for (let i = right.length - 1; i >= 0; i--) vertex(right[i][0], right[i][1]);
  endShape(CLOSE);

  const last = ch.arcs[ch.arcs.length - 1];
  if (last.r < 6) {
    const [x, y] = arcPointAt(last, 1);
    circle(x, y, Math.max(1.6, ch.wBase * 0.35));
  }
}

function drawArcPath(arcs, color, weight = 2.2) {
  if (!arcs || !arcs.length) {
    return;
  }
  const samples = sampleArcs(arcs, 2);
  drawSamplePath(samples, color, weight);
}

function drawSamplePath(samples, color, weight = 2.2) {
  if (!samples || !samples.length) {
    return;
  }
  push();
  noFill();
  stroke(color);
  strokeWeight(Math.max(1, weight * stageScale()));
  strokeCap(ROUND);
  strokeJoin(ROUND);
  beginShape();
  for (const p of samples) {
    vertex(p.x, p.y);
  }
  endShape();
  pop();
}

function drawTerminalLeaf(ch) {
  if (!ch.terminalLeaf) {
    return;
  }

  const outer = sampleArcs(ch.terminalLeaf.outer, 2);
  const inner = sampleArcs(ch.terminalLeaf.inner, 2);
  if (outer.length < 2 || inner.length < 2) {
    return;
  }

  push();
  noFill();
  stroke(appState.invertPreview ? "#161614" : "#e9e7df");
  strokeWeight(Math.max(1, ch.wBase * 0.7));
  strokeCap(ROUND);
  strokeJoin(ROUND);
  beginShape();
  for (const p of outer) {
    vertex(p.x, p.y);
  }
  for (let i = inner.length - 1; i >= 0; i--) {
    vertex(inner[i].x, inner[i].y);
  }
  endShape();
  pop();
}

function drawDebugChain(ch) {
  if (ch.kind === "leaf") {
    drawArcPath(ch.stem, "#5ec8ff", 2.4);
    drawArcPath([ch.tear[0]], "#ff5e7a", 2.2);
    drawArcPath([ch.tear[1]], "#ffb85e", 2.2);
    return;
  }
  if (ch.kind === "ornament") {
    for (const path of ch.paths) {
      drawSamplePath(sampleClosedPath(path, true), "#7dff7a", 2.2);
    }
    return;
  }
  if (ch.kind !== "stroke") {
    return;
  }

  const meta = ch.debugMeta;
  if (!meta) {
    drawArcPath(ch.arcs, "#5ec8ff", 2.4);
    return;
  }

  drawArcPath(ch.arcs.slice(0, meta.bodyEndIndex + 1), "#5ec8ff", 2.4);
  drawArcPath(ch.arcs.slice(meta.bodyEndIndex + 1, meta.transitionIndex + 1), "#ffb85e", 2.8);
  drawArcPath(ch.arcs.slice(meta.terminalStartIndex), "#7dff7a", 2.6);
  if (ch.terminalLeaf?.inner?.length) {
    drawArcPath(ch.terminalLeaf.inner, "#ff5ef1", 2.2);
  }
}

function drawLeaf(ch) {
  const st = sampleArcs(ch.stem, 2.2);
  const total = st[st.length - 1].s;
  const left = [];
  const right = [];

  for (const p of st) {
    const w = ch.wBase / 2;
    const nx = -p.ty;
    const ny = p.tx;
    left.push([p.x + nx * w, p.y + ny * w]);
    right.push([p.x - nx * w, p.y - ny * w]);
  }

  beginShape();
  for (const v of left) vertex(v[0], v[1]);
  for (let i = right.length - 1; i >= 0; i--) vertex(right[i][0], right[i][1]);
  endShape(CLOSE);

  const s1 = sampleArcs([ch.tear[0]], 2);
  const s2 = sampleArcs([ch.tear[1]], 2);
  beginShape();
  for (const p of s1) vertex(p.x, p.y);
  for (let i = s2.length - 1; i >= 0; i--) vertex(s2[i].x, s2[i].y);
  endShape(CLOSE);
}

function drawOrnament(ch) {
  for (const path of ch.paths) {
    beginShape();
    for (const point of path) {
      vertex(point.x, point.y);
    }
    endShape(CLOSE);
  }
}

function drawChain(ch) {
  if (ch.kind === "stroke") {
    if (appState.debugParts) {
      drawDebugChain(ch);
    } else {
      drawRibbon(ch);
      drawTerminalLeaf(ch);
    }
  } else if (ch.kind === "leaf") {
    if (appState.debugParts) {
      drawDebugChain(ch);
    } else {
      drawLeaf(ch);
    }
  } else if (ch.kind === "ornament") {
    if (appState.debugParts) {
      drawDebugChain(ch);
    } else {
      drawOrnament(ch);
    }
  }
}

function drawPlacedSpawnGuides() {
  if (!isPlacedSpawnMotif()) {
    return;
  }

  const bounds = sourceBounds();
  push();
  noFill();
  stroke(appState.invertPreview ? "rgba(22,22,20,0.22)" : "rgba(233,231,223,0.22)");
  strokeWeight(Math.max(1, stageScale()));
  drawingContext.setLineDash([Math.max(6, su(10)), Math.max(4, su(8))]);
  rect(bounds.xMin, bounds.yMin, bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
  drawingContext.setLineDash([]);

  const liveColor = appState.invertPreview ? "#161614" : "#e9e7df";
  const ghostColor = appState.invertPreview ? "rgba(22,22,20,0.34)" : "rgba(233,231,223,0.34)";
  strokeWeight(Math.max(1.4, stageScale() * 1.4));

  for (let i = 0; i < appState.manualSpawnPoints.length; i++) {
    const point = appState.manualSpawnPoints[i];
    if (inVoid(point.x, point.y) || !manualSpawnAllowed(point)) {
      continue;
    }
    const reflected = reflectedPlacementCopies(point);
    for (const item of reflected) {
      const isBase = item.isBase;
      const color = isBase ? liveColor : ghostColor;
      const handleLen = su(isBase ? 34 : 28);
      const tipX = item.x + Math.cos(item.launchAngle) * handleLen;
      const tipY = item.y + Math.sin(item.launchAngle) * handleLen;

      stroke(color);
      line(item.x, item.y, tipX, tipY);
      line(
        tipX,
        tipY,
        tipX - Math.cos(item.launchAngle - 0.42) * su(8),
        tipY - Math.sin(item.launchAngle - 0.42) * su(8)
      );
      line(
        tipX,
        tipY,
        tipX - Math.cos(item.launchAngle + 0.42) * su(8),
        tipY - Math.sin(item.launchAngle + 0.42) * su(8)
      );

      const isActive = isBase && i === activeManualSpawnIndex;
      stroke(isActive ? liveColor : color);
      stroke(isBase ? liveColor : ghostColor);
      line(item.x - su(8), item.y, item.x + su(8), item.y);
      line(item.x, item.y - su(8), item.x, item.y + su(8));
      noStroke();
      fill(isActive ? liveColor : color);
      circle(item.x, item.y, su(isActive ? 10 : isBase ? 8 : 6));
    }
  }

  pop();
}

function setup() {
  syncDesignSizeFromCanvas();
  cnv = createCanvas(stageWidth(), stageHeight());
  cnv.parent("wrap");
  pixelDensity(2);
  noLoop();
  pane = buildPane({
    state: appState,
    container: document.getElementById("pane"),
    onPatternChange: regenerateModel,
    onMotifPresetChange: handleMotifPresetChange,
    onClearPlacedSpawns: clearPlacedSpawns,
    onCanvasChange: handleCanvasResizeAndRedraw,
    onViewChange: redraw,
    onSeedChange: () => setSeed(appState.seed),
    onResetZoom: resetZoom,
    onCanvasPresetChange: handleCanvasPresetChange,
  });
  bindButtons({
    onPrevSeed: () => stepSeed(-1),
    onNextSeed: () => stepSeed(1),
    onRandomSeed: randomSeed_,
    onRegenerate: regenerate,
    onReset: resetParams,
    onPng: downloadPNG,
    onSvg: downloadSVG,
  });
  window.addEventListener("resize", handleCanvasResize);
  syncCanvasSize(appState, cnv, resizeCanvas, "wrap");
  regenerateModel();
}

function draw() {
  clear();
  background(appState.invertPreview ? "#f6f4ee" : "#0e0e10");
  const m = margin();
  stroke(appState.invertPreview ? "rgba(22,22,20,0.35)" : "rgba(233,231,223,0.28)");
  strokeWeight(Math.max(1, stageScale()));
  noFill();
  rect(m, m, stageWidth() - m * 2, stageHeight() - m * 2);
  noStroke();
  fill(appState.invertPreview ? "#161614" : "#e9e7df");

  for (const ch of model.chains) {
    if (shouldSuppressUnresolvedCurl(ch)) {
      continue;
    }
    for (const reflected of reflectedChains(ch)) {
      drawChain(reflected);
    }
  }

  drawVoidMask();
  drawPlacedSpawnGuides();
}

// ============================= UI =============================
function handleCanvasChange() {
  updateCanvasDisplaySize(appState, cnv, "wrap");
  redraw();
}

function handleCanvasResizeAndRedraw() {
  syncDesignSizeFromCanvas();
  syncCanvasSize(appState, cnv, resizeCanvas, "wrap");
  regenerateModel();
}

function handleCanvasResize() {
  updateCanvasDisplaySize(appState, cnv, "wrap");
}

function handleCanvasPresetChange() {
  const preset = CANVAS_PRESETS[appState.canvasPreset];
  if (preset) {
    appState.canvasWMM = preset.widthMM;
    appState.canvasHMM = preset.heightMM;
  }
  if (pane) {
    pane.refresh();
  }
  handleCanvasResizeAndRedraw();
}

function handleMotifPresetChange(motifPreset = appState.motifPreset) {
  applyMotifPreset(appState, motifPreset);
  params = appState.params;
  activeManualSpawnIndex = -1;
  isDraggingManualSpawnAngle = false;
  if (pane) {
    pane.refresh();
  }
  regenerateModel();
}

function clearPlacedSpawns() {
  appState.manualSpawnPoints = [];
  activeManualSpawnIndex = -1;
  isDraggingManualSpawnAngle = false;
  regenerateModel();
}

function resetZoom() {
  resetCanvasView(appState);
  pane.refresh();
  handleCanvasChange();
}

function syncDesignSizeFromCanvas() {
  appState.designWidth = Math.max(1, Math.round((appState.canvasWMM * appState.dpi) / 25.4));
  appState.designHeight = Math.max(1, Math.round((appState.canvasHMM * appState.dpi) / 25.4));
}

function regenerateModel() {
  generate();
  updateStats({
    seed: appState.seed,
    arcs: model.stats.arcs,
    chains: model.stats.chains,
    length: model.stats.length,
    g1: verifyG1(),
  });
  redraw();
}

function setSeed(s) {
  appState.seed = Math.max(1, Math.floor(s));
  if (pane) {
    pane.refresh();
  }
  regenerateModel();
}

function stepSeed(d) {
  setSeed(appState.seed + d);
}

function randomSeed_() {
  setSeed(Math.floor(Math.random() * 99999) + 1);
}

function regenerate() {
  regenerateModel();
}

function resetParams() {
  resetAppState(appState);
  params = appState.params;
  activeManualSpawnIndex = -1;
  isDraggingManualSpawnAngle = false;
  if (pane) {
    pane.refresh();
  }
  handleCanvasResizeAndRedraw();
}

function mousePressed(event) {
  if (!isPlacedSpawnMotif() || !cnv?.elt || !event) {
    return;
  }

  const point = pointFromCanvasEvent(event);
  if (!point) {
    return;
  }
  const { x, y } = point;

  if (x < 0 || x > stageWidth() || y < 0 || y > stageHeight()) {
    return;
  }

  const selectedIndex = findManualSpawnIndex(x, y);
  if (selectedIndex >= 0) {
    activeManualSpawnIndex = selectedIndex;
    isDraggingManualSpawnAngle = true;
    redraw();
    return false;
  }

  const bounds = sourceBounds();
  if (
    x < bounds.xMin ||
    x > bounds.xMax ||
    y < bounds.yMin ||
    y > bounds.yMax ||
    !inBounds(x, y) ||
    inVoid(x, y) ||
    !manualSpawnAllowed({ x, y })
  ) {
    return false;
  }

  const launchAngle = flowAngleAt(x, y, "spine");
  appState.manualSpawnPoints.push({ x, y, launchAngle });
  activeManualSpawnIndex = appState.manualSpawnPoints.length - 1;
  isDraggingManualSpawnAngle = true;
  regenerateModel();
  return false;
}

function mouseDragged(event) {
  if (!isPlacedSpawnMotif() || !isDraggingManualSpawnAngle || activeManualSpawnIndex < 0) {
    return;
  }

  const point = pointFromCanvasEvent(event);
  if (!point) {
    return;
  }

  if (updateManualSpawnLaunchAngle(activeManualSpawnIndex, point.x, point.y)) {
    redraw();
  }
  return false;
}

function mouseReleased(event) {
  if (!isPlacedSpawnMotif() || !isDraggingManualSpawnAngle || activeManualSpawnIndex < 0) {
    return;
  }

  const point = pointFromCanvasEvent(event);
  if (point) {
    updateManualSpawnLaunchAngle(activeManualSpawnIndex, point.x, point.y);
  }

  isDraggingManualSpawnAngle = false;
  regenerateModel();
  return false;
}

function doubleClicked(event) {
  if (!isPlacedSpawnMotif()) {
    return;
  }

  const point = pointFromCanvasEvent(event);
  if (!point) {
    return;
  }

  const removeIndex = findManualSpawnIndex(point.x, point.y);
  if (removeIndex < 0) {
    return;
  }

  appState.manualSpawnPoints.splice(removeIndex, 1);
  activeManualSpawnIndex = -1;
  isDraggingManualSpawnAngle = false;
  regenerateModel();
  return false;
}

function downloadPNG() {
  downloadPng(saveCanvas, appState.seed);
}

function downloadSVG() {
  downloadSvg({
    width: stageWidth(),
    height: stageHeight(),
    seed: appState.seed,
    decay: params.decay,
    invertPreview: appState.invertPreview,
    model,
    voidMask: params.voidOn && appState.exportVoid ? stageVoid() : null,
    reflectedChains,
    shouldSuppressUnresolvedCurl,
    helpers: {
      arcPointAt,
      reverseArcs,
    },
  });
}
