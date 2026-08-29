// ============================= CORE (pure, no rendering deps) =============================
const TAU = Math.PI * 2;
const PI = Math.PI;
const BASE_W = 1500;
const BASE_H = 900;
const { CANVAS_PRESETS, GRAMMAR_PRESETS, applyMotifPreset, createAppState, resetAppState } = window.VictorianPatternState;
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
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeVec = (x, y) => {
  const mag = Math.hypot(x, y) || 1;
  return [x / mag, y / mag];
};
const REVEAL_SPEED_PX_PER_SEC = 3200;
const REVEAL_PARALLEL_CHAIN_BATCH = 8;

let revealState = {
  playing: false,
  startMs: 0,
  elapsedMs: 0,
  totalLength: 0,
  segments: [],
  rafId: 0,
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

function getActiveGrammar() {
  return GRAMMAR_PRESETS[appState.motifPreset] || GRAMMAR_PRESETS.freeField;
}

function roleForTier(defaultRole, point) {
  return point?.role || defaultRole || "support";
}

function chainRoleProfile(chain) {
  const grammar = getActiveGrammar();
  const role = chain?.role || "support";
  const branchStartKey = `${role}BranchStart`;
  const branchEndKey = `${role}BranchEnd`;
  const branchRateKey = `${role}BranchRate`;
  const spacingScaleKey = `${role}SpacingScale`;
  const leafBiasKey = `${role}LeafBias`;
  return {
    role,
    branchStart: grammar[branchStartKey] ?? grammar.supportBranchStart ?? 0.3,
    branchEnd: grammar[branchEndKey] ?? grammar.supportBranchEnd ?? 0.8,
    branchRate: grammar[branchRateKey] ?? grammar.supportBranchRate ?? 0.6,
    spacingScale: grammar[spacingScaleKey] ?? grammar.supportSpacingScale ?? 1,
    leafBias: grammar[leafBiasKey] ?? grammar.supportLeafBias ?? 1,
    quietRadiusScale: grammar.quietRadiusScale ?? 1,
    contourBranchBias: grammar.contourBranchBias ?? 0.5,
  };
}

function branchWindowForChain(chain) {
  const profile = chainRoleProfile(chain);
  const total = Math.max(1, chainLen(chain.arcs || []));
  const band = Math.max(0.14, profile.branchEnd - profile.branchStart);
  const depthTightening = Math.min(0.08, chain.depth * 0.02);
  const center = clamp(
    (profile.branchStart + profile.branchEnd) * 0.5 + (chain.zoneBias ?? 0) * 0.04,
    0.18,
    0.88
  );
  const halfBand = Math.max(0.08, band * 0.5 - depthTightening);
  return {
    total,
    start: clamp(center - halfBand, 0.12, 0.9),
    end: clamp(center + halfBand, 0.16, 0.94),
    spacing: params.spacing * profile.spacingScale,
    branchRate: Math.max(0.05, profile.branchRate * (chain.branchRateScale ?? 1)),
    leafBias: Math.max(0.3, profile.leafBias * (chain.leafBiasScale ?? 1)),
  };
}

function sampleZoneAt(t, window) {
  if (t < window.start * 0.72) {
    return "launch";
  }
  if (t < window.start) {
    return "shoulder";
  }
  if (t <= window.end) {
    return "body";
  }
  if (t <= Math.min(0.98, window.end + 0.12)) {
    return "terminal";
  }
  return "tail";
}

function branchChanceForZone(zone, window, chain) {
  const contourBias = chain.contourBias ?? 0;
  const roleProfile = chainRoleProfile(chain);
  switch (zone) {
    case "launch":
      return 0;
    case "shoulder":
      return window.branchRate * 0.45;
    case "body":
      return window.branchRate * (0.92 + contourBias * roleProfile.contourBranchBias * 0.18);
    case "terminal":
      return window.branchRate * 0.36;
    default:
      return 0;
  }
}

function chooseChildRole(parentRole, zone, prefersFloating = false) {
  if (prefersFloating) {
    return "filler";
  }
  if (parentRole === "hero") {
    return zone === "body" ? "support" : "filler";
  }
  if (parentRole === "support") {
    return "filler";
  }
  return "terminal";
}

function roleDebugColor(role) {
  switch (role) {
    case "hero":
      return "rgba(255, 184, 77, 0.95)";
    case "support":
      return "rgba(111, 202, 255, 0.9)";
    case "filler":
      return "rgba(161, 241, 132, 0.9)";
    case "terminal":
      return "rgba(255, 123, 160, 0.88)";
    default:
      return "rgba(220, 220, 220, 0.82)";
  }
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
  const rectW = (width * (mask.rectWPct ?? mask.wPct)) / 100;
  const rectH = (height * (mask.rectHPct ?? mask.hPct)) / 100;
  const ovalW = (width * (mask.ovalWPct ?? mask.wPct)) / 100;
  const ovalH = (height * (mask.ovalHPct ?? mask.hPct)) / 100;
  const cx = (width * mask.xPct) / 100;
  const cy = (height * mask.yPct) / 100;
  return {
    shape: mask.shape,
    invertRectOval: Boolean(mask.invertRectOval),
    cx,
    cy,
    rx: w * 0.5,
    ry: h * 0.5,
    x: cx - w * 0.5,
    y: cy - h * 0.5,
    width: w,
    height: h,
    rectX: cx - rectW * 0.5,
    rectY: cy - rectH * 0.5,
    rectWidth: rectW,
    rectHeight: rectH,
    rectCx: cx,
    rectCy: cy,
    rectRx: rectW * 0.5,
    rectRy: rectH * 0.5,
    ovalCx: cx,
    ovalCy: cy,
    ovalRx: ovalW * 0.5,
    ovalRy: ovalH * 0.5,
  };
}

function pointInsideRectShape(voidShape, x, y) {
  return (
    x > voidShape.rectX &&
    x < voidShape.rectX + voidShape.rectWidth &&
    y > voidShape.rectY &&
    y < voidShape.rectY + voidShape.rectHeight
  );
}

function pointInsideOvalShape(voidShape, x, y) {
  const dx = (x - voidShape.ovalCx) / Math.max(voidShape.ovalRx, 1e-6);
  const dy = (y - voidShape.ovalCy) / Math.max(voidShape.ovalRy, 1e-6);
  return dx * dx + dy * dy < 1;
}

function pointInsideRectOvalVoid(voidShape, x, y) {
  const insideRect = pointInsideRectShape(voidShape, x, y);
  const insideOval = pointInsideOvalShape(voidShape, x, y);
  return voidShape.invertRectOval ? insideRect && !insideOval : insideRect && insideOval;
}

function buildRectBoundarySamples(voidShape, sampleCount = 240) {
  const points = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    let x = voidShape.rectX;
    let y = voidShape.rectY;
    let tx = 1;
    let ty = 0;
    let nx = 0;
    let ny = -1;

    if (t < 0.25) {
      x = lerp(voidShape.rectX, voidShape.rectX + voidShape.rectWidth, t / 0.25);
    } else if (t < 0.5) {
      x = voidShape.rectX + voidShape.rectWidth;
      y = lerp(voidShape.rectY, voidShape.rectY + voidShape.rectHeight, (t - 0.25) / 0.25);
      tx = 0;
      ty = 1;
      nx = 1;
      ny = 0;
    } else if (t < 0.75) {
      x = lerp(
        voidShape.rectX + voidShape.rectWidth,
        voidShape.rectX,
        (t - 0.5) / 0.25
      );
      y = voidShape.rectY + voidShape.rectHeight;
      tx = -1;
      ty = 0;
      nx = 0;
      ny = 1;
    } else {
      y = lerp(
        voidShape.rectY + voidShape.rectHeight,
        voidShape.rectY,
        (t - 0.75) / 0.25
      );
      tx = 0;
      ty = -1;
      nx = -1;
      ny = 0;
    }

    points.push({
      x,
      y,
      tangentAngle: Math.atan2(ty, tx),
      outwardNormal: [nx, ny],
    });
  }
  return points;
}

function buildOvalBoundarySamples(voidShape, sampleCount = 240, invertNormal = false) {
  const points = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = (TAU * i) / sampleCount;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const nx = invertNormal ? -cosA : cosA;
    const ny = invertNormal ? -sinA : sinA;
    points.push({
      x: voidShape.ovalCx + cosA * voidShape.ovalRx,
      y: voidShape.ovalCy + sinA * voidShape.ovalRy,
      tangentAngle: angle + HALF_PI,
      outwardNormal: [nx, ny],
    });
  }
  return points;
}

function buildRectOvalIntersectionBoundary(voidShape, sampleCount = 240) {
  const points = [];
  const addPoint = (point) => {
    if (points.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) < 0.75)) {
      return;
    }
    points.push(point);
  };

  for (const sample of buildRectBoundarySamples(voidShape, sampleCount)) {
    if (pointInsideOvalShape(voidShape, sample.x, sample.y)) {
      addPoint(sample);
    }
  }

  for (const sample of buildOvalBoundarySamples(voidShape, sampleCount)) {
    if (pointInsideRectShape(voidShape, sample.x, sample.y)) {
      addPoint(sample);
    }
  }

  return points
    .map((point) => ({
      ...point,
      sortAngle: Math.atan2(point.y - voidShape.cy, point.x - voidShape.cx),
      centerAngle: Math.atan2(voidShape.cy - point.y, voidShape.cx - point.x),
    }))
    .sort((a, b) => a.sortAngle - b.sortAngle);
}

function inVoid(x, y) {
  if (!params.voidOn) {
    return false;
  }
  const currentVoid = stageVoid();
  if (currentVoid.shape === "rectOvalIntersect") {
    return pointInsideRectOvalVoid(currentVoid, x, y);
  }
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
  const ctx = drawingContext;
  const paper = appState.invertPreview ? "#f6f4ee" : "#0e0e10";
  ctx.save();
  ctx.fillStyle = paper;
  if (currentVoid.shape === "rectOvalIntersect") {
    if (currentVoid.invertRectOval) {
      ctx.beginPath();
      ctx.rect(
        currentVoid.rectX,
        currentVoid.rectY,
        currentVoid.rectWidth,
        currentVoid.rectHeight
      );
      ctx.ellipse(
        currentVoid.ovalCx,
        currentVoid.ovalCy,
        currentVoid.ovalRx,
        currentVoid.ovalRy,
        0,
        0,
        TAU
      );
      ctx.fill("evenodd");
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        currentVoid.rectX,
        currentVoid.rectY,
        currentVoid.rectWidth,
        currentVoid.rectHeight
      );
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(
        currentVoid.ovalCx,
        currentVoid.ovalCy,
        currentVoid.ovalRx,
        currentVoid.ovalRy,
        0,
        0,
        TAU
      );
      ctx.fill();
      ctx.restore();
    }
  } else if (currentVoid.shape === "rect") {
    ctx.fillRect(currentVoid.x, currentVoid.y, currentVoid.width, currentVoid.height);
  } else {
    ctx.beginPath();
    ctx.ellipse(currentVoid.cx, currentVoid.cy, currentVoid.rx, currentVoid.ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawVoidOutline() {
  if (!params.voidOn || !appState.debugParts) {
    return;
  }

  const currentVoid = stageVoid();
  push();
  noFill();
  stroke(appState.invertPreview ? "#161614" : "#e9e7df");
  strokeWeight(Math.max(1, stageScale()));
  strokeCap(ROUND);
  strokeJoin(ROUND);

  if (currentVoid.shape === "rectOvalIntersect") {
    if (currentVoid.invertRectOval) {
      rect(currentVoid.rectX, currentVoid.rectY, currentVoid.rectWidth, currentVoid.rectHeight);
      ellipse(
        currentVoid.ovalCx,
        currentVoid.ovalCy,
        currentVoid.ovalRx * 2,
        currentVoid.ovalRy * 2
      );
    } else {
      const boundary = buildRectOvalIntersectionBoundary(currentVoid, 220);
      if (boundary.length >= 2) {
        beginShape();
        for (const point of boundary) {
          vertex(point.x, point.y);
        }
        endShape(CLOSE);
      }
    }
  } else if (currentVoid.shape === "rect") {
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
  chain.chainId = chain.chainId ?? `chain-${model.nextChainId++}`;
  chain.createdIndex = chain.createdIndex ?? model.chains.length;
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

function appendPlannedArc(arcs, P, T, sign, radius, sweep) {
  const { arc, ex, ey, etx, ety } = arcFrom(
    P[0],
    P[1],
    T[0],
    T[1],
    Math.max(1.2, radius),
    sign,
    Math.max(0.02, sweep)
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

function stemGestureTarget(px, py, tier = {}, options = {}) {
  const bounds = options.bounds ?? sourceBounds();
  const targetX = tier.targetX ?? lerp(bounds.xMin, bounds.xMax, 0.54);
  const targetY = tier.targetY ?? lerp(bounds.yMin, bounds.yMax, 0.22);
  return {
    x: targetX,
    y: targetY,
  };
}

function chooseGestureBendSign(px, py, launchAngle, tier = {}, options = {}) {
  const preferredSign = options.preferredSign ?? null;
  const rootScale = tier.rootScale ?? 1;
  const tangent = [Math.cos(launchAngle), Math.sin(launchAngle)];
  const target = stemGestureTarget(px, py, tier, options);
  const targetAngle = Math.atan2(target.y - py, target.x - px);
  const flowAngle = options.flowAngle ?? flowAngleAt(px, py, "spine");
  const candidates = [1, -1];
  let bestSign = preferredSign ?? 1;
  let bestScore = -Infinity;

  for (const sign of candidates) {
    let score = 0;
    const probeRadius = rnd(su(220), su(320)) * rootScale;
    const probeSweep = rnd(0.18, 0.3);
    const { ex, ey, etx, ety } = arcFrom(px, py, tangent[0], tangent[1], probeRadius, sign, probeSweep);
    const tangentAngle = Math.atan2(ety, etx);
    const targetAlign = Math.cos(angleBetween(tangentAngle, targetAngle));
    const flowAlign = Math.cos(angleBetween(tangentAngle, flowAngle));
    const inward = params.mirror ? stageWidth() * 0.25 : stageWidth() * 0.5;
    const inwardGain = sign * Math.sign(inward - px) * 0.22;
    const upwardGain = Math.max(0, py - ey) / Math.max(su(40), stageHeight() * 0.12);
    const rootPenalty = Math.abs(angleBetween(tangentAngle, launchAngle));
    score += targetAlign * 2.4;
    score += flowAlign * 1.8;
    score += inwardGain;
    score += upwardGain * 0.8;
    score -= rootPenalty * 0.32;
    if (preferredSign === sign) {
      score += 0.42;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSign = sign;
    }
  }

  return bestSign;
}

function buildSpineGestureSchedule(baseRadius, bendSign, options = {}) {
  const role = options.role ?? "support";
  const contourBias = options.contourBias ?? 0;
  const isCorner = options.isCorner ?? false;
  const reversalChanceBase =
    role === "hero" ? 0.48 : role === "support" ? 0.36 : 0.22;
  const reversalChance = reversalChanceBase * (isCorner ? 0.82 : 1) * (1 - contourBias * 0.22);
  const hasReversal = chance(reversalChance);
  const launchSweep = isCorner ? rnd(0.1, 0.2) : rnd(0.08, 0.18);
  const launchRadius = baseRadius * rnd(1.9, 2.45);
  const earlySweep = rnd(0.14, 0.24);
  const earlyRadius = baseRadius * rnd(1.34, 1.72);
  const bodySweep = rnd(0.2, 0.34);
  const bodyRadius = baseRadius * rnd(0.96, 1.2);
  const crestSweep = rnd(0.18, 0.3);
  const crestRadius = baseRadius * rnd(0.72, 0.94);
  const steps = [
    { sign: bendSign, radius: launchRadius, sweep: launchSweep, phase: "launch" },
    { sign: bendSign, radius: earlyRadius, sweep: earlySweep, phase: "launch" },
    { sign: bendSign, radius: bodyRadius, sweep: bodySweep, phase: "body" },
    { sign: bendSign, radius: crestRadius, sweep: crestSweep, phase: "body" },
  ];

  let curlSign = bendSign;
  if (hasReversal) {
    const inflectionRadiusA = baseRadius * rnd(1.9, 2.5);
    const inflectionRadiusB = baseRadius * rnd(2.25, 2.9);
    const reverseRadius = baseRadius * rnd(1.02, 1.34);
    steps.push(
      { sign: bendSign, radius: inflectionRadiusA, sweep: rnd(0.06, 0.13), phase: "inflect" },
      { sign: -bendSign, radius: inflectionRadiusB, sweep: rnd(0.06, 0.12), phase: "inflect" },
      { sign: -bendSign, radius: reverseRadius, sweep: rnd(0.14, 0.26), phase: "reverse" }
    );
    if (chance(0.62)) {
      steps.push({
        sign: -bendSign,
        radius: baseRadius * rnd(0.8, 1.02),
        sweep: rnd(0.1, 0.22),
        phase: "reverse",
      });
    }
    curlSign = -bendSign;
  } else {
    steps.push({
      sign: bendSign,
      radius: baseRadius * rnd(0.62, 0.82),
      sweep: rnd(0.12, 0.24),
      phase: "settle",
    });
  }

  return {
    steps,
    hasReversal,
    curlSign,
  };
}

function buildSpineTerminalSchedule(hostRadius, targetRadius, options = {}) {
  const role = options.role ?? "support";
  const isCorner = options.isCorner ?? false;
  const hasReversal = options.hasReversal ?? false;
  const leadFactor =
    role === "hero" ? 1.14 : role === "support" ? 1 : 0.92;
  const targetLead = Math.max(targetRadius * 1.08, targetRadius / Math.max(0.58, Math.min(0.9, params.decay)));
  const baseRadii = [
    Math.max(targetRadius * 2.6 * leadFactor, lerp(hostRadius, targetRadius, 0.24)),
    Math.max(targetRadius * 2.05 * leadFactor, lerp(hostRadius, targetRadius, 0.42)),
    Math.max(targetRadius * 1.62 * leadFactor, lerp(hostRadius, targetRadius, 0.6)),
    Math.max(targetRadius * 1.28 * leadFactor, lerp(hostRadius, targetRadius, 0.76)),
    Math.max(targetLead, targetRadius * 1.06),
  ];
  const radii = hasReversal ? baseRadii.slice(1) : baseRadii;
  const sweeps = isCorner
    ? [rnd(0.08, 0.12), rnd(0.1, 0.14), rnd(0.12, 0.17), rnd(0.14, 0.2), rnd(0.16, 0.22)]
    : [rnd(0.1, 0.14), rnd(0.12, 0.17), rnd(0.14, 0.2), rnd(0.16, 0.22), rnd(0.18, 0.24)];
  return radii.map((radius, index) => ({
    radius,
    sweep: sweeps[Math.min(index, sweeps.length - 1)],
  }));
}

function appendSpineTerminal(arcs, P, T, sign, hostRadius, targetRadius, options = {}) {
  const schedule = buildSpineTerminalSchedule(hostRadius, targetRadius, options);
  let phase = { P, T };
  const transitionStartIndex = arcs.length;
  for (const step of schedule) {
    phase = appendPlannedArc(arcs, phase.P, phase.T, sign, step.radius, step.sweep);
  }
  return {
    P: phase.P,
    T: phase.T,
    transitionStartIndex,
    transitionIndex: arcs.length - 1,
    entryRadius: schedule.length ? schedule[schedule.length - 1].radius : targetRadius,
  };
}

function scoreSpineCandidate(candidate, config = {}) {
  const { arcs, launchAngle, curlRadius, hasReversal, transitionStartIndex, targetAngle, breathing } = candidate;
  let score = 0;
  let curvatureJumpPenalty = 0;
  let transitionPenalty = 0;
  let inflectionReward = 0;

  for (let i = 0; i < arcs.length - 1; i++) {
    const current = arcs[i];
    const next = arcs[i + 1];
    const currentCurvature = (Math.sign(current.da) || 1) / Math.max(current.r, 1e-6);
    const nextCurvature = (Math.sign(next.da) || 1) / Math.max(next.r, 1e-6);
    const curvatureJump = Math.abs(nextCurvature - currentCurvature);
    curvatureJumpPenalty += curvatureJump * (i === 0 ? 1.4 : 1);
    if (i >= transitionStartIndex - 1) {
      transitionPenalty += curvatureJump;
    }
    if (Math.sign(current.da) !== Math.sign(next.da)) {
      const softZone = Math.min(current.r, next.r) > Math.max(curlRadius * 1.45, su(90));
      inflectionReward += softZone ? 0.85 : -0.95;
    }
  }

  const first = arcs[0];
  const rootTurnPenalty = Math.abs(first.da) / Math.max(first.r, 1e-6) * su(210);
  const bodyEndArc = arcs[Math.max(0, transitionStartIndex - 1)] ?? arcs[arcs.length - 1];
  const curlContinuityPenalty = Math.abs((1 / Math.max(bodyEndArc.r, 1e-6)) - (1 / Math.max(curlRadius, 1e-6))) * su(85);
  const lastArc = arcs[arcs.length - 1];
  const [endTx, endTy] = arcTangentAt(lastArc, 1);
  const endAngle = Math.atan2(endTy, endTx);
  const targetAlignment = Math.cos(angleBetween(endAngle, targetAngle));
  const launchAlignment = Math.cos(angleBetween(Math.atan2(arcTangentAt(first, 1)[1], arcTangentAt(first, 1)[0]), launchAngle));

  score += targetAlignment * 2.8;
  score += launchAlignment * 1.4;
  score += hasReversal ? inflectionReward + 0.2 : 0.3;
  if (breathing) {
    const contourAllowance = 1 - Math.min(0.8, config.contourBias ?? 0);
    score += (breathing.avgMinSide / Math.max(su(42), params.spacing * 1.2)) * 1.8;
    score += (breathing.avgClearance / Math.max(su(64), params.spacing * 1.8)) * 0.9;
    score += breathing.balance * 1.2 * contourAllowance;
    score += (breathing.minSide / Math.max(su(28), params.spacing * 0.8)) * 0.8;
  }
  score -= curvatureJumpPenalty * su(16);
  score -= transitionPenalty * su(28);
  score -= curlContinuityPenalty;
  score -= rootTurnPenalty;

  if (config.role === "hero") {
    score += bodyEndArc.r > curlRadius * 1.6 ? 0.4 : -0.2;
  }

  return score;
}

function buildGestureStemCandidate(config) {
  const {
    px,
    py,
    launchAngle,
    startSign,
    rootScale,
    role,
    contourScale = 1,
    contourBias = 0,
    isCorner = false,
  } = config;
  const T = [Math.cos(launchAngle), Math.sin(launchAngle)];
  const baseRadius = rnd(isCorner ? su(220) : su(180), isCorner ? su(330) : su(280)) * rootScale * contourScale;
  const schedule = buildSpineGestureSchedule(baseRadius, startSign, {
    role,
    contourBias,
    isCorner,
  });
  const arcs = [];
  let P = [px, py];
  let Tc = T.slice();

  for (const step of schedule.steps) {
    const phase = appendPlannedArc(arcs, P, Tc, step.sign, step.radius, step.sweep);
    P = phase.P;
    Tc = phase.T;
  }
  const bodyEndIndex = Math.max(0, arcs.length - 2);
  const hostRadius = arcs[arcs.length - 1].r;
  const closingRadius = Math.max(
    su(isCorner ? 20 : 18) * rootScale,
    Math.min(su(role === "hero" ? 40 : 36) * rootScale, hostRadius * (schedule.hasReversal ? 0.38 : 0.32))
  );
  const terminal = appendSpineTerminal(arcs, P, Tc, schedule.curlSign, hostRadius, closingRadius, {
    role,
    isCorner,
    hasReversal: schedule.hasReversal,
  });
  const spiralTurns =
    role === "hero"
      ? terminalQuarterTurns(schedule.hasReversal, "spine-hero")
      : role === "support"
        ? terminalQuarterTurns(schedule.hasReversal, "spine-support")
        : terminalQuarterTurns(schedule.hasReversal, "spine");
  const sp = spiralArcs(
    terminal.P[0],
    terminal.P[1],
    terminal.T[0],
    terminal.T[1],
    schedule.curlSign,
    closingRadius,
    params.decay,
    spiralTurns
  );
  arcs.push(...sp.arcs);

  return {
    arcs,
    bodyEndIndex,
    transitionStartIndex: terminal.transitionStartIndex,
    transitionIndex: terminal.transitionIndex,
    terminalStartIndex: terminal.transitionIndex + 1,
    spiral: sp,
    closingRadius,
    hasReversal: schedule.hasReversal,
  };
}

function terminalQuarterTurns(hasReversal, role) {
  if (role === "spine-hero") {
    return hasReversal ? 2 : Math.max(2, Math.min(3, quartersFromTurns() + 1));
  }
  if (role === "spine-support") {
    return hasReversal ? 1 : Math.max(2, Math.min(3, quartersFromTurns()));
  }
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
  const window = branchWindowForChain(chain);

  for (const p of samples) {
    const t = p.s / total;
    if (t < startT || t > endT || p.r < 14) {
      continue;
    }
    const zone = sampleZoneAt(t, window);
    if (zone === "launch" || zone === "tail") {
      continue;
    }
    const zoneBonus = zone === "body" ? 18 : 8;
    const lateBias = t;
    const score = p.r * 0.5 + lateBias * 30 + zoneBonus;
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

  const window = branchWindowForChain(chain);
  const anchor = findBranchAnchor(chain, window.start, window.end);
  if (!anchor) {
    return false;
  }

  const childScale = scale * params.falloff * (chain.role === "hero" ? 0.78 : 0.66);
  const anchorSamples = sampleArcs(chain.arcs, 4);
  const anchorTotal = anchorSamples[anchorSamples.length - 1].s;
  const terminalBias = anchor.s / anchorTotal;
  const zone = sampleZoneAt(terminalBias, window);
  const childRole = chooseChildRole(chain.role, zone, false);
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
      terminalBias,
      chain.chainId,
      childRole
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

function measureStemBreathing(samples, grid, options = {}) {
  if (!samples?.length) {
    return {
      minSide: 0,
      avgMinSide: 0,
      avgClearance: 0,
      balance: 0,
    };
  }

  const total = samples[samples.length - 1].s || 1;
  const startT = options.startT ?? 0.14;
  const endT = options.endT ?? 0.72;
  const maxDistance = options.maxDistance ?? Math.max(su(86), params.spacing * 2.8);
  const step = options.step ?? Math.max(8, params.clearance * 0.8);
  const leftClearances = [];
  const rightClearances = [];

  for (let i = 0; i < samples.length; i += 2) {
    const sample = samples[i];
    const t = sample.s / total;
    if (t < startT || t > endT) {
      continue;
    }
    const normalAngle = Math.atan2(sample.tx, -sample.ty);
    const left = probeClearanceAlongRay(grid, sample.x, sample.y, normalAngle, maxDistance, step, step);
    const right = probeClearanceAlongRay(
      grid,
      sample.x,
      sample.y,
      normalAngle + PI,
      maxDistance,
      step,
      step
    );
    leftClearances.push(left);
    rightClearances.push(right);
  }

  if (!leftClearances.length || !rightClearances.length) {
    return {
      minSide: maxDistance,
      avgMinSide: maxDistance,
      avgClearance: maxDistance,
      balance: 1,
    };
  }

  const avgLeft = leftClearances.reduce((sum, value) => sum + value, 0) / leftClearances.length;
  const avgRight = rightClearances.reduce((sum, value) => sum + value, 0) / rightClearances.length;
  const minSide = Math.min(Math.min(...leftClearances), Math.min(...rightClearances));
  const avgMinSide = leftClearances.reduce((sum, value, index) => sum + Math.min(value, rightClearances[index]), 0) / leftClearances.length;
  const avgClearance = (avgLeft + avgRight) * 0.5;
  const balance = Math.min(avgLeft, avgRight) / Math.max(avgLeft, avgRight, 1e-6);

  return {
    minSide,
    avgMinSide,
    avgClearance,
    balance,
  };
}

function measureCandidateBreathing(samples, grid, options = {}) {
  if (!samples?.length) {
    return {
      minSide: 0,
      avgMinSide: 0,
      avgClearance: 0,
      balance: 0,
    };
  }

  const total = samples[samples.length - 1].s || 1;
  const startT = options.startT ?? 0.08;
  const endT = options.endT ?? 0.92;
  const maxDistance = options.maxDistance ?? Math.max(su(42), params.spacing * 1.8);
  const step = options.step ?? Math.max(8, params.clearance * 0.75);
  const leftClearances = [];
  const rightClearances = [];

  for (let i = 0; i < samples.length; i += 2) {
    const sample = samples[i];
    const t = sample.s / total;
    if (t < startT || t > endT) {
      continue;
    }
    const normalAngle = Math.atan2(sample.tx, -sample.ty);
    const left = probeClearanceAlongRay(grid, sample.x, sample.y, normalAngle, maxDistance, step, step);
    const right = probeClearanceAlongRay(grid, sample.x, sample.y, normalAngle + PI, maxDistance, step, step);
    leftClearances.push(left);
    rightClearances.push(right);
  }

  if (!leftClearances.length) {
    return {
      minSide: maxDistance,
      avgMinSide: maxDistance,
      avgClearance: maxDistance,
      balance: 1,
    };
  }

  const avgLeft = leftClearances.reduce((sum, value) => sum + value, 0) / leftClearances.length;
  const avgRight = rightClearances.reduce((sum, value) => sum + value, 0) / rightClearances.length;
  const minSide = Math.min(Math.min(...leftClearances), Math.min(...rightClearances));
  const avgMinSide = leftClearances.reduce((sum, value, index) => sum + Math.min(value, rightClearances[index]), 0) / leftClearances.length;
  const avgClearance = (avgLeft + avgRight) * 0.5;
  const balance = Math.min(avgLeft, avgRight) / Math.max(avgLeft, avgRight, 1e-6);

  return {
    minSide,
    avgMinSide,
    avgClearance,
    balance,
  };
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
      parentId: null,
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
      parentId: source.chainId,
      role: source.role === "hero" ? "support" : "filler",
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
  const effectiveCount = Math.max(0, Math.round(count * 0.55));
  const points = createDistributedPoints(effectiveCount, placement.bounds, {
    rowBias: placement.rowBias,
    jitterX: placement.jitterX ?? 0.18,
    jitterY: placement.jitterY ?? 0.18,
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

function makeGuidePoint(x, y, launchAngle, options = {}) {
  const point = {
    x,
    y,
    launchAngle,
    lockToGuide: options.lockToGuide ?? true,
  };
  if (options.preferredSign !== undefined) {
    point.preferredSign = options.preferredSign;
  }
  return point;
}

function blendAngles(a, b, t) {
  const x = lerp(Math.cos(a), Math.cos(b), t);
  const y = lerp(Math.sin(a), Math.sin(b), t);
  return Math.atan2(y, x);
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

function createEllipseGuidePoint(cx, cy, rx, ry, angle, options = {}) {
  const x = cx + Math.cos(angle) * rx;
  const y = cy + Math.sin(angle) * ry;
  const tangentAngle = Math.atan2(Math.cos(angle) * ry, -Math.sin(angle) * rx);
  const inwardAngle = Math.atan2(cy - y, cx - x);
  let launchAngle = options.mode === "tangent" ? tangentAngle : inwardAngle;

  if (options.mode === "blend") {
    launchAngle = blendAngles(tangentAngle, inwardAngle, options.centerBias ?? 0.5);
  }
  if (options.upwardBias) {
    launchAngle = blendAngles(launchAngle, -PI / 2, options.upwardBias);
  }
  if (options.downwardBias) {
    launchAngle = blendAngles(launchAngle, PI / 2, options.downwardBias);
  }
  launchAngle += options.angleOffset ?? 0;

  const nx = Math.cos(angle) / Math.max(rx, 1e-6);
  const ny = Math.sin(angle) / Math.max(ry, 1e-6);
  const leftNormal = [-Math.sin(launchAngle), Math.cos(launchAngle)];
  const preferredSign = leftNormal[0] * nx + leftNormal[1] * ny >= 0 ? 1 : -1;
  return makeGuidePoint(x, y, launchAngle, { preferredSign });
}

function createBaselineFanGuidePoints(x0, x1, y, count, options = {}) {
  if (count <= 0) {
    return [];
  }

  const fractions = options.fractions ?? Array.from({ length: count }, (_, i) => (i + 0.5) / count);
  const maxFan = options.maxFan ?? 0.42;
  const direction = options.direction ?? -PI / 2;

  return fractions.slice(0, count).map((fraction) => {
    const edgeBias = 0.4 + Math.abs(fraction - 0.5) * 1.2;
    const fan = lerp(maxFan, -maxFan, fraction) * edgeBias;
    const yOffset = options.yOffsetAtFraction?.(fraction) ?? 0;
    return makeGuidePoint(lerp(x0, x1, fraction), y + yOffset, direction + fan);
  });
}

function createRailGuidePoints(x, y0, y1, count, options = {}) {
  if (count <= 0) {
    return [];
  }

  const fractions = options.fractions ?? Array.from({ length: count }, (_, i) => (i + 0.5) / count);
  const angleTop = options.angleTop ?? -0.3;
  const angleBottom = options.angleBottom ?? -1.05;
  const mirrorX = options.mirrorX ?? false;

  return fractions.slice(0, count).map((fraction) => {
    const baseAngle = lerp(angleTop, angleBottom, fraction);
    return makeGuidePoint(x, lerp(y0, y1, fraction), mirrorX ? mirrorAngleX(baseAngle) : baseAngle);
  });
}

function voidBoundaryPointAt(progress) {
  if (!params.voidOn) {
    return null;
  }

  const currentVoid = stageVoid();
  const t = ((progress % 1) + 1) % 1;

  if (currentVoid.shape === "rectOvalIntersect") {
    if (currentVoid.invertRectOval) {
      const rectBoundary = buildRectBoundarySamples(currentVoid, 160);
      const ovalBoundary = buildOvalBoundarySamples(currentVoid, 160, true);
      const boundary = [...rectBoundary, ...ovalBoundary];
      if (!boundary.length) {
        return null;
      }
      return boundary[Math.floor(t * boundary.length) % boundary.length];
    }
    const boundary = buildRectOvalIntersectionBoundary(currentVoid, 240);
    if (!boundary.length) {
      return null;
    }
    return boundary[Math.floor(t * boundary.length) % boundary.length];
  }

  if (currentVoid.shape === "rect") {
    const perimeter = currentVoid.width * 2 + currentVoid.height * 2;
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

    return {
      x,
      y,
      tangentAngle: Math.atan2(ty, tx),
      outwardNormal: [nx, ny],
      centerAngle: Math.atan2(currentVoid.cy - y, currentVoid.cx - x),
    };
  }

  const angle = TAU * t;
  const x = currentVoid.cx + Math.cos(angle) * currentVoid.rx;
  const y = currentVoid.cy + Math.sin(angle) * currentVoid.ry;
  const tx = -Math.sin(angle) * currentVoid.rx;
  const ty = Math.cos(angle) * currentVoid.ry;
  const nx = Math.cos(angle) / Math.max(currentVoid.rx, 1e-6);
  const ny = Math.sin(angle) / Math.max(currentVoid.ry, 1e-6);
  return {
    x,
    y,
    tangentAngle: Math.atan2(ty, tx),
    outwardNormal: [nx, ny],
    centerAngle: Math.atan2(currentVoid.cy - y, currentVoid.cx - x),
  };
}

function createVoidFrameGuidePoint(progress, role = "spine", options = {}) {
  const boundary = voidBoundaryPointAt(progress);
  if (!boundary) {
    return null;
  }

  const { x, y, tangentAngle, outwardNormal, centerAngle } = boundary;
  const bounds = options.bounds ?? sourceBounds();
  if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) {
    return null;
  }

  let launchAngle = chooseBoundaryTangentDirection(x, y, tangentAngle, role);
  if (options.centerBias) {
    launchAngle = blendAngles(launchAngle, centerAngle, options.centerBias);
  }
  if (options.upwardBias) {
    launchAngle = blendAngles(launchAngle, -PI / 2, options.upwardBias);
  }
  if (options.downwardBias) {
    launchAngle = blendAngles(launchAngle, PI / 2, options.downwardBias);
  }
  launchAngle += options.angleOffset ?? 0;

  const leftNormal = [-Math.sin(launchAngle), Math.cos(launchAngle)];
  const preferredSign = leftNormal[0] * outwardNormal[0] + leftNormal[1] * outwardNormal[1] >= 0 ? 1 : -1;
  return makeGuidePoint(x, y, launchAngle, { preferredSign });
}

function chooseBoundaryTangentDirection(x, y, tangentAngle, role = "spine") {
  const flowAngle = flowAngleAt(x, y, role);
  const opposite = tangentAngle + PI;
  return Math.abs(angleBetween(tangentAngle, flowAngle)) <= Math.abs(angleBetween(opposite, flowAngle))
    ? tangentAngle
    : opposite;
}

function contourGuideMetadata(x, y, launchAngle, outwardNormal, role) {
  const grammar = getActiveGrammar();
  const outwardAngle = Math.atan2(outwardNormal[1], outwardNormal[0]);
  const tangentLaunch = chooseBoundaryTangentDirection(x, y, launchAngle, role);
  const exactTangentLaunch =
    appState.motifPreset === "voidContour" && role !== "floating";
  if (exactTangentLaunch) {
    const leftNormal = [-Math.sin(tangentLaunch), Math.cos(tangentLaunch)];
    const preferredSign =
      leftNormal[0] * outwardNormal[0] + leftNormal[1] * outwardNormal[1] >= 0 ? 1 : -1;
    return {
      launchAngle: tangentLaunch,
      preferredSign,
      contourBias: 1,
      contourScale: grammar.contourScaleBoost ?? 1,
    };
  }
  const peeledLaunch = blendAngles(
    tangentLaunch,
    outwardAngle,
    role === "floating" ? grammar.contourOutwardBias * 0.6 : grammar.contourOutwardBias
  );
  const finalLaunch = blendAngles(tangentLaunch, peeledLaunch, grammar.contourTangentBlend);
  const leftNormal = [-Math.sin(finalLaunch), Math.cos(finalLaunch)];
  const preferredSign =
    leftNormal[0] * outwardNormal[0] + leftNormal[1] * outwardNormal[1] >= 0 ? 1 : -1;
  const peelAmount = Math.abs(angleBetween(finalLaunch, tangentLaunch)) / (PI * 0.5);
  const contourBias = Math.max(0, 1 - peelAmount);
  return {
    launchAngle: finalLaunch,
    preferredSign,
    contourBias,
    contourScale:
      1 + contourBias * ((grammar.contourScaleBoost ?? 1) - 1) * (role === "floating" ? 0.6 : 1),
  };
}

function createVoidBoundaryGuidePoints(count, role = "spine", options = {}) {
  if (!params.voidOn || count <= 0) {
    return [];
  }

  const currentVoid = stageVoid();
  const bounds = options.bounds ?? sourceBounds();
  const points = [];

  if (currentVoid.shape === "rectOvalIntersect") {
    const boundary = (currentVoid.invertRectOval
      ? [...buildRectBoundarySamples(currentVoid, 160), ...buildOvalBoundarySamples(currentVoid, 160, true)]
      : buildRectOvalIntersectionBoundary(currentVoid, 240)
    ).filter(({ x, y }) => x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax);
    if (!boundary.length) {
      return [];
    }

    for (let i = 0; i < count; i++) {
      const index = Math.floor(((i + 0.5) / count) * boundary.length) % boundary.length;
      const sample = boundary[index];
      const { x, y, tangentAngle, outwardNormal } = sample;
      const contour = contourGuideMetadata(x, y, tangentAngle, outwardNormal, role);
      points.push({ x, y, ...contour, lockToGuide: true });
    }
    return points;
  }

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
      const contour = contourGuideMetadata(x, y, tangentAngle, [nx, ny], role);
      points.push({ x, y, ...contour, lockToGuide: true });
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
    const contour = contourGuideMetadata(x, y, tangentAngle, [nx, ny], role);
    points.push({ x, y, ...contour, lockToGuide: true });
  }

  return points;
}

function scoreGuidePointOpenSpace(grid, point, role = "spine") {
  const maxDistance =
    role === "floating" ? Math.max(su(120), params.spacing * 3.2) : Math.max(su(180), params.spacing * 4.8);
  const step = Math.max(10, params.clearance * 0.9);
  const forward = probeClearanceAlongRay(grid, point.x, point.y, point.launchAngle, maxDistance, step, step);
  const sideA = probeClearanceAlongRay(
    grid,
    point.x,
    point.y,
    point.launchAngle + 0.38,
    maxDistance * 0.7,
    step,
    step
  );
  const sideB = probeClearanceAlongRay(
    grid,
    point.x,
    point.y,
    point.launchAngle - 0.38,
    maxDistance * 0.7,
    step,
    step
  );
  const upwardBias = Math.max(0, -Math.sin(point.launchAngle)) * maxDistance * 0.08;
  return forward * 1.35 + Math.min(sideA, sideB) * 0.65 + upwardBias;
}

function selectVoidContourGuidePoints(grid, count, role = "spine", options = {}) {
  if (count <= 0) {
    return [];
  }

  const candidateCount = Math.max(count * 6, 24);
  const candidates = createVoidBoundaryGuidePoints(candidateCount, role, options)
    .map((point) => ({
      ...point,
      score: scoreGuidePointOpenSpace(grid, point, role),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const minGap = role === "floating" ? su(28) : su(42);

  for (const candidate of candidates) {
    if (selected.length >= count) {
      break;
    }
    if (selected.some((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < minGap)) {
      continue;
    }
    selected.push(candidate);
  }

  if (selected.length < count) {
    for (const candidate of candidates) {
      if (selected.length >= count) {
        break;
      }
      if (!selected.includes(candidate)) {
        selected.push(candidate);
      }
    }
  }

  return selected.slice(0, count).map(({ score, ...point }) => point);
}

function queuePointsAsSpines(grid, points, tier, queue, placement = {}) {
  for (const point of points) {
    const pointRole = roleForTier(tier.role, point);
    pushIfChain(
      queue,
      buildSpine(grid, 0, 1, {
        ...tier,
        role: pointRole,
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
    const pointRole = roleForTier(tier.role, point);
    pushIfChain(
      queue,
      buildFloating(grid, {
        ...tier,
        role: pointRole,
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

  const heroPoints = [
    makeGuidePoint(
      lerp(bounds.xMin, bounds.xMax, 0.18),
      lerp(bounds.yMin, bounds.yMax, 0.82),
      -0.98,
      { role: "hero" }
    ),
    makeGuidePoint(
      lerp(bounds.xMin, bounds.xMax, 0.34),
      lerp(bounds.yMin, bounds.yMax, 0.58),
      -1.14,
      { role: "hero" }
    ),
  ];
  queuePointsAsSpines(grid, heroPoints.slice(0, Math.min(params.largeSpines, heroPoints.length)), tiers.large, queue, {
    spreadX: su(10),
    spreadY: su(12),
    bounds,
  });

  const remainingLarge = Math.max(0, params.largeSpines - heroPoints.length);
  if (remainingLarge > 0) {
    buildDistributedSpines(grid, remainingLarge, tiers.large, queue, {
      bounds: {
        ...largeBounds,
        xMin: lerp(bounds.xMin, bounds.xMax, 0.12),
        xMax: lerp(bounds.xMin, bounds.xMax, 0.68),
      },
      rowBias: aspect < 0.85 ? 1.9 : 1.2,
      spreadX: su(14),
      spreadY: su(18),
    });
  }

  buildDistributedSpines(grid, params.mediumSpines, tiers.medium, queue, {
    bounds: mediumBounds,
    rowBias: aspect < 0.85 ? 2.1 : 1.35,
    spreadX: su(18),
    spreadY: su(24),
  });
  buildDistributedFloating(grid, params.smallSpines, tiers.small, queue, {
    bounds: floatingBounds,
    rowBias: aspect < 0.85 ? 2.3 : 1.45,
    spreadX: su(16),
    spreadY: su(18),
  });
}

function seedBottomBaselineMotif(grid, queue, tiers, bounds) {
  const baselineY = bounds.yMax - su(18);
  const largePoints = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, baselineY, params.largeSpines, {
    fractions: [0.16, 0.34, 0.52, 0.72, 0.86, 0.94],
    maxFan: 0.46,
    yOffsetAtFraction: (fraction) => -Math.sin(fraction * PI) * su(6),
  });
  const mediumPoints = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, baselineY - su(12), params.mediumSpines, {
    fractions: [0.12, 0.28, 0.46, 0.64, 0.82, 0.94],
    maxFan: 0.34,
    yOffsetAtFraction: (fraction) => -Math.sin(fraction * PI) * su(4),
  });
  const floatingPoints = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, baselineY - su(24), params.smallSpines, {
    fractions: [0.18, 0.42, 0.66, 0.88],
    maxFan: 0.26,
  });
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: su(12), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: su(14), spreadY: su(12), bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: su(10), spreadY: su(10), bounds });
}

function seedCenterAxisMotif(grid, queue, tiers, bounds) {
  const axisX = (bounds.xMin + bounds.xMax) * 0.5;
  const largePoints = [
    makeGuidePoint(axisX - su(8), lerp(bounds.yMin, bounds.yMax, 0.82), -1.08, { role: "hero" }),
    makeGuidePoint(axisX + su(10), lerp(bounds.yMin, bounds.yMax, 0.56), -1.42, { role: "hero" }),
    makeGuidePoint(axisX - su(14), lerp(bounds.yMin, bounds.yMax, 0.32), -1.02, { role: "support" }),
  ].slice(0, params.largeSpines);
  const mediumPoints = [
    makeGuidePoint(axisX - su(18), lerp(bounds.yMin, bounds.yMax, 0.7), -0.92),
    makeGuidePoint(axisX + su(18), lerp(bounds.yMin, bounds.yMax, 0.64), -1.2),
    makeGuidePoint(axisX - su(24), lerp(bounds.yMin, bounds.yMax, 0.46), -1.02),
    makeGuidePoint(axisX + su(26), lerp(bounds.yMin, bounds.yMax, 0.38), -1.24),
  ].slice(0, params.mediumSpines);
  const floatingPoints = [
    makeGuidePoint(axisX - su(26), lerp(bounds.yMin, bounds.yMax, 0.76), -0.86),
    makeGuidePoint(axisX + su(26), lerp(bounds.yMin, bounds.yMax, 0.58), -1.18),
    makeGuidePoint(axisX - su(32), lerp(bounds.yMin, bounds.yMax, 0.44), -0.94),
    makeGuidePoint(axisX + su(32), lerp(bounds.yMin, bounds.yMax, 0.3), -1.12),
  ].slice(0, params.smallSpines);
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: su(8), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: su(10), spreadY: su(10), bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: su(10), spreadY: su(10), bounds });
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
  const leftLarge = createRailGuidePoints(leftX, y0, y1, lLarge, {
    fractions: [0.24, 0.5, 0.76, 0.9],
    angleTop: -0.28,
    angleBottom: -1.08,
  });
  const rightLarge = createRailGuidePoints(rightX, y0, y1, rLarge, {
    fractions: [0.18, 0.46, 0.7, 0.88],
    angleTop: -0.28,
    angleBottom: -1.08,
    mirrorX: true,
  });
  const leftMedium = createRailGuidePoints(leftX, y0, y1, lMedium, {
    fractions: [0.14, 0.34, 0.58, 0.82, 0.94],
    angleTop: -0.16,
    angleBottom: -0.94,
  });
  const rightMedium = createRailGuidePoints(rightX, y0, y1, rMedium, {
    fractions: [0.22, 0.42, 0.64, 0.84, 0.96],
    angleTop: -0.16,
    angleBottom: -0.94,
    mirrorX: true,
  });
  const leftSmall = createRailGuidePoints(leftX, y0, y1, lSmall, {
    fractions: [0.2, 0.44, 0.68, 0.9],
    angleTop: -0.06,
    angleBottom: -0.86,
  });
  const rightSmall = createRailGuidePoints(rightX, y0, y1, rSmall, {
    fractions: [0.26, 0.48, 0.72, 0.92],
    angleTop: -0.06,
    angleBottom: -0.86,
    mirrorX: true,
  });
  queuePointsAsSpines(grid, leftLarge.concat(rightLarge), tiers.large, queue, { spreadX: su(12), spreadY: su(14), bounds });
  queuePointsAsSpines(grid, leftMedium.concat(rightMedium), tiers.medium, queue, { spreadX: su(12), spreadY: su(14), bounds });
  queuePointsAsFloating(grid, leftSmall.concat(rightSmall), tiers.small, queue, { spreadX: su(10), spreadY: su(12), bounds });
}

function seedMedallionMotif(grid, queue, tiers, bounds) {
  const cx = (bounds.xMin + bounds.xMax) * 0.5;
  const cy = (bounds.yMin + bounds.yMax) * 0.54;
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  const largePoints = [
    createEllipseGuidePoint(cx, cy, width * 0.34, height * 0.24, PI * 0.62, {
      mode: "blend",
      centerBias: 0.42,
      upwardBias: 0.22,
      angleOffset: -0.08,
    }),
    createEllipseGuidePoint(cx, cy, width * 0.34, height * 0.24, PI * 0.82, {
      mode: "blend",
      centerBias: 0.58,
      upwardBias: 0.08,
      angleOffset: -0.1,
    }),
    createEllipseGuidePoint(cx, cy, width * 0.34, height * 0.24, PI * 0.46, {
      mode: "blend",
      centerBias: 0.36,
      upwardBias: 0.3,
      angleOffset: 0.06,
    }),
  ].slice(0, params.largeSpines);
  const mediumAngles = [0.56, 0.7, 0.9, 1.02];
  const mediumPoints = mediumAngles.slice(0, params.mediumSpines).map((multiplier) =>
    createEllipseGuidePoint(cx, cy, width * 0.4, height * 0.3, PI * multiplier, {
      mode: "blend",
      centerBias: 0.52,
      upwardBias: 0.12,
      angleOffset: multiplier > 0.9 ? -0.12 : -0.04,
    })
  );
  const floatingAngles = [0.52, 0.66, 0.84, 1.06];
  const floatingPoints = floatingAngles.slice(0, params.smallSpines).map((multiplier) =>
    createEllipseGuidePoint(cx, cy, width * 0.46, height * 0.36, PI * multiplier, {
      mode: "blend",
      centerBias: 0.38,
      upwardBias: 0.1,
    })
  );
  queuePointsAsSpines(grid, largePoints, tiers.large, queue, { spreadX: su(10), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumPoints, tiers.medium, queue, { spreadX: su(12), spreadY: su(12), bounds });
  queuePointsAsFloating(grid, floatingPoints, tiers.small, queue, { spreadX: su(12), spreadY: su(12), bounds });
}

function seedBorderFrameMotif(grid, queue, tiers, bounds) {
  const topY = bounds.yMin + su(10);
  const bottomY = bounds.yMax - su(10);
  const leftX = bounds.xMin + su(10);
  const rightX = bounds.xMax - su(10);
  const largeBottom = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, bottomY, Math.ceil(params.largeSpines * 0.6), {
    fractions: [0.16, 0.4, 0.68, 0.9],
    maxFan: 0.42,
  });
  const largeTop = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, topY, Math.floor(params.largeSpines * 0.4), {
    fractions: [0.24, 0.56, 0.84],
    maxFan: 0.3,
    direction: PI / 2,
  });
  const mediumLeft = createRailGuidePoints(leftX, bounds.yMin, bounds.yMax, Math.ceil(params.mediumSpines / 2), {
    fractions: [0.2, 0.44, 0.68, 0.88],
    angleTop: -0.1,
    angleBottom: -0.92,
  });
  const mediumRight = createRailGuidePoints(rightX, bounds.yMin, bounds.yMax, Math.floor(params.mediumSpines / 2), {
    fractions: [0.24, 0.48, 0.72, 0.9],
    angleTop: -0.1,
    angleBottom: -0.92,
    mirrorX: true,
  });
  const floatingTop = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, topY + su(14), Math.ceil(params.smallSpines / 2), {
    fractions: [0.3, 0.62, 0.9],
    maxFan: 0.24,
    direction: PI / 2,
  });
  const floatingBottom = createBaselineFanGuidePoints(bounds.xMin, bounds.xMax, bottomY - su(14), Math.floor(params.smallSpines / 2), {
    fractions: [0.18, 0.48, 0.8],
    maxFan: 0.24,
  });
  queuePointsAsSpines(grid, largeBottom.concat(largeTop), tiers.large, queue, { spreadX: su(12), spreadY: su(10), bounds });
  queuePointsAsSpines(grid, mediumLeft.concat(mediumRight), tiers.medium, queue, { spreadX: su(10), spreadY: su(10), bounds });
  queuePointsAsFloating(grid, floatingTop.concat(floatingBottom), tiers.small, queue, { spreadX: su(10), spreadY: su(10), bounds });
}

function seedVoidContourMotif(grid, queue, tiers, bounds) {
  const largePoints = selectVoidContourGuidePoints(grid, params.largeSpines, "spine", { bounds }).map((point, index) => ({
    ...point,
    role: index < Math.max(1, Math.ceil(params.largeSpines * 0.4)) ? "hero" : "support",
  }));
  const mediumPoints = selectVoidContourGuidePoints(grid, params.mediumSpines, "spine", { bounds }).map((point) => ({
    ...point,
    role: "support",
  }));
  const floatingPoints = selectVoidContourGuidePoints(grid, params.smallSpines, "floating", { bounds }).map((point) => ({
    ...point,
    role: "filler",
  }));
  const largeTier = { ...tiers.large, rootScale: (tiers.large.rootScale ?? 1) * 0.84, bodyChance: 0.6 };
  const mediumTier = { ...tiers.medium, rootScale: (tiers.medium.rootScale ?? 1) * 0.88, bodyChance: 0.5 };
  const floatingTier = { ...tiers.small, scaleMin: 0.22, scaleMax: 0.4, wantsOffshoot: false };
  queuePointsAsSpines(grid, largePoints, largeTier, queue, { spreadX: 0, spreadY: 0, bounds });
  queuePointsAsSpines(grid, mediumPoints, mediumTier, queue, { spreadX: su(4), spreadY: su(6), bounds });
  queuePointsAsFloating(grid, floatingPoints, floatingTier, queue, { spreadX: su(6), spreadY: su(8), bounds });
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
  const parentId = tier.parentId ?? null;
  const role = tier.role ?? "support";
  const target = stemGestureTarget(0, 0, tier, { bounds: sourceBounds() });
  let bestCandidate = null;
  let bestScore = -Infinity;

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
    const contourScale = preferredPoint?.contourScale ?? 1;
    const bendSign = chooseGestureBendSign(px, py, launchAngle, tier, {
      preferredSign: preferredPoint?.preferredSign,
      flowAngle: launchAngle,
      bounds: sourceBounds(),
    });
    const candidate = buildGestureStemCandidate({
      px,
      py,
      launchAngle,
      startSign: bendSign,
      rootScale,
      role,
      contourScale,
      contourBias: preferredPoint?.contourBias ?? 0,
      isCorner: false,
    });
    const samples = sampleArcs(candidate.arcs, 3);
    if (!testChain(samples, grid, startClearanceSkip)) {
      continue;
    }
    const breathing = measureStemBreathing(samples, grid, {
      startT: 0.16,
      endT: 0.7,
      maxDistance: Math.max(su(role === "hero" ? 96 : 80), params.spacing * (role === "hero" ? 3.4 : 2.9)),
    });
    const contourBias = preferredPoint?.contourBias ?? 0;
    const minBreathing =
      role === "hero"
        ? Math.max(su(30), params.spacing * 0.92)
        : role === "support"
          ? Math.max(su(22), params.spacing * 0.72)
          : Math.max(su(16), params.spacing * 0.5);
    if (breathing.minSide < minBreathing * (1 - contourBias * 0.45)) {
      continue;
    }
    const targetAngle = Math.atan2(target.y - py, target.x - px);
    const score = scoreSpineCandidate(
      {
        arcs: candidate.arcs,
        launchAngle,
        curlRadius: candidate.closingRadius,
        hasReversal: candidate.hasReversal,
        transitionStartIndex: candidate.transitionStartIndex,
        targetAngle,
        breathing,
      },
      { role, contourBias }
    );
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "stroke",
        arcs: candidate.arcs,
        depth: 0,
        parentId,
        profile: "spine",
        role,
        zoneBias: role === "hero" ? -0.04 : role === "filler" ? 0.08 : 0,
        contourBias: preferredPoint?.contourBias ?? 0,
        debugMeta: makeDebugMeta(
          candidate.bodyEndIndex,
          candidate.transitionIndex,
          candidate.terminalStartIndex
        ),
        terminalLeaf: buildTerminalLeafFromSpiral(candidate.spiral.arcs, "spine"),
        wBase: STROKE_WEIGHT,
        spawnPoint: { x: px, y: py },
        launchAngle,
        rootScale,
      },
      samples,
      spawnPoint: { x: px, y: py },
    };
  }

  if (!bestCandidate) {
    return null;
  }

  const chain = bestCandidate.chain;
  acceptChain(chain, bestCandidate.samples, grid);
  if (
    sharedSpawnPoints &&
    !findNearbySpawnPoint(sharedSpawnPoints, bestCandidate.spawnPoint, sharedSpawnThreshold * 0.35)
  ) {
    sharedSpawnPoints.push(bestCandidate.spawnPoint);
  }
  return chain;
}

function buildCornerSpine(grid, side = "left", tier = {}) {
  const rootScale = tier.rootScale ?? 1.16;
  const role = tier.role ?? "hero";
  const m = margin();
  const startX =
    side === "left"
      ? m + (tier.edgeInset ?? su(12))
      : stageWidth() - m - (tier.edgeInset ?? su(12));
  const startY = tier.startY ?? (stageHeight() - m - su(28));
  const angBase = -PI / 2 + (side === "left" ? 0.08 : -0.08);
  const bendSign = side === "left" ? 1 : -1;
  let bestCandidate = null;
  let bestScore = -Infinity;

  for (let tries = 0; tries < 24; tries++) {
    const px = startX + rnd(-su(6), su(6));
    const py = startY + rnd(-su(18), su(18));
    const launchAngle = angBase + rnd(-0.06, 0.06);
    const candidate = buildGestureStemCandidate({
      px,
      py,
      launchAngle,
      startSign: bendSign,
      rootScale,
      role,
      contourScale: 1,
      contourBias: 0,
      isCorner: true,
    });
    const samples = sampleArcs(candidate.arcs, 3);
    if (!testChain(samples, grid, 0)) {
      continue;
    }
    const breathing = measureStemBreathing(samples, grid, {
      startT: 0.14,
      endT: 0.68,
      maxDistance: Math.max(su(84), params.spacing * 3.1),
    });
    if (breathing.minSide < Math.max(su(20), params.spacing * 0.68)) {
      continue;
    }
    const targetAngle = Math.atan2(stageHeight() * 0.16 - py, stageWidth() * 0.5 - px);
    const score = scoreSpineCandidate(
      {
        arcs: candidate.arcs,
        launchAngle,
        curlRadius: candidate.closingRadius,
        hasReversal: candidate.hasReversal,
        transitionStartIndex: candidate.transitionStartIndex,
        targetAngle,
        breathing,
      },
      { role, contourBias: 0 }
    );
    if (score <= bestScore) {
      continue;
    }
    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "stroke",
        arcs: candidate.arcs,
        depth: 0,
        parentId: null,
        profile: "spine",
        role,
        zoneBias: -0.06,
        contourBias: 0,
        debugMeta: makeDebugMeta(
          candidate.bodyEndIndex,
          candidate.transitionIndex,
          candidate.terminalStartIndex
        ),
        terminalLeaf: buildTerminalLeafFromSpiral(candidate.spiral.arcs, "spine"),
        wBase: STROKE_WEIGHT,
        launchAngle,
      },
      samples,
    };
  }

  if (!bestCandidate) {
    return null;
  }

  acceptChain(bestCandidate.chain, bestCandidate.samples, grid);
  return bestCandidate.chain;
}

function tangentialSkip(r1, sChild, pr, pdir) {
  const kRel = Math.abs(sChild / r1 - pdir / pr);
  if (kRel < (2 * params.clearance) / 3600) {
    return -1;
  }
  return Math.sqrt((2 * params.clearance) / kRel) * 1.1;
}

function buildChild(P, T, side, pr, pdir, depth, scale, grid, terminalBias = 0.5, parentId = null, role = "support") {
  let bestCandidate = null;
  let bestScore = -Infinity;
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
    const breathing = measureCandidateBreathing(samples, grid, {
      startT: 0.16,
      endT: 0.9,
      maxDistance: Math.max(su(36), params.spacing * 1.55),
    });
    const minBreathing =
      role === "support" ? Math.max(su(14), params.spacing * 0.42) : Math.max(su(10), params.spacing * 0.3);
    if (breathing.minSide < minBreathing) {
      continue;
    }
    const score =
      breathing.avgMinSide * 1.8 +
      breathing.avgClearance * 0.55 +
      breathing.balance * su(28) +
      samples[samples.length - 1].s * 0.08;
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "stroke",
        arcs,
        depth,
        parentId,
        profile: "branch",
        role,
        zoneBias: role === "filler" ? 0.1 : 0.02,
        contourBias: 0,
        debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
        terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
        wBase: STROKE_WEIGHT,
        wantsOffshoot: true,
      },
      samples,
    };
  }

  if (!bestCandidate) {
    return null;
  }
  acceptChain(bestCandidate.chain, bestCandidate.samples, grid);
  return bestCandidate.chain;
}

function buildLeaf(P, T, side, pr, pdir, depth, scale, grid, parentId = null, role = "terminal") {
  let bestCandidate = null;
  let bestScore = -Infinity;
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
    const breathing = measureCandidateBreathing(samples, grid, {
      startT: 0.08,
      endT: 0.96,
      maxDistance: Math.max(su(28), params.spacing * 1.3),
    });
    if (breathing.minSide < Math.max(su(8), params.spacing * 0.22)) {
      continue;
    }
    const score =
      breathing.avgMinSide * 1.7 +
      breathing.balance * su(18) +
      samples[samples.length - 1].s * 0.05;
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "leaf",
        stem: [arc],
        tear,
        depth,
        parentId,
        role,
        wBase: STROKE_WEIGHT,
      },
      samples,
    };
  }

  if (!bestCandidate) {
    return null;
  }
  acceptChain(bestCandidate.chain, bestCandidate.samples, grid);
  return bestCandidate.chain;
}

function buildAttachedInfill(P, T, side, pr, pdir, depth, scale, grid, terminalBias = 0.5, parentId = null) {
  let bestCandidate = null;
  let bestScore = -Infinity;
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
    const breathing = measureCandidateBreathing(samples, grid, {
      startT: 0.14,
      endT: 0.92,
      maxDistance: Math.max(su(26), params.spacing * 1.12),
    });
    if (breathing.minSide < Math.max(su(8), params.spacing * 0.18)) {
      continue;
    }
    const score =
      breathing.avgMinSide * 1.4 +
      breathing.avgClearance * 0.4 +
      breathing.balance * su(14);
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "stroke",
        arcs,
        depth,
        parentId,
        profile: "branch",
        role: "filler",
        zoneBias: 0.12,
        contourBias: 0,
        debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
        terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
        wBase: STROKE_WEIGHT,
        wantsOffshoot: false,
        mustHaveOffshoot: false,
        hasOffshoot: true,
      },
      samples,
    };
  }

  if (!bestCandidate) {
    return null;
  }
  acceptChain(bestCandidate.chain, bestCandidate.samples, grid);
  return bestCandidate.chain;
}

function enrichAttachedInfill(grid) {
  const grammar = getActiveGrammar();
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
    if (chain.role === "hero" && chance(0.45)) {
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
      if (!chance(0.32 * (grammar.pocketFillBias ?? 1))) {
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
        p.s / total,
        chain.chainId
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
  const parentId = tier.parentId ?? null;
  const role = tier.role ?? "filler";
  let bestCandidate = null;
  let bestScore = -Infinity;

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
    const contourScale = preferredPoint?.contourScale ?? 1;
    let arcs = [];
    let Pp = P.slice();
    let Tc = T.slice();
    let phase = appendArcPhase(arcs, Pp, Tc, side, [su(44) * scale * contourScale, su(104) * scale * contourScale], [0.9, 1.5]);
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
    const breathing = measureCandidateBreathing(samples, grid, {
      startT: 0.14,
      endT: 0.94,
      maxDistance: Math.max(su(38), params.spacing * 1.6),
    });
    const minBreathing =
      role === "filler" ? Math.max(su(12), params.spacing * 0.34) : Math.max(su(10), params.spacing * 0.28);
    if (breathing.minSide < minBreathing) {
      continue;
    }
    const score =
      breathing.avgMinSide * 1.9 +
      breathing.avgClearance * 0.5 +
      breathing.balance * su(22) +
      samples[samples.length - 1].s * 0.04;
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestCandidate = {
      chain: {
        kind: "stroke",
        arcs,
        depth: 1,
        parentId,
        profile: "branch",
        role,
        zoneBias: role === "filler" ? 0.14 : 0.06,
        contourBias: preferredPoint?.contourBias ?? 0,
        debugMeta: makeDebugMeta(bodyEndIndex, transitionIndex, terminalStartIndex),
        terminalLeaf: buildTerminalLeafFromSpiral(sp.arcs, "branch"),
        wBase: STROKE_WEIGHT,
        wantsOffshoot,
        mustHaveOffshoot: wantsOffshoot,
        hasOffshoot: !wantsOffshoot,
      },
      samples,
    };
  }

  if (!bestCandidate) {
    return null;
  }
  acceptChain(bestCandidate.chain, bestCandidate.samples, grid);
  return bestCandidate.chain;
}

function generate() {
  const motifHash = hashString(appState.motifPreset);
  const combinedSeed = ((appState.seed * 2654435761) ^ motifHash) >>> 0;
  R = mulberry32(combinedSeed || 1);
  model = { chains: [], stats: {}, nextChainId: 1 };
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
    role: "hero",
  };
  const mediumTier = {
    rootScale: 0.78,
    yMin: lerp(bounds.yMin, bounds.yMax, 0.14),
    yMax: lerp(bounds.yMin, bounds.yMax, 0.82),
    bodyChance: 0.58,
    weightScale: 0.9,
    role: "support",
  };
    const smallTier = {
    scaleMin: 0.42,
    scaleMax: 0.72,
    yMin: lerp(bounds.yMin, bounds.yMax, 0.06),
    yMax: lerp(bounds.yMin, bounds.yMax, 0.88),
    wantsOffshoot: true,
    weightScale: 0.72,
    role: "filler",
  };

  const allowCornerSpines =
    !isPlacedSpawnMotif() &&
    appState.motifPreset !== "voidContour";

  if (allowCornerSpines) {
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
        role: "support",
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

    const smallPocketSeeds = collectPocketSeeds(grid, 2, su(72), pockets);
    for (const seed of smallPocketSeeds) {
      const sp = buildFloating(grid, {
        ...smallTier,
        scaleMin: 0.34,
        scaleMax: 0.56,
        weightScale: 0.58,
        wantsOffshoot: true,
        role: "filler",
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
    const branchWindow = branchWindowForChain(chain);
    let next = branchWindow.spacing * rnd(0.72, 1.04) + total * Math.max(0.06, branchWindow.start * 0.34);

    for (const p of samples) {
      const terminalBias = p.s / total;
      const zone = sampleZoneAt(terminalBias, branchWindow);
      if (p.s < next || p.r < 12 || p.s > total * 0.96 || zone === "launch" || zone === "tail") {
        continue;
      }
      if (!chance(branchChanceForZone(zone, branchWindow, chain))) {
        continue;
      }
      next = p.s + branchWindow.spacing * rnd(zone === "body" ? 0.86 : 1.02, zone === "body" ? 1.18 : 1.34);
      const sideBias = chain.contourBias > 0.12 ? -p.dir : p.dir;
      const side = chance(zone === "terminal" ? 0.84 : 0.72) ? -p.dir : sideBias;
      const childScale = scale * params.falloff;
      const childRole = chooseChildRole(chain.role, zone, false);
      let child = null;

      if (zone === "terminal" || chance(params.leafProb * branchWindow.leafBias)) {
        child = buildLeaf(
          [p.x, p.y],
          [p.tx, p.ty],
          side,
          p.r,
          p.dir,
          d + 1,
          childScale,
          grid,
          chain.chainId,
          chooseChildRole(chain.role, zone, true)
        );
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
          terminalBias,
          chain.chainId,
          childRole
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

function samplePrefix(samples, targetLength) {
  if (!samples?.length) {
    return [];
  }
  if (targetLength <= 0) {
    return [samples[0]];
  }

  const totalLength = samples[samples.length - 1].s ?? 0;
  if (targetLength >= totalLength) {
    return samples;
  }

  const out = [];
  for (let i = 0; i < samples.length; i++) {
    const point = samples[i];
    if (point.s <= targetLength) {
      out.push(point);
      continue;
    }
    if (!out.length) {
      out.push(samples[0]);
    }
    const prev = samples[Math.max(0, i - 1)];
    const span = Math.max(1e-6, point.s - prev.s);
    const t = (targetLength - prev.s) / span;
    out.push({
      x: lerp(prev.x, point.x, t),
      y: lerp(prev.y, point.y, t),
      s: targetLength,
    });
    break;
  }
  return out;
}

function drawSamplePrefix(samples, targetLength, color, weight = 2.2) {
  const prefix = samplePrefix(samples, targetLength);
  if (prefix.length < 2) {
    return;
  }
  drawSamplePath(prefix, color, weight);
}

function orderChainsForGrowth(chains) {
  const byId = new Map();
  const childrenByParent = new Map();
  const ordered = [];
  const visited = new Set();
  const chainSizeScore = (chain) => {
    const arcLength =
      chain.kind === "stroke"
        ? chain.arcs.reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
        : chain.kind === "leaf"
          ? chain.stem.concat(chain.tear).reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
          : 0;
    return (chain.wBase ?? 0) * 10000 + arcLength;
  };
  const sortByHierarchy = (a, b) =>
    chainSizeScore(b) - chainSizeScore(a) || (a.createdIndex ?? 0) - (b.createdIndex ?? 0);

  for (const chain of chains) {
    byId.set(chain.chainId, chain);
  }

  for (const chain of chains) {
    const parentId = chain.parentId;
    if (!parentId || !byId.has(parentId)) {
      continue;
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(chain);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(sortByHierarchy);
  }

  const visit = (chain) => {
    if (!chain || visited.has(chain.chainId)) {
      return;
    }
    visited.add(chain.chainId);
    ordered.push(chain);
    for (const child of childrenByParent.get(chain.chainId) ?? []) {
      visit(child);
    }
  };

  const roots = chains
    .filter((chain) => !chain.parentId || !byId.has(chain.parentId))
    .sort(sortByHierarchy);

  for (const root of roots) {
    visit(root);
  }

  for (const chain of [...chains].sort(sortByHierarchy)) {
    visit(chain);
  }

  return ordered;
}

function revealSegmentsForChain(chain) {
  const color = appState.invertPreview ? "#161614" : "#e9e7df";
  const segments = [];

  if (chain.kind === "stroke") {
    segments.push({
      samples: sampleArcs(chain.arcs, 2.2),
      color,
      weight: Math.max(1.2, chain.wBase * 0.58),
    });
    if (chain.terminalLeaf?.outer?.length) {
      segments.push({
        samples: sampleArcs(chain.terminalLeaf.outer, 2),
        color,
        weight: Math.max(1, chain.wBase * 0.44),
      });
    }
    if (chain.terminalLeaf?.inner?.length) {
      segments.push({
        samples: sampleArcs(chain.terminalLeaf.inner, 2),
        color,
        weight: Math.max(1, chain.wBase * 0.36),
      });
    }
    return segments;
  }

  if (chain.kind === "leaf") {
    segments.push({
      samples: sampleArcs(chain.stem, 2.2),
      color,
      weight: Math.max(1.1, chain.wBase * 0.52),
    });
    segments.push({
      samples: sampleArcs(chain.tear, 2),
      color,
      weight: Math.max(1, chain.wBase * 0.38),
    });
    return segments;
  }

  if (chain.kind === "ornament") {
    for (const path of chain.paths) {
      segments.push({
        samples: sampleClosedPath(path, true),
        color,
        weight: Math.max(1, STROKE_WEIGHT * 0.42),
      });
    }
  }

  return segments;
}

function orderChainsForGrowth(chains) {
  const byId = new Map();
  const childrenByParent = new Map();
  const ordered = [];
  const visited = new Set();
  const chainSizeScore = (chain) => {
    const arcLength =
      chain.kind === "stroke"
        ? chain.arcs.reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
        : chain.kind === "leaf"
          ? chain.stem.concat(chain.tear).reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
          : 0;
    return (chain.wBase ?? 0) * 10000 + arcLength;
  };
  const sortByHierarchy = (a, b) =>
    chainSizeScore(b) - chainSizeScore(a) || (a.createdIndex ?? 0) - (b.createdIndex ?? 0);

  for (const chain of chains) {
    byId.set(chain.chainId, chain);
  }

  for (const chain of chains) {
    const parentId = chain.parentId;
    if (!parentId || !byId.has(parentId)) {
      continue;
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(chain);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(sortByHierarchy);
  }

  const visit = (chain) => {
    if (!chain || visited.has(chain.chainId)) {
      return;
    }
    visited.add(chain.chainId);
    ordered.push(chain);
    for (const child of childrenByParent.get(chain.chainId) ?? []) {
      visit(child);
    }
  };

  const roots = chains
    .filter((chain) => !chain.parentId || !byId.has(chain.parentId))
    .sort(sortByHierarchy);

  for (const root of roots) {
    visit(root);
  }

  for (const chain of [...chains].sort(sortByHierarchy)) {
    visit(chain);
  }

  return ordered;
}

function buildRevealSequence() {
  const segments = [];
  let totalLength = 0;
  const orderedChains = orderChainsForGrowth(
    model.chains.filter((chain) => !shouldSuppressUnresolvedCurl(chain))
  );

  for (let batchStart = 0; batchStart < orderedChains.length; batchStart += REVEAL_PARALLEL_CHAIN_BATCH) {
    const batch = orderedChains.slice(batchStart, batchStart + REVEAL_PARALLEL_CHAIN_BATCH);
    const batchSegments = batch.flatMap((chain) =>
      reflectedChains(chain).map((reflected) => revealSegmentsForChain(reflected))
    );
    const segmentGroups = batchSegments.reduce(
      (max, chainSegments) => Math.max(max, chainSegments.length),
      0
    );

    for (let segmentIndex = 0; segmentIndex < segmentGroups; segmentIndex++) {
      let groupMaxLength = 0;

      for (const chainSegments of batchSegments) {
        const segment = chainSegments[segmentIndex];
        if (!segment) {
          continue;
        }
        const length = segment.samples.length ? segment.samples[segment.samples.length - 1].s : 0;
        if (length <= 0) {
          continue;
        }
        groupMaxLength = Math.max(groupMaxLength, length);
        segments.push({ ...segment, start: totalLength, end: totalLength + length });
      }

      totalLength += groupMaxLength;
    }
  }

  return { segments, totalLength };
}

function setRevealButtonLabel(text) {
  const button = document.getElementById("revealBtn");
  if (button) {
    button.textContent = text;
  }
}

function stopRevealAnimation(redrawAfter = true) {
  if (revealState.rafId) {
    cancelAnimationFrame(revealState.rafId);
  }
  revealState.playing = false;
  revealState.startMs = 0;
  revealState.elapsedMs = 0;
  revealState.rafId = 0;
  setRevealButtonLabel("Play Reveal");
  if (redrawAfter) {
    redraw();
  }
}

function tickRevealAnimation() {
  if (!revealState.playing) {
    return;
  }
  redraw();
  revealState.rafId = requestAnimationFrame(tickRevealAnimation);
}

function startRevealAnimation() {
  const sequence = buildRevealSequence();
  if (!sequence.totalLength) {
    return;
  }
  revealState = {
    playing: true,
    startMs: millis(),
    elapsedMs: 0,
    totalLength: sequence.totalLength,
    segments: sequence.segments,
    rafId: 0,
  };
  setRevealButtonLabel("Stop Reveal");
  redraw();
  revealState.rafId = requestAnimationFrame(tickRevealAnimation);
}

function toggleRevealAnimation() {
  if (revealState.playing) {
    stopRevealAnimation(true);
    return;
  }
  startRevealAnimation();
}

function drawRevealAnimation() {
  if (!revealState.playing) {
    return;
  }

  revealState.elapsedMs = Math.max(0, millis() - revealState.startMs);
  const progressLength = (revealState.elapsedMs / 1000) * REVEAL_SPEED_PX_PER_SEC;

  for (const segment of revealState.segments) {
    if (progressLength <= segment.start) {
      break;
    }
    const localLength = Math.min(segment.end, progressLength) - segment.start;
    drawSamplePrefix(segment.samples, localLength, segment.color, segment.weight);
  }

  if (progressLength >= revealState.totalLength) {
    stopRevealAnimation(true);
  }
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
  const roleColor = roleDebugColor(ch.role);
  if (ch.kind === "leaf") {
    drawArcPath(ch.stem, roleColor, 2.4);
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
    drawArcPath(ch.arcs, roleColor, 2.4);
    return;
  }

  drawArcPath(ch.arcs.slice(0, meta.bodyEndIndex + 1), roleColor, 2.4);
  drawArcPath(ch.arcs.slice(meta.bodyEndIndex + 1, meta.transitionIndex + 1), "#ffb85e", 2.8);
  drawArcPath(ch.arcs.slice(meta.terminalStartIndex), "#7dff7a", 2.6);
  if (ch.terminalLeaf?.inner?.length) {
    drawArcPath(ch.terminalLeaf.inner, "#ff5ef1", 2.2);
  }
  if (ch.spawnPoint) {
    push();
    noStroke();
    fill(roleColor);
    circle(ch.spawnPoint.x, ch.spawnPoint.y, Math.max(5, su(8)));
    pop();
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
    onReveal: toggleRevealAnimation,
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

  if (revealState.playing) {
    drawRevealAnimation();
  } else {
    for (const ch of model.chains) {
      if (shouldSuppressUnresolvedCurl(ch)) {
        continue;
      }
      for (const reflected of reflectedChains(ch)) {
        drawChain(reflected);
      }
    }
  }

  drawVoidMask();
  drawVoidOutline();
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
  if (revealState.playing) {
    stopRevealAnimation(false);
  }
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
  if (revealState.playing) {
    stopRevealAnimation(false);
  }
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
