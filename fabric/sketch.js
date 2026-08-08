const DEFAULTS = {
  canvasWMM: 210,
  canvasHMM: 210,
  paperPreset: "Custom",
  dpi: 144,
  previewScale: 1,
  fitToViewport: true,
  marginXMM: 18,
  marginYMM: 18,
  bg: "#ffffff",
  showBounds: false,

  cols: 90,
  rows: 90,
  inset: 6,

  skipProb: 0.01,
  maxSegmentLen: 26,
  seed: 1,

  noiseSeedVal: 1337,
  noiseIntensity: 0.9,
  noiseAmp: 15,
  noiseFreq: 18,
  ampX: 1,
  ampY: 1,
  freqX: 1,
  freqY: 1,
  octaves: 3,
  falloff: 0.6,

  warpOn: true,
  warpAmp: 3,
  warpFreq: 54,

  vertDisplace: 1,
  horizDisplace: 1,

  vertStrokeW: 0.35,
  horizStrokeW: 0.35,

  pattern: "Custom (Solid)",
  patternScale: 10,
  patternLineWidth: 1,
  patternSeed: 7,
  cA: "#f44336",
  cB: "#3f51b5",
  cC: "#111111",
  cD: "#ffffff",

  previewCurves: true,

  outerOn: true,
  outerInfluence: 1,
  outerAmp: 10,
  outerFreq: 24,
  outerAmpX: 1,
  outerAmpY: 1,
  outerFreqX: 1,
  outerFreqY: 1,
  outerWarpOn: true,
  outerWarpAmp: 5,
  outerWarpFreq: 64,
  outerSeed: 4242,
  outerOffsetRand: 1,

  svgFilename: "fabric.svg",
};

const P = structuredClone(DEFAULTS);

let pane;
let canvas;
let ctx;
let redrawTimer = null;
let model = emptyModel();
let meshOffsets = { x: 0, y: 0 };
let outerOffsets = { x: 0, y: 0 };
let meshShuffleNonce = 0;
let outerShuffleNonce = 0;

function emptyModel() {
  return {
    vertical: [],
    horizontal: [],
    stats: {
      segmentCount: 0,
      pointCount: 0,
      renderMs: 0,
    },
  };
}

window.addEventListener("load", setup);
window.addEventListener("resize", () => {
  updateCanvasDisplaySize();
});

function setup() {
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  PaperUtils.applyPaperPreset(P, P.paperPreset);
  randomizeMeshOffsets();
  randomizeOuterOffsets();

  buildPane();
  hookButtons();
  syncCanvasSize();
  rebuildModel();
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "fabric",
  });

  const paperFolder = pane.addFolder({ title: "Canvas (mm)" });
  paperFolder
    .addInput(P, "paperPreset", {
      options: Object.keys(PaperUtils.PAPER_PRESETS_MM).reduce((acc, key) => {
        acc[key] = key;
        return acc;
      }, {}),
      label: "Paper",
    })
    .on("change", (ev) => {
      PaperUtils.applyPaperPreset(P, ev.value);
      pane.refresh();
      syncCanvasSize();
      scheduleRebuild();
    });
  paperFolder
    .addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      scheduleRebuild();
    });
  paperFolder
    .addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      scheduleRebuild();
    });
  paperFolder.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" }).on("change", () => {
    syncCanvasSize();
    drawScene();
  });
  paperFolder
    .addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" })
    .on("change", updateCanvasDisplaySize);
  paperFolder.addInput(P, "fitToViewport", { label: "Fit View" }).on("change", updateCanvasDisplaySize);
  paperFolder
    .addInput(P, "marginXMM", { min: 0, max: 100, step: 0.25, label: "Margin X" })
    .on("change", scheduleRebuild);
  paperFolder
    .addInput(P, "marginYMM", { min: 0, max: 100, step: 0.25, label: "Margin Y" })
    .on("change", scheduleRebuild);
  paperFolder.addInput(P, "bg", { label: "BG" }).on("change", drawScene);
  paperFolder.addInput(P, "showBounds", { label: "Bounds" }).on("change", drawScene);

  const gridFolder = pane.addFolder({ title: "Grid" });
  gridFolder.addInput(P, "cols", { min: 10, max: 280, step: 1 }).on("change", scheduleRebuild);
  gridFolder.addInput(P, "rows", { min: 10, max: 280, step: 1 }).on("change", scheduleRebuild);
  gridFolder.addInput(P, "inset", { min: 0, max: 80, step: 1 }).on("change", scheduleRebuild);

  const wearFolder = pane.addFolder({ title: "Wear" });
  wearFolder.addInput(P, "skipProb", { min: 0, max: 0.3, step: 0.01 }).on("change", scheduleRebuild);
  wearFolder.addInput(P, "maxSegmentLen", { min: 2, max: 80, step: 1 }).on("change", scheduleRebuild);
  wearFolder.addInput(P, "seed", { min: 0, max: 999999, step: 1 }).on("change", scheduleRebuild);

  const noiseFolder = pane.addFolder({ title: "Mesh Noise" });
  noiseFolder.addInput(P, "noiseSeedVal", { min: 0, max: 999999, step: 1 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "noiseIntensity", { min: 0, max: 1, step: 0.01 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "noiseAmp", { min: 0, max: 80, step: 0.25 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "noiseFreq", { min: 2, max: 120, step: 0.25 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "ampX", { min: 0, max: 3, step: 0.01 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "ampY", { min: 0, max: 3, step: 0.01 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "freqX", { min: 0.25, max: 4, step: 0.01 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "freqY", { min: 0.25, max: 4, step: 0.01 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "octaves", { min: 1, max: 8, step: 1 }).on("change", scheduleRebuild);
  noiseFolder.addInput(P, "falloff", { min: 0.1, max: 0.95, step: 0.01 }).on("change", scheduleRebuild);

  const warpFolder = pane.addFolder({ title: "Mesh Warp" });
  warpFolder.addInput(P, "warpOn").on("change", scheduleRebuild);
  warpFolder.addInput(P, "warpAmp", { min: 0, max: 40, step: 0.25 }).on("change", scheduleRebuild);
  warpFolder.addInput(P, "warpFreq", { min: 4, max: 200, step: 0.25 }).on("change", scheduleRebuild);

  const directionFolder = pane.addFolder({ title: "Direction Weights" });
  directionFolder.addInput(P, "vertDisplace", { min: 0, max: 2, step: 0.01 }).on("change", scheduleRebuild);
  directionFolder.addInput(P, "horizDisplace", { min: 0, max: 2, step: 0.01 }).on("change", scheduleRebuild);

  const patternFolder = pane.addFolder({ title: "Pattern" });
  patternFolder
    .addInput(P, "pattern", {
      options: {
        "Custom (Solid)": "Custom (Solid)",
        Chequered: "Chequered",
        Gingham: "Gingham",
        "Tartan / Plaid": "Tartan / Plaid",
        "Houndstooth (Approx)": "Houndstooth (Approx)",
        "Buffalo Check": "Buffalo Check",
        Windowpane: "Windowpane",
        Tattersall: "Tattersall",
        Madras: "Madras",
      },
    })
    .on("change", scheduleRebuild);
  patternFolder.addInput(P, "patternScale", { min: 2, max: 40, step: 1 }).on("change", scheduleRebuild);
  patternFolder.addInput(P, "patternLineWidth", { min: 1, max: 8, step: 1 }).on("change", scheduleRebuild);
  patternFolder.addInput(P, "patternSeed", { min: 0, max: 999999, step: 1 }).on("change", scheduleRebuild);
  const paletteFolder = patternFolder.addFolder({ title: "Palette" });
  paletteFolder.addInput(P, "cA").on("change", scheduleRebuild);
  paletteFolder.addInput(P, "cB").on("change", scheduleRebuild);
  paletteFolder.addInput(P, "cC").on("change", scheduleRebuild);
  paletteFolder.addInput(P, "cD").on("change", scheduleRebuild);

  const styleFolder = pane.addFolder({ title: "Style" });
  styleFolder.addInput(P, "vertStrokeW", { min: 0.05, max: 3, step: 0.01 }).on("change", drawScene);
  styleFolder.addInput(P, "horizStrokeW", { min: 0.05, max: 3, step: 0.01 }).on("change", drawScene);
  styleFolder.addInput(P, "previewCurves").on("change", drawScene);

  const outerFolder = pane.addFolder({ title: "Outer Band Distortion" });
  outerFolder.addInput(P, "outerOn").on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerInfluence", { min: 0, max: 2, step: 0.01 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerAmp", { min: 0, max: 80, step: 0.25 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerFreq", { min: 2, max: 120, step: 0.25 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerAmpX", { min: 0, max: 3, step: 0.01 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerAmpY", { min: 0, max: 3, step: 0.01 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerFreqX", { min: 0.25, max: 4, step: 0.01 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerFreqY", { min: 0.25, max: 4, step: 0.01 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerWarpOn").on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerWarpAmp", { min: 0, max: 40, step: 0.25 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerWarpFreq", { min: 4, max: 220, step: 0.25 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerSeed", { min: 0, max: 999999, step: 1 }).on("change", scheduleRebuild);
  outerFolder.addInput(P, "outerOffsetRand", { min: 0, max: 999999, step: 1 }).on("change", () => {
    randomizeOuterOffsets();
    scheduleRebuild();
  });

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgFilename", { label: "Filename" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });
}

function hookButtons() {
  document.getElementById("randomBtn").addEventListener("click", () => {
    randomizeMeshOffsets();
    randomizeOuterOffsets();
    rebuildModel();
  });
  document.getElementById("regenBtn").addEventListener("click", rebuildModel);
  document.getElementById("resetBtn").addEventListener("click", () => {
    Object.assign(P, structuredClone(DEFAULTS));
    PaperUtils.applyPaperPreset(P, P.paperPreset);
    randomizeMeshOffsets();
    randomizeOuterOffsets();
    pane.refresh();
    syncCanvasSize();
    rebuildModel();
  });
  document.getElementById("pngBtn").addEventListener("click", downloadPng);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
}

function syncCanvasSize() {
  const size = PaperUtils.getCanvasPixelSize(P);
  canvas.width = size.width;
  canvas.height = size.height;
  updateCanvasDisplaySize();
}

function updateCanvasDisplaySize() {
  const styleProxy = {
    style(name, value) {
      canvas.style[name] = value;
    },
  };
  PaperUtils.updateCanvasDisplaySize(styleProxy, P, "wrap");
}

function scheduleRebuild() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    rebuildModel();
  }, 12);
}

function rebuildModel() {
  const start = performance.now();
  model = buildModel();
  model.stats.renderMs = performance.now() - start;
  drawScene();
  updateStats();
}

function buildModel() {
  const spacing = computeSpacing();
  const insetCols = clampInt(P.inset, 0, Math.floor(P.cols / 2));
  const insetRows = clampInt(P.inset, 0, Math.floor(P.rows / 2));
  const minI = insetCols;
  const maxI = P.cols - insetCols - 1;
  const minJ = insetRows;
  const maxJ = P.rows - insetRows - 1;

  const meshParams = computeMeshNoiseParams();
  const meshField = makeNoiseField({
    seed: P.noiseSeedVal,
    amp: meshParams.amp,
    freq: meshParams.freq,
    ampX: P.ampX,
    ampY: P.ampY,
    freqX: P.freqX,
    freqY: P.freqY,
    warpOn: P.warpOn,
    warpAmp: P.warpAmp,
    warpFreq: P.warpFreq,
    octaves: P.octaves,
    falloff: P.falloff,
    offsetX: meshOffsets.x,
    offsetY: meshOffsets.y,
  });
  const outerField = makeNoiseField({
    seed: P.outerSeed,
    amp: P.outerAmp,
    freq: Math.max(1e-6, P.outerFreq),
    ampX: P.outerAmpX,
    ampY: P.outerAmpY,
    freqX: P.outerFreqX,
    freqY: P.outerFreqY,
    warpOn: P.outerWarpOn,
    warpAmp: P.outerWarpAmp,
    warpFreq: P.outerWarpFreq,
    octaves: P.octaves,
    falloff: P.falloff,
    offsetX: outerOffsets.x,
    offsetY: outerOffsets.y,
  });
  const colorAt = makePatternSampler();
  const rng = mulberry32((P.seed ^ 0x9e3779b9) >>> 0);

  const vertical = [];
  const horizontal = [];

  for (let i = insetCols; i < P.cols - insetCols; i++) {
    buildDirectionSegments({
      dir: "v",
      fixedIndex: i,
      travelCount: P.rows,
      spacing,
      meshField,
      outerField,
      colorAt,
      rng,
      minI,
      maxI,
      minJ,
      maxJ,
      out: vertical,
    });
  }

  for (let j = insetRows; j < P.rows - insetRows; j++) {
    buildDirectionSegments({
      dir: "h",
      fixedIndex: j,
      travelCount: P.cols,
      spacing,
      meshField,
      outerField,
      colorAt,
      rng,
      minI,
      maxI,
      minJ,
      maxJ,
      out: horizontal,
    });
  }

  let segmentCount = 0;
  let pointCount = 0;
  for (const bucket of [vertical, horizontal]) {
    for (const segment of bucket) {
      segmentCount += 1;
      pointCount += segment.pts.length;
    }
  }

  return {
    vertical,
    horizontal,
    stats: { segmentCount, pointCount, renderMs: 0 },
  };
}

function buildDirectionSegments(config) {
  const {
    dir,
    fixedIndex,
    travelCount,
    spacing,
    meshField,
    outerField,
    colorAt,
    rng,
    minI,
    maxI,
    minJ,
    maxJ,
    out,
  } = config;
  const displacementWeight = dir === "v" ? P.vertDisplace : P.horizDisplace;
  let drawing = false;
  let shouldDraw = rng() > P.skipProb;
  let remaining = randomSegmentLength(rng);
  let currentPts = [];
  let currentColor = "";

  for (let travelIndex = 0; travelIndex < travelCount; travelIndex++) {
    const i = dir === "v" ? fixedIndex : travelIndex;
    const j = dir === "v" ? travelIndex : fixedIndex;
    const x = spacing.x * i;
    const y = spacing.y * j;
    const isEnd = dir === "v" ? j < minJ || j > maxJ : i < minI || i > maxI;
    const pt = getDisplacedPoint(x, y, meshField, outerField, displacementWeight, isEnd);
    const color = colorAt(i, j, dir);

    if (shouldDraw) {
      if (!drawing) {
        drawing = true;
        currentPts = [];
        currentColor = color;
      }

      if (currentColor !== color && currentPts.length > 1) {
        out.push({ color: currentColor, pts: currentPts });
        currentPts = [];
        currentColor = color;
      }

      currentPts.push(pt);
    } else if (drawing) {
      if (currentPts.length > 1) {
        out.push({ color: currentColor, pts: currentPts });
      }
      drawing = false;
      currentPts = [];
      currentColor = "";
    }

    remaining -= 1;
    if (remaining <= 0) {
      shouldDraw = rng() > P.skipProb;
      remaining = randomSegmentLength(rng);
    }
  }

  if (drawing && currentPts.length > 1) {
    out.push({ color: currentColor, pts: currentPts });
  }
}

function computeMeshNoiseParams() {
  const smartAmp = lerp(0, 16, P.noiseIntensity);
  const smartFreq = lerp(3, 34, P.noiseIntensity);
  return {
    amp: (P.noiseAmp / 15) * smartAmp,
    freq: (P.noiseFreq / 18) * smartFreq,
  };
}

function getDisplacedPoint(x, y, meshField, outerField, dirWeight, isEnd) {
  const base = displacedByField(x, y, meshField, dirWeight);
  if (!P.outerOn || !isEnd || P.outerInfluence <= 0) {
    return base;
  }

  const seedShift = (P.outerSeed % 100000) * 0.01;
  const ox = x + seedShift;
  const oy = y - seedShift;
  const outerPt = displacedByField(ox, oy, outerField, dirWeight);
  return {
    x: base.x + (outerPt.x - ox) * P.outerInfluence,
    y: base.y + (outerPt.y - oy) * P.outerInfluence,
  };
}

function displacedByField(x, y, field, dirWeight) {
  let wx = 0;
  let wy = 0;
  if (field.warpOn) {
    const wf = Math.max(1e-6, field.warpFreq);
    const wa = field.warpAmp;
    wx = remap(field.noise2((x + field.offsetX) / wf, (y + field.offsetY) / wf), -wa, wa);
    wy = remap(field.noise2((x + 17.17 + field.offsetX) / wf, (y + 9.13 + field.offsetY) / wf), -wa, wa);
  }

  const fx = Math.max(1e-6, field.freq * field.freqX);
  const fy = Math.max(1e-6, field.freq * field.freqY);
  const ax = field.amp * field.ampX * dirWeight;
  const ay = field.amp * field.ampY * dirWeight;
  const nX = remap(field.noise2((x + wx + field.offsetX) / fx, (y + wy + field.offsetY) / fy), -ax, ax);
  const nY = remap(field.noise2((x + 31.7 + wx + field.offsetX) / fx, (y + 46.3 + wy + field.offsetY) / fy), -ay, ay);
  return { x: x + nX, y: y + nY };
}

function makeNoiseField(config) {
  const octaveSeeds = [];
  for (let i = 0; i < config.octaves; i++) {
    octaveSeeds.push((config.seed + i * 2654435761) >>> 0);
  }

  return {
    ...config,
    noise2(x, y) {
      let total = 0;
      let amplitude = 1;
      let frequency = 1;
      let maxAmp = 0;
      for (let octave = 0; octave < octaveSeeds.length; octave++) {
        total += valueNoise2D(x * frequency, y * frequency, octaveSeeds[octave]) * amplitude;
        maxAmp += amplitude;
        amplitude *= config.falloff;
        frequency *= 2;
      }
      return maxAmp > 0 ? total / maxAmp : 0;
    },
  };
}

function drawScene() {
  const pxPerMM = PaperUtils.getPxPerMM(P);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(pxPerMM, 0, 0, pxPerMM, 0, 0);
  drawSegments(model.vertical, P.vertStrokeW);
  drawSegments(model.horizontal, P.horizStrokeW);

  if (P.showBounds) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = Math.max(0.12, 1 / pxPerMM);
    ctx.strokeRect(P.marginXMM, P.marginYMM, innerWidthMM(), innerHeightMM());
    ctx.restore();
  }
}

function drawSegments(segments, strokeWidthMM) {
  const pathsByColor = new Map();
  for (const segment of segments) {
    const key = `${segment.color}|${strokeWidthMM}`;
    let path = pathsByColor.get(key);
    if (!path) {
      path = new Path2D();
      pathsByColor.set(key, path);
    }
    addSegmentToPath(path, segment.pts, P.previewCurves);
  }

  for (const [key, path] of pathsByColor.entries()) {
    const [color, width] = key.split("|");
    ctx.strokeStyle = color;
    ctx.lineWidth = Number(width);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
  }
}

function addSegmentToPath(path, pts, useCurves) {
  if (!pts.length) {
    return;
  }
  path.moveTo(pts[0].x + P.marginXMM, pts[0].y + P.marginYMM);
  if (!useCurves || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) {
      path.lineTo(pts[i].x + P.marginXMM, pts[i].y + P.marginYMM);
    }
    return;
  }

  const extended = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path.bezierCurveTo(
      cp1x + P.marginXMM,
      cp1y + P.marginYMM,
      cp2x + P.marginXMM,
      cp2y + P.marginYMM,
      p2.x + P.marginXMM,
      p2.y + P.marginYMM
    );
  }
}

function exportSVG() {
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(P.canvasHMM)}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`,
    `  <rect x="0" y="0" width="${ExportUtils.fmt(P.canvasWMM)}" height="${ExportUtils.fmt(P.canvasHMM)}" fill="${ExportUtils.escapeXML(P.bg)}"/>`,
    `  <g id="vertical" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    segmentsToSvg(model.vertical, P.vertStrokeW),
    `  </g>`,
    `  <g id="horizontal" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    segmentsToSvg(model.horizontal, P.horizStrokeW),
    `  </g>`,
    `</svg>`,
  ].join("\n");

  ExportUtils.downloadText(svg, P.svgFilename || "fabric.svg", "image/svg+xml;charset=utf-8");
}

function segmentsToSvg(segments, strokeWidthMM) {
  return segments
    .map((segment) => {
      if (!segment.pts || segment.pts.length < 2) {
        return "";
      }
      const d = pointsToSvgPath(segment.pts, P.previewCurves);
      return `    <path d="${d}" stroke="${ExportUtils.escapeXML(segment.color)}" stroke-width="${ExportUtils.fmt(strokeWidthMM)}"/>`;
    })
    .filter(Boolean)
    .join("\n");
}

function pointsToSvgPath(pts, useCurves) {
  const first = pts[0];
  let d = `M ${ExportUtils.fmt(first.x + P.marginXMM)} ${ExportUtils.fmt(first.y + P.marginYMM)}`;
  if (!useCurves || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${ExportUtils.fmt(pts[i].x + P.marginXMM)} ${ExportUtils.fmt(pts[i].y + P.marginYMM)}`;
    }
    return d;
  }

  const extended = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${ExportUtils.fmt(cp1x + P.marginXMM)} ${ExportUtils.fmt(cp1y + P.marginYMM)}, ${ExportUtils.fmt(cp2x + P.marginXMM)} ${ExportUtils.fmt(cp2y + P.marginYMM)}, ${ExportUtils.fmt(p2.x + P.marginXMM)} ${ExportUtils.fmt(p2.y + P.marginYMM)}`;
  }
  return d;
}

function downloadPng() {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "fabric.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function updateStats() {
  document.getElementById("stat-segments").textContent = String(model.stats.segmentCount);
  document.getElementById("stat-points").textContent = String(model.stats.pointCount);
  document.getElementById("stat-render").textContent = `${model.stats.renderMs.toFixed(1)} ms`;
}

function computeSpacing() {
  return {
    x: innerWidthMM() / Math.max(1, P.cols),
    y: innerHeightMM() / Math.max(1, P.rows),
  };
}

function innerWidthMM() {
  return Math.max(1, P.canvasWMM - P.marginXMM * 2);
}

function innerHeightMM() {
  return Math.max(1, P.canvasHMM - P.marginYMM * 2);
}

function randomizeMeshOffsets() {
  meshShuffleNonce += 1;
  const rng = mulberry32((P.noiseSeedVal ^ P.seed ^ meshShuffleNonce ^ 0xa5a5a5a5) >>> 0);
  meshOffsets = {
    x: rng() * 1000,
    y: rng() * 1000,
  };
}

function randomizeOuterOffsets() {
  outerShuffleNonce += 1;
  const rng = mulberry32((P.outerSeed ^ P.outerOffsetRand ^ outerShuffleNonce ^ 0x6c8e9cf5) >>> 0);
  outerOffsets = {
    x: rng() * 1000,
    y: rng() * 1000,
  };
}

function makePatternSampler() {
  const scale = Math.max(1, Math.floor(P.patternScale));
  const lineWidth = Math.max(1, Math.floor(P.patternLineWidth));
  const colors = { A: P.cA, B: P.cB, C: P.cC, D: P.cD };
  const plaid = P.pattern === "Tartan / Plaid" ? plaidConfig(P.patternSeed) : null;
  const madras = P.pattern === "Madras" ? madrasConfig(P.patternSeed) : null;

  return (i, j, dir) => {
    const bx = Math.floor(i / scale);
    const by = Math.floor(j / scale);

    if (P.pattern === "Custom (Solid)") return dir === "v" ? colors.A : colors.B;
    if (P.pattern === "Chequered") return (bx + by) % 2 === 0 ? colors.A : colors.B;
    if (P.pattern === "Buffalo Check") return (bx + by) % 2 === 0 ? colors.C : colors.A;

    if (P.pattern === "Gingham") {
      const ex = bx % 2;
      const ey = by % 2;
      if (ex === 0 && ey === 0) return colors.D;
      if (ex === 1 && ey === 1) return colors.C;
      return colors.A;
    }

    if (P.pattern === "Windowpane") {
      const onX = i % scale < lineWidth;
      const onY = j % scale < lineWidth;
      return onX || onY ? colors.A : colors.D;
    }

    if (P.pattern === "Tattersall") {
      const onX = i % scale < lineWidth;
      const onY = j % scale < lineWidth;
      if (onX && onY) return colors.C;
      if (onX) return colors.A;
      if (onY) return colors.B;
      return colors.D;
    }

    if (P.pattern === "Tartan / Plaid") {
      const vx = plaidStripeAt(i, plaid.x);
      const vy = plaidStripeAt(j, plaid.y);
      if (vx.kind === "bold" && vy.kind === "bold") return colors.C;
      if (vx.kind === "bold") return colors.A;
      if (vy.kind === "bold") return colors.B;
      if (vx.kind === "thin" && vy.kind === "thin") return colors.C;
      if (vx.kind === "thin") return colors.A;
      if (vy.kind === "thin") return colors.B;
      return colors.D;
    }

    if (P.pattern === "Madras") {
      const vx = stripeIndexIrregular(i, madras.x);
      const vy = stripeIndexIrregular(j, madras.y);
      const colX = madras.palette[vx % madras.palette.length];
      const colY = madras.palette[vy % madras.palette.length];
      if ((vx + vy) % 5 === 0) return colors.C;
      return dir === "v" ? colX : colY;
    }

    if (P.pattern === "Houndstooth (Approx)") {
      const cell = 4 * scale;
      const u = ((i % cell) + cell) % cell;
      const v = ((j % cell) + cell) % cell;
      const diag = u - v;
      const band = Math.floor(u / scale + v / scale) % 2;
      const tooth = diag > -scale && diag < scale ? 1 : 0;
      return (band ^ tooth) === 0 ? colors.C : colors.D;
    }

    return dir === "v" ? colors.A : colors.B;
  };
}

function plaidConfig(seed) {
  const rng = mulberry32(seed >>> 0);
  const buildAxis = () => {
    const seq = [];
    const kinds = ["thin", "base", "bold", "base", "thin"];
    for (let k = 0; k < 9; k++) {
      const kind = kinds[k % kinds.length];
      const w =
        kind === "bold" ? 2 + Math.floor(rng() * 4) : kind === "thin" ? 1 : 2 + Math.floor(rng() * 6);
      seq.push({ w, kind });
    }
    return { seq, period: seq.reduce((sum, item) => sum + item.w, 0) };
  };
  return { x: buildAxis(), y: buildAxis() };
}

function plaidStripeAt(t, axisCfg) {
  let x = ((t % axisCfg.period) + axisCfg.period) % axisCfg.period;
  for (const stripe of axisCfg.seq) {
    if (x < stripe.w) {
      return stripe;
    }
    x -= stripe.w;
  }
  return axisCfg.seq[axisCfg.seq.length - 1];
}

function madrasConfig(seed) {
  const rng = mulberry32((seed * 1103515245 + 12345) >>> 0);
  const buildAxis = () => {
    const widths = [];
    for (let i = 0; i < 24; i++) {
      widths.push(2 + Math.floor(rng() * 9));
    }
    return { widths, period: widths.reduce((sum, value) => sum + value, 0) };
  };
  return {
    x: buildAxis(),
    y: buildAxis(),
    palette: [P.cA, P.cB, P.cC, shade(P.cA, -0.25), shade(P.cB, 0.2)],
  };
}

function stripeIndexIrregular(t, axisCfg) {
  let x = ((t % axisCfg.period) + axisCfg.period) % axisCfg.period;
  for (let i = 0; i < axisCfg.widths.length; i++) {
    if (x < axisCfg.widths[i]) {
      return i;
    }
    x -= axisCfg.widths[i];
  }
  return 0;
}

function randomSegmentLength(rng) {
  return Math.floor(2 + rng() * Math.max(1, P.maxSegmentLen - 1));
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = smoothstep(tx);
  const sy = smoothstep(ty);
  const n00 = hashNoise(x0, y0, seed);
  const n10 = hashNoise(x0 + 1, y0, seed);
  const n01 = hashNoise(x0, y0 + 1, seed);
  const n11 = hashNoise(x0 + 1, y0 + 1, seed);
  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

function hashNoise(x, y, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function remap(value, a, b) {
  return a + ((value + 1) * 0.5) * (b - a);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function shade(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  return rgbToHex(
    clampChannel(rgb.r + 255 * amount),
    clampChannel(rgb.g + 255 * amount),
    clampChannel(rgb.b + 255 * amount)
  );
}

function hexToRgb(hex) {
  const text = String(hex).replace("#", "").trim();
  if (text.length === 3) {
    return {
      r: parseInt(text[0] + text[0], 16),
      g: parseInt(text[1] + text[1], 16),
      b: parseInt(text[2] + text[2], 16),
    };
  }
  if (text.length === 6) {
    return {
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16),
    };
  }
  return null;
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(value) {
  return clampChannel(value).toString(16).padStart(2, "0");
}
