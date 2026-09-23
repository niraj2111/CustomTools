const MM_PER_INCH = 25.4;
const BELLY_BUFFER_MM = 5;
const ARTWORK_WIDTH_TO_HEIGHT = 108 / 170;

const PAPER_SIZES_MM = {
  Custom: null,
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420],
  A4: [210, 297], A5: [148, 210], A6: [105, 148], A7: [74, 105],
  A8: [52, 74], A9: [37, 52], A10: [26, 37],
  B0: [1000, 1414], B1: [707, 1000], B2: [500, 707], B3: [353, 500],
  B4: [250, 353], B5: [176, 250], B6: [125, 176], B7: [88, 125],
  B8: [62, 88], B9: [44, 62], B10: [31, 44],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
  Executive: [184.15, 266.7], Statement: [139.7, 215.9], Square: [210, 210],
};

let pane;
let cnv;
let vaseInstances = [];
let dialRoot;
let dialController;
let dialSyncing = false;

const P = {
  // Canvas & Layout
  canvasWMM: 148,
  canvasHMM: 210,
  canvasSizePreset: "A5",
  paperOrientation: "Portrait",
  dpi: 96,
  previewScale: 1.0,
  fitToViewport: true,
  bg: "#ffffff",
  lineColor: "#0b0c10",
  strokeWeightMM: 0.35,
  marginMM: 20,

  // Layout Presets
  layoutPreset: "Single",
  gridColumns: 2,
  gridRows: 2,
  gridGapXMM: 8,
  gridGapYMM: 8,
  linearCount: 3,
  linearGapMM: 8,
  radialCount: 6,
  radialRadiusMM: 48,
  radialCellWidthMM: 28,
  radialCellHeightMM: 42,
  pageSpacedCount: 7,
  pageCellWidthMM: 28,
  pageCellHeightMM: 42,
  pageGapMM: 8,

  // Selected vase
  activeInstance: 1,

  // Primary Form (0-1)
  neckWidth: 0.25,
  rimFlare: 0.5,
  baseWidth: 0.4,
  a4: 0.8,

  // Bulge Geometry (0-1)
  bellyWidth: 0.8,
  a2: 0.8,
  a3: 0.8,
  bulbHeightRatio: 0.5,

  // Locks (Internal)
  lock_neckWidth: false,
  lock_rimFlare: false,
  lock_baseWidth: false,
  lock_a4: false,
  lock_bellyWidth: false,
  lock_a2: false,
  lock_a3: false,
  lock_bulbHeightRatio: false,
  
  // Proportions & Density
  neckDepth: 5,
  baseDepth: 5,
  vaseLines: 80,

  // Plant
  showBranch: true,
  branchHeightRatio: 0.35,
  branchSeed: 42,
  branchAngle: Math.PI / 8,

  showControls: false,
  svgFilename: "Vase-Bundle",
};

const RANDOM_CONTROL_RANGES = {
  // Vase 2.0's conservative resolved ranges, using this tool's strict
  // 0-1 cap for the bulb handles instead of Vase 2.0's legacy 1.25 cap.
  neckWidth: [0.14, 0.65],
  rimFlare: [0.16, 0.85],
  baseWidth: [0.18, 0.8],
  a4: [0.2, 1],
  bellyWidth: [0.35, 1],
  a2: [0.3, 1],
  a3: [0.3, 1],
  bulbHeightRatio: [0.28, 0.7],
  neckDepth: [3, 24],
  baseDepth: [3, 24],
  branchHeightRatio: [0.18, 0.45],
  branchSeed: [0, 9999],
  branchAngle: [0.18, 0.7],
};

const INTEGER_RANDOM_CONTROLS = new Set(["branchSeed"]);

const VASE_GEOMETRY_KEYS = [
  "neckWidth", "rimFlare", "baseWidth", "a4",
  "bellyWidth", "a2", "a3", "bulbHeightRatio",
  "lock_neckWidth", "lock_rimFlare", "lock_baseWidth", "lock_a4",
  "lock_bellyWidth", "lock_a2", "lock_a3", "lock_bulbHeightRatio",
  "neckDepth", "baseDepth", "vaseLines",
  "showBranch", "branchHeightRatio", "branchSeed", "branchAngle",
];

function captureVaseGeometry(source = P) {
  return Object.fromEntries(VASE_GEOMETRY_KEYS.map(key => [key, source[key]]));
}

function makeVaseInstance() {
  return { geometry: captureVaseGeometry() };
}

function getLayoutCount() {
  if (P.layoutPreset === "Grid") return Math.round(P.gridColumns) * Math.round(P.gridRows);
  if (P.layoutPreset === "Row" || P.layoutPreset === "Column") return Math.round(P.linearCount);
  if (P.layoutPreset === "Radial") return Math.round(P.radialCount);
  if (P.layoutPreset === "Page Spaced") return Math.round(P.pageSpacedCount);
  return 1;
}

function ensureVaseInstances() {
  const count = Math.max(1, getLayoutCount());
  while (vaseInstances.length < count) vaseInstances.push(makeVaseInstance());
  P.activeInstance = Math.max(1, Math.min(count, Math.round(P.activeInstance)));
  return count;
}

function loadActiveVaseGeometry() {
  ensureVaseInstances();
  Object.assign(P, vaseInstances[P.activeInstance - 1].geometry);
}

function saveActiveVaseGeometry() {
  ensureVaseInstances();
  vaseInstances[P.activeInstance - 1].geometry = captureVaseGeometry();
}

function updateLayoutControlVisibility() {
  if (dialController) refreshDialFromP(true);
}

function applyPaperPreset() {
  const size = PAPER_SIZES_MM[P.canvasSizePreset];
  if (!size) return;
  const [shortSide, longSide] = size;
  if (P.canvasSizePreset === "Square" || P.paperOrientation === "Portrait") {
    P.canvasWMM = shortSide;
    P.canvasHMM = longSide;
  } else {
    P.canvasWMM = longSide;
    P.canvasHMM = shortSide;
  }
  const maxMargin = Math.max(0, (Math.min(P.canvasWMM, P.canvasHMM) - 2) / 2);
  P.marginMM = Math.min(P.marginMM, maxMargin);
}

function setup() {
  applyPaperPreset();
  ensureVaseInstances();
  loadActiveVaseGeometry();
  const size = getCanvasPixelSize();
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  updateCanvasDisplaySize();
  redraw();
}

function draw() {
  background(P.bg);
  push();
  scale(getPxPerMM());
  const { width: baseW, height: baseH } = getArtworkArea();
  const items = getLayoutItems();
  items.forEach(drawLayoutCell);
  items.forEach(item => {
    const state = vaseInstances[item.index].geometry;
    push();
    translate(item.x, item.y);
    scale(item.scale);
    drawArtwork(0, -baseH / 2, baseW, baseH, state);
    pop();
  });
  pop();
}

function drawLayoutCell(item) {
  const selected = item.index === P.activeInstance - 1;
  push();
  noFill();
  stroke(selected ? "#2563eb" : "#b7bcc4");
  strokeWeight(selected ? 0.55 : 0.25);
  rect(item.cell.x, item.cell.y, item.cell.width, item.cell.height);
  noStroke();
  fill(selected ? "#2563eb" : "#7c838e");
  textSize(3);
  textAlign(LEFT, TOP);
  text(String(item.index + 1), item.cell.x + 1.5, item.cell.y + 1.2);
  pop();
}

function getUsableArea() {
  return {
    width: Math.max(1, P.canvasWMM - (P.marginMM * 2)),
    height: Math.max(1, P.canvasHMM - (P.marginMM * 2)),
  };
}

function getArtworkArea() {
  const { height } = getUsableArea();
  return { width: height * ARTWORK_WIDTH_TO_HEIGHT, height };
}

function getLayoutItems() {
  const count = ensureVaseInstances();
  const { width: usableW, height: usableH } = getUsableArea();
  const left = P.marginMM;
  const top = P.marginMM;
  const centerX = P.canvasWMM / 2;
  const centerY = P.canvasHMM / 2;
  // Preserve vase proportions across portrait and landscape pages. Instances
  // are sized only from cell height; cell width never widens or flattens them.
  const fitScale = (_width, height) => Math.max(0.01, height / usableH);
  const items = [];
  const addCell = (x, y, width, height) => items.push({
    x,
    y,
    scale: fitScale(width, height),
    cell: { x: x - width / 2, y: y - height / 2, width, height },
  });

  if (P.layoutPreset === "Grid") {
    const columns = Math.max(1, Math.round(P.gridColumns));
    const rows = Math.max(1, Math.round(P.gridRows));
    const cellW = Math.max(1, (usableW - P.gridGapXMM * (columns - 1)) / columns);
    const cellH = Math.max(1, (usableH - P.gridGapYMM * (rows - 1)) / rows);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        addCell(
          left + column * (cellW + P.gridGapXMM) + cellW / 2,
          top + row * (cellH + P.gridGapYMM) + cellH / 2,
          cellW,
          cellH,
        );
      }
    }
  } else if (P.layoutPreset === "Row" || P.layoutPreset === "Column") {
    const itemCount = Math.max(1, Math.round(P.linearCount));
    const horizontal = P.layoutPreset === "Row";
    const cellW = horizontal ? Math.max(1, (usableW - P.linearGapMM * (itemCount - 1)) / itemCount) : usableW;
    const cellH = horizontal ? usableH : Math.max(1, (usableH - P.linearGapMM * (itemCount - 1)) / itemCount);
    for (let index = 0; index < itemCount; index++) {
      addCell(
        horizontal ? left + index * (cellW + P.linearGapMM) + cellW / 2 : centerX,
        horizontal ? centerY : top + index * (cellH + P.linearGapMM) + cellH / 2,
        cellW,
        cellH,
      );
    }
  } else if (P.layoutPreset === "Radial") {
    const radius = Math.min(P.radialRadiusMM, Math.max(0, Math.min(usableW, usableH) / 2));
    for (let index = 0; index < count; index++) {
      const angle = -90 + (index * 360 / count);
      const radians = angle * Math.PI / 180;
      addCell(
        centerX + Math.cos(radians) * radius,
        centerY + Math.sin(radians) * radius,
        P.radialCellWidthMM,
        P.radialCellHeightMM,
      );
    }
  } else if (P.layoutPreset === "Page Spaced") {
    const cellW = Math.max(1, P.pageCellWidthMM);
    const cellH = Math.max(1, P.pageCellHeightMM);
    const columns = Math.max(1, Math.min(count, Math.floor((usableW + P.pageGapMM) / (cellW + P.pageGapMM))));
    const rows = Math.ceil(count / columns);
    const blockW = columns * cellW + (columns - 1) * P.pageGapMM;
    const blockH = rows * cellH + (rows - 1) * P.pageGapMM;
    const startX = centerX - blockW / 2;
    const startY = centerY - blockH / 2;
    for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      addCell(
        startX + column * (cellW + P.pageGapMM) + cellW / 2,
        startY + row * (cellH + P.pageGapMM) + cellH / 2,
        cellW,
        cellH,
      );
    }
  } else {
    addCell(centerX, centerY, usableW, usableH);
  }

  return items.slice(0, count).map((item, index) => ({ ...item, index }));
}

function drawArtwork(centerX, artTop, usableW, usableH, state) {
  const plantH = state.showBranch ? usableH * state.branchHeightRatio : 0;
  const vaseH = usableH - plantH;

  if (state.showBranch) {
    push();
    randomSeed(state.branchSeed);
    translate(centerX, artTop + plantH);
    stroke(P.lineColor);
    strokeWeight(P.strokeWeightMM * 0.7);
    branch(plantH, state);
    pop();
  }

  stroke(P.lineColor);
  strokeWeight(P.strokeWeightMM);
  noFill();
  drawVase(centerX, artTop + plantH, vaseH, usableW, state);
}

function drawVase(x, y, h, w, state) {
  const { neckDepth, baseDepth, bellyY } = getVaseVerticalGeometry(h, state);
  const sy = 0; const ey = h;
  const pts = [{ py: sy }, { py: sy + neckDepth }, { py: sy + neckDepth }, { py: ey - baseDepth }, { py: ey - baseDepth }, { py: ey }];

  const maxW = (w * 0.9) / 1.5;
  const baseGap = maxW; 

  push();
  translate(x, y);

  for (let j = 0; j <= state.vaseLines; j++) {
    let factor = map(j, 0, state.vaseLines, -1, 1);
    let g = baseGap * factor;
    const cx = (val) => constrain(val, -maxW, maxW);

    beginShape();
    vertex(cx(g * state.neckWidth), pts[0].py);
    vertex(cx(g * state.neckWidth), pts[1].py);
    bezierVertex(cx(g * state.rimFlare), pts[1].py, cx(g * state.a2), bellyY, cx(g * state.bellyWidth), bellyY);
    bezierVertex(cx(g * state.a3), bellyY, cx(g * state.a4), pts[4].py, cx(g * state.baseWidth), pts[4].py);
    vertex(cx(g * state.baseWidth), pts[4].py);
    vertex(cx(g * state.baseWidth), pts[5].py);
    endShape();

    if (P.showControls && (j === 0 || j === state.vaseLines)) {
      drawDot(cx(g * state.rimFlare), pts[1].py);
      drawDot(cx(g * state.a2), bellyY);
      drawDot(cx(g * state.a3), bellyY);
      drawDot(cx(g * state.a4), pts[4].py);
    }
  }
  pop();
}

function drawDot(x, y) {
  push(); noStroke(); fill(255, 0, 0, 150); ellipse(x, y, 1.2, 1.2); pop();
}

function getVaseHeight(state = P) {
  const usableH = P.canvasHMM - (P.marginMM * 2);
  const plantH = state.showBranch ? usableH * state.branchHeightRatio : 0;
  return usableH - plantH;
}

function enforceVaseConstraints(state = P) {
  // Bulge width and handle controls are defined on the complete 0-1 range.
  // Keep imported presets within the same limits as the UI.
  state.bellyWidth = Math.max(0, Math.min(1, state.bellyWidth));
  state.a2 = Math.max(0, Math.min(1, state.a2));
  state.a3 = Math.max(0, Math.min(1, state.a3));
  state.branchAngle = Math.max(0.18, Math.min(0.7, state.branchAngle));

  // Either belly handle may sit inside the belly anchor. Only prevent both
  // handles from pointing inward at once, which creates a spike. Move the
  // nearer handle to the belly width so the correction is as small as possible.
  if (state.a2 < state.bellyWidth && state.a3 < state.bellyWidth) {
    if (state.a2 >= state.a3) state.a2 = state.bellyWidth;
    else state.a3 = state.bellyWidth;
  }

  // Preserve room for the belly buffer even when the neck/base controls or
  // plant height reduce the available vase height.
  const availableDepth = Math.max(0, getVaseHeight(state) - (BELLY_BUFFER_MM * 2));
  const combinedDepth = state.neckDepth + state.baseDepth;
  if (combinedDepth > availableDepth && combinedDepth > 0) {
    const scale = availableDepth / combinedDepth;
    state.neckDepth *= scale;
    state.baseDepth *= scale;
  }
}

function getVaseVerticalGeometry(height, state = P) {
  const neckEnd = state.neckDepth;
  const baseStart = height - state.baseDepth;
  const firstAllowedY = neckEnd + BELLY_BUFFER_MM;
  const lastAllowedY = baseStart - BELLY_BUFFER_MM;
  const position = Math.max(0, Math.min(1, state.bulbHeightRatio));
  return {
    neckDepth: state.neckDepth,
    baseDepth: state.baseDepth,
    bellyY: firstAllowedY + ((lastAllowedY - firstAllowedY) * position),
  };
}

function randomControlState(random = Math.random, state = P) {
  let candidate = { ...state };

  // Vase 2.0 generates a complete vase from one seeded uniform sequence.
  // Keep that behavior and its conservative resolved parameter ranges.
  // The only rejected relationship is both handles being inside the belly.
  for (let attempt = 0; attempt < 256; attempt++) {
    candidate = { ...state };
    Object.entries(RANDOM_CONTROL_RANGES).forEach(([key, [min, max]]) => {
      if (state["lock_" + key]) return;
      candidate[key] = INTEGER_RANDOM_CONTROLS.has(key)
        ? min + Math.floor(random() * (max - min + 1))
        : min + (random() * (max - min));
    });
    if (!(candidate.a2 < candidate.bellyWidth && candidate.a3 < candidate.bellyWidth)) break;
  }

  // Degenerate locked states (for example bellyWidth=1) can make rejection
  // sampling impossible. Correct only the forbidden conjunction, minimally.
  if (candidate.a2 < candidate.bellyWidth && candidate.a3 < candidate.bellyWidth) {
    const canMoveA2 = !state.lock_a2;
    const canMoveA3 = !state.lock_a3;
    if (canMoveA2 && (!canMoveA3 || candidate.a2 >= candidate.a3)) candidate.a2 = candidate.bellyWidth;
    else if (canMoveA3) candidate.a3 = candidate.bellyWidth;
    else if (!state.lock_bellyWidth) candidate.bellyWidth = Math.max(candidate.a2, candidate.a3);
    else if (candidate.a2 >= candidate.a3) candidate.a2 = candidate.bellyWidth;
    else candidate.a3 = candidate.bellyWidth;
  }

  return candidate;
}

function newRandomSeed() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

function branch(len, state) {
  line(0, 0, 0, -len * 0.4);
  translate(0, -len * 0.4);
  if (len > 15) {
    push(); rotate(state.branchAngle * random(0.6, 1.4)); branch(len * 0.65, state); pop();
    push(); rotate(-state.branchAngle * random(0.6, 1.4)); branch(len * 0.55, state); pop();
  } else {
    noStroke(); fill(P.lineColor);
    ellipse(0, 0, 1.5, 1.5);
  }
}

const DIAL_PARAM_PATHS = {
  "layoutPresets.layoutPreset": "layoutPreset",
  "layoutPresets.columns": "gridColumns",
  "layoutPresets.rows": "gridRows",
  "layoutPresets.columnGap (mm)": "gridGapXMM",
  "layoutPresets.rowGap (mm)": "gridGapYMM",
  "layoutPresets.linearVases": "linearCount",
  "layoutPresets.linearGap (mm)": "linearGapMM",
  "layoutPresets.radialVases": "radialCount",
  "layoutPresets.radius (mm)": "radialRadiusMM",
  "layoutPresets.radialCellWidth (mm)": "radialCellWidthMM",
  "layoutPresets.radialCellHeight (mm)": "radialCellHeightMM",
  "layoutPresets.pageVases": "pageSpacedCount",
  "layoutPresets.pageCellWidth (mm)": "pageCellWidthMM",
  "layoutPresets.pageCellHeight (mm)": "pageCellHeightMM",
  "layoutPresets.spacing (mm)": "pageGapMM",
  "layoutPresets.selectedCell": "activeInstance",
  "vaseBody.neckWidth": "neckWidth",
  "vaseBody.rimFlareA1": "rimFlare",
  "vaseBody.bellyWidth": "bellyWidth",
  "vaseBody.bulbTopHandleA2": "a2",
  "vaseBody.bulbBottomHandleA3": "a3",
  "vaseBody.shoulderA4": "a4",
  "vaseBody.baseWidth": "baseWidth",
  "vaseBody.bulbPosition": "bulbHeightRatio",
  "vaseBody.locks.lockNeck": "lock_neckWidth",
  "vaseBody.locks.lockFlare": "lock_rimFlare",
  "vaseBody.locks.lockBelly": "lock_bellyWidth",
  "vaseBody.locks.lockTopHandle": "lock_a2",
  "vaseBody.locks.lockBottomHandle": "lock_a3",
  "vaseBody.locks.lockShoulder": "lock_a4",
  "vaseBody.locks.lockBase": "lock_baseWidth",
  "vaseBody.locks.lockBulbPosition": "lock_bulbHeightRatio",
  "proportions.neckHeight (mm)": "neckDepth",
  "proportions.baseHeight (mm)": "baseDepth",
  "proportions.density": "vaseLines",
  "branch.showBranch": "showBranch",
  "branch.seed": "branchSeed",
  "branch.height": "branchHeightRatio",
  "branch.spreadAngle": "branchAngle",
  "canvasSettings.width (mm)": "canvasWMM",
  "canvasSettings.height (mm)": "canvasHMM",
  "canvasSettings.paperType": "canvasSizePreset",
  "canvasSettings.orientation": "paperOrientation",
  "canvasSettings.margin (mm)": "marginMM",
  "canvasSettings.zoom": "previewScale",
  "canvasSettings.fitView": "fitToViewport",
  "styling.inkColor": "lineColor",
  "styling.lineweight (mm)": "strokeWeightMM",
  "styling.guides": "showControls",
};

function buildLayoutDialConfig() {
  const config = {
    _collapsed: false,
    layoutPreset: {
      type: "select",
      options: ["Single", "Grid", "Row", "Column", "Radial", "Page Spaced"],
      default: P.layoutPreset,
    },
  };
  if (P.layoutPreset === "Grid") {
    Object.assign(config, {
      columns: [P.gridColumns, 1, 6, 1],
      rows: [P.gridRows, 1, 6, 1],
      "columnGap (mm)": [P.gridGapXMM, 0, 40, 1],
      "rowGap (mm)": [P.gridGapYMM, 0, 40, 1],
    });
  } else if (P.layoutPreset === "Row" || P.layoutPreset === "Column") {
    Object.assign(config, {
      linearVases: [P.linearCount, 1, 10, 1],
      "linearGap (mm)": [P.linearGapMM, 0, 40, 1],
    });
  } else if (P.layoutPreset === "Radial") {
    Object.assign(config, {
      radialVases: [P.radialCount, 2, 16, 1],
      "radius (mm)": [P.radialRadiusMM, 0, 100, 1],
      "radialCellWidth (mm)": [P.radialCellWidthMM, 5, 100, 1],
      "radialCellHeight (mm)": [P.radialCellHeightMM, 5, 140, 1],
    });
  } else if (P.layoutPreset === "Page Spaced") {
    Object.assign(config, {
      pageVases: [P.pageSpacedCount, 1, 20, 1],
      "pageCellWidth (mm)": [P.pageCellWidthMM, 5, 100, 1],
      "pageCellHeight (mm)": [P.pageCellHeightMM, 5, 140, 1],
      "spacing (mm)": [P.pageGapMM, 0, 40, 1],
    });
  }
  config.selectedCell = [P.activeInstance, 1, Math.max(1, getLayoutCount()), 1];
  return config;
}

function buildDialConfig() {
  return {
    presetsManagement: {
      _collapsed: true,
      saveBundle: { type: "action", label: "Save Bundle (SVG + JSON)" },
      loadJsonPreset: { type: "action", label: "Load JSON Preset" },
    },
    layoutPresets: buildLayoutDialConfig(),
    vaseBody: {
      _collapsed: false,
      neckWidth: [P.neckWidth, 0.1, 1, 0.01],
      rimFlareA1: [P.rimFlare, 0.1, 1, 0.01],
      bellyWidth: [P.bellyWidth, 0, 1, 0.01],
      bulbTopHandleA2: [P.a2, 0, 1, 0.01],
      bulbBottomHandleA3: [P.a3, 0, 1, 0.01],
      shoulderA4: [P.a4, 0.1, 1, 0.01],
      baseWidth: [P.baseWidth, 0.1, 1, 0.01],
      bulbPosition: [P.bulbHeightRatio, 0.1, 0.9, 0.01],
      locks: {
        _collapsed: true,
        lockNeck: P.lock_neckWidth,
        lockFlare: P.lock_rimFlare,
        lockBelly: P.lock_bellyWidth,
        lockTopHandle: P.lock_a2,
        lockBottomHandle: P.lock_a3,
        lockShoulder: P.lock_a4,
        lockBase: P.lock_baseWidth,
        lockBulbPosition: P.lock_bulbHeightRatio,
      },
    },
    proportions: {
      _collapsed: false,
      "neckHeight (mm)": [P.neckDepth, 2, 80, 0.1],
      "baseHeight (mm)": [P.baseDepth, 2, 80, 0.1],
      density: [P.vaseLines, 5, 300, 1],
    },
    branch: {
      _collapsed: false,
      showBranch: P.showBranch,
      seed: [P.branchSeed, 0, 9999, 1],
      height: [P.branchHeightRatio, 0.1, 0.7, 0.01],
      spreadAngle: [P.branchAngle, 0.18, 0.7, 0.01],
    },
    canvasSettings: {
      _collapsed: true,
      "width (mm)": [P.canvasWMM, 10, 2000, 1],
      "height (mm)": [P.canvasHMM, 10, 2000, 1],
      paperType: {
        type: "select",
        options: Object.keys(PAPER_SIZES_MM),
        default: P.canvasSizePreset,
      },
      orientation: {
        type: "select",
        options: ["Portrait", "Landscape"],
        default: P.paperOrientation,
      },
      "margin (mm)": [P.marginMM, 0, 80, 1],
      zoom: [P.previewScale, 0.1, 5, 0.1],
      fitView: P.fitToViewport,
    },
    styling: {
      _collapsed: true,
      inkColor: { type: "color", default: P.lineColor },
      "lineweight (mm)": [P.strokeWeightMM, 0.05, 1, 0.05],
      guides: P.showControls,
    },
  };
}

function buildDialValues() {
  const layoutPresets = {
    layoutPreset: P.layoutPreset,
    selectedCell: P.activeInstance,
  };
  if (P.layoutPreset === "Grid") {
    Object.assign(layoutPresets, {
      columns: P.gridColumns,
      rows: P.gridRows,
      "columnGap (mm)": P.gridGapXMM,
      "rowGap (mm)": P.gridGapYMM,
    });
  } else if (P.layoutPreset === "Row" || P.layoutPreset === "Column") {
    Object.assign(layoutPresets, {
      linearVases: P.linearCount,
      "linearGap (mm)": P.linearGapMM,
    });
  } else if (P.layoutPreset === "Radial") {
    Object.assign(layoutPresets, {
      radialVases: P.radialCount,
      "radius (mm)": P.radialRadiusMM,
      "radialCellWidth (mm)": P.radialCellWidthMM,
      "radialCellHeight (mm)": P.radialCellHeightMM,
    });
  } else if (P.layoutPreset === "Page Spaced") {
    Object.assign(layoutPresets, {
      pageVases: P.pageSpacedCount,
      "pageCellWidth (mm)": P.pageCellWidthMM,
      "pageCellHeight (mm)": P.pageCellHeightMM,
      "spacing (mm)": P.pageGapMM,
    });
  }
  return {
    layoutPresets,
    vaseBody: {
      neckWidth: P.neckWidth,
      rimFlareA1: P.rimFlare,
      bellyWidth: P.bellyWidth,
      bulbTopHandleA2: P.a2,
      bulbBottomHandleA3: P.a3,
      shoulderA4: P.a4,
      baseWidth: P.baseWidth,
      bulbPosition: P.bulbHeightRatio,
      locks: {
        lockNeck: P.lock_neckWidth,
        lockFlare: P.lock_rimFlare,
        lockBelly: P.lock_bellyWidth,
        lockTopHandle: P.lock_a2,
        lockBottomHandle: P.lock_a3,
        lockShoulder: P.lock_a4,
        lockBase: P.lock_baseWidth,
        lockBulbPosition: P.lock_bulbHeightRatio,
      },
    },
    proportions: {
      "neckHeight (mm)": P.neckDepth,
      "baseHeight (mm)": P.baseDepth,
      density: P.vaseLines,
    },
    branch: {
      showBranch: P.showBranch,
      seed: P.branchSeed,
      height: P.branchHeightRatio,
      spreadAngle: P.branchAngle,
    },
    canvasSettings: {
      "width (mm)": P.canvasWMM,
      "height (mm)": P.canvasHMM,
      paperType: P.canvasSizePreset,
      orientation: P.paperOrientation,
      "margin (mm)": P.marginMM,
      zoom: P.previewScale,
      fitView: P.fitToViewport,
    },
    styling: {
      inkColor: P.lineColor,
      "lineweight (mm)": P.strokeWeightMM,
      guides: P.showControls,
    },
  };
}

function flattenDialValues(source, prefix = "", result = {}) {
  Object.entries(source || {}).forEach(([key, value]) => {
    const path = prefix ? prefix + "." + key : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenDialValues(value, path, result);
    } else {
      result[path] = value;
    }
  });
  return result;
}

function refreshDialFromP(rebuild = false) {
  if (!dialController) return;
  dialSyncing = true;
  if (rebuild) dialController.updateConfig(buildDialConfig());
  dialController.setValues(buildDialValues());
  dialSyncing = false;
}

function applyDialValues(values) {
  if (dialSyncing) return;
  const flat = flattenDialValues(values);
  const changed = [];
  Object.entries(DIAL_PARAM_PATHS).forEach(([path, param]) => {
    if (!(path in flat) || Object.is(P[param], flat[path])) return;
    P[param] = flat[path];
    changed.push(param);
  });
  if (!changed.length) return;

  if (changed.includes("canvasSizePreset") || changed.includes("paperOrientation")) applyPaperPreset();
  if (changed.includes("activeInstance")) {
    ensureVaseInstances();
    loadActiveVaseGeometry();
  } else if (changed.some(key => VASE_GEOMETRY_KEYS.includes(key))) {
    enforceVaseConstraints(P);
    saveActiveVaseGeometry();
  }

  const layoutKeys = ["layoutPreset", "gridColumns", "gridRows", "linearCount", "radialCount", "pageSpacedCount"];
  const rebuildLayout = changed.some(key => layoutKeys.includes(key));
  if (rebuildLayout) {
    ensureVaseInstances();
    loadActiveVaseGeometry();
  }
  if (changed.some(key => ["canvasWMM", "canvasHMM", "marginMM", "canvasSizePreset", "paperOrientation"].includes(key))) {
    vaseInstances.forEach(instance => enforceVaseConstraints(instance.geometry));
    loadActiveVaseGeometry();
  }

  refreshDialFromP(rebuildLayout);
  syncCanvasSize();
  redraw();
}

function buildPane() {
  if (!globalThis.DialKit) throw new Error("DialKit failed to load");
  dialRoot = DialKit.createDialRoot({
    target: document.getElementById("pane"),
    mode: "inline",
    theme: "dark",
    defaultOpen: true,
    productionEnabled: true,
  });
  dialController = DialKit.createDialKit("Vase Project", buildDialConfig(), {
    id: "vase-project",
    defaultCollapsed: false,
    onAction: action => {
      if (action === "presetsManagement.saveBundle") exportBundle();
      if (action === "presetsManagement.loadJsonPreset") document.getElementById("presetInput")?.click();
    },
  });
  pane = { refresh: () => refreshDialFromP(false) };
  dialController.subscribe(applyDialValues, false);
  refreshDialFromP(false);
}

function hookUI() {
  document.getElementById("randomBtn").addEventListener("click", () => {
    const random = mulberry32(newRandomSeed());
    Object.assign(P, randomControlState(random));
    enforceVaseConstraints(P);
    saveActiveVaseGeometry();
    pane.refresh(); redraw();
  });
  document.getElementById("svgBtn").addEventListener("click", exportBundle);
  
  // Hidden Preset Input
  const inp = document.createElement("input");
  inp.type = "file"; inp.id = "presetInput"; inp.style.display = "none";
  inp.accept = ".json";
  inp.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        Object.keys(data).forEach(k => { if (P.hasOwnProperty(k)) P[k] = data[k]; });
        if (Array.isArray(data.layoutInstances)) {
          const fallback = captureVaseGeometry();
          vaseInstances = data.layoutInstances.slice(0, 36).map(instance => {
            const geometry = instance && typeof instance.geometry === "object"
              ? { ...fallback, ...instance.geometry }
              : { ...fallback };
            enforceVaseConstraints(geometry);
            return { geometry };
          });
        } else {
          vaseInstances = [];
        }
        ensureVaseInstances();
        loadActiveVaseGeometry();
        updateLayoutControlVisibility();
        enforceVaseConstraints(P);
        pane.refresh(); syncCanvasSize(); redraw();
      } catch (err) { console.error("Error loading preset:", err); }
    };
    reader.readAsText(file);
  });
  document.body.appendChild(inp);

  window.addEventListener("resize", () => { syncCanvasSize(); redraw(); });
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (e.repeat && ["r", "s", "g"].includes(key)) return;
    if (key === "r") document.getElementById("randomBtn").click();
    if (key === "s") document.getElementById("svgBtn").click();
    if (key === "g") { P.showControls = !P.showControls; pane.refresh(); redraw(); }
  });
}

function mousePressed() {
  if (!cnv || mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  const xMM = mouseX / getPxPerMM();
  const yMM = mouseY / getPxPerMM();
  const matches = getLayoutItems().filter(({ cell }) => (
    xMM >= cell.x && xMM <= cell.x + cell.width &&
    yMM >= cell.y && yMM <= cell.y + cell.height
  ));
  if (!matches.length) return;
  matches.sort((a, b) => {
    const aDistance = Math.hypot(xMM - a.x, yMM - a.y);
    const bDistance = Math.hypot(xMM - b.x, yMM - b.y);
    return aDistance - bDistance;
  });
  P.activeInstance = matches[0].index + 1;
  loadActiveVaseGeometry();
  pane.refresh();
  redraw();
}

function exportBundle() {
  const ts = Math.floor(Date.now() / 1000);
  const name = `Vase_${ts}`;
  
  // 1. Export SVG immediately
  const svgContent = buildSVGContent();
  downloadText(svgContent, `${name}.svg`, "image/svg+xml");
  
  // 2. Export JSON with a slight delay to bypass security throttling
  setTimeout(() => {
    const preset = {};
    Object.keys(P).forEach(k => { if (!k.startsWith("lock_")) preset[k] = P[k]; });
    preset.layoutInstances = vaseInstances.slice(0, getLayoutCount()).map(instance => ({ ...instance }));
    downloadText(JSON.stringify(preset, null, 2), `${name}.json`, "application/json");
  }, 300);
}

function buildSVGContent() {
  const svg = [];
  const { width: baseW, height: baseH } = getArtworkArea();

  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`);
  svg.push(`<rect width="100%" height="100%" fill="${P.bg}"/>`);

  getLayoutItems().forEach(item => {
    const state = vaseInstances[item.index].geometry;
    const number = item.index + 1;
    const transform = `translate(${fmt(item.x)} ${fmt(item.y)}) scale(${fmt(item.scale)})`;
    const artwork = buildArtworkSVG(0, -baseH / 2, baseW, baseH, state);
    svg.push(`<g id="Vase-${number}" inkscape:groupmode="layer" inkscape:label="Vase ${number}" transform="${transform}" fill="none" stroke="${P.lineColor}" stroke-width="${fmt(P.strokeWeightMM)}" stroke-linecap="round" stroke-linejoin="round">`);
    svg.push(artwork.vase);
    svg.push(`</g>`);
    svg.push(`<g id="Branches-${number}" inkscape:groupmode="layer" inkscape:label="Branches ${number}" transform="${transform}" fill="none" stroke="${P.lineColor}" stroke-width="${fmt(P.strokeWeightMM * 0.7)}" stroke-linecap="round">`);
    svg.push(artwork.branches);
    svg.push(`</g>`);
  });

  svg.push("</svg>");
  return svg.join("\n");
}

function buildArtworkSVG(centerX, artTop, usableW, usableH, state) {
  const vase = [];
  const branches = [];
  const plantH = state.showBranch ? usableH * state.branchHeightRatio : 0;
  const vaseH = usableH - plantH;
  const vaseY = artTop + plantH;
  const { neckDepth: mH, baseDepth: bH, bellyY } = getVaseVerticalGeometry(vaseH, state);
  const pts = [{ py: 0 }, { py: mH }, { py: mH }, { py: vaseH - bH }, { py: vaseH - bH }, { py: vaseH }];
  const mw = (usableW * 0.9) / 1.5;
  const clamp = value => Math.max(-mw, Math.min(mw, value));

  for (let j = 0; j <= state.vaseLines; j++) {
    const factor = -1 + (2 * j / state.vaseLines);
    const gap = mw * factor;
    const x = multiplier => centerX + clamp(gap * multiplier);
    let d = `M ${fmt(x(state.neckWidth))} ${fmt(vaseY + pts[0].py)} L ${fmt(x(state.neckWidth))} ${fmt(vaseY + pts[1].py)}`;
    d += ` C ${fmt(x(state.rimFlare))} ${fmt(vaseY + pts[1].py)}, ${fmt(x(state.a2))} ${fmt(vaseY + bellyY)}, ${fmt(x(state.bellyWidth))} ${fmt(vaseY + bellyY)}`;
    d += ` C ${fmt(x(state.a3))} ${fmt(vaseY + bellyY)}, ${fmt(x(state.a4))} ${fmt(vaseY + pts[4].py)}, ${fmt(x(state.baseWidth))} ${fmt(vaseY + pts[4].py)}`;
    d += ` L ${fmt(x(state.baseWidth))} ${fmt(vaseY + pts[4].py)} L ${fmt(x(state.baseWidth))} ${fmt(vaseY + pts[5].py)}`;
    vase.push(`<path d="${d}"/>`);
  }

  if (state.showBranch) {
    const rng = mulberry32(state.branchSeed);
    const recurse = (sx, sy, angle, blen) => {
      const step = blen * 0.4;
      const ex = sx + Math.sin(angle) * step;
      const ey = sy - Math.cos(angle) * step;
      branches.push(`<line x1="${fmt(sx)}" y1="${fmt(sy)}" x2="${fmt(ex)}" y2="${fmt(ey)}"/>`);
      if (blen > 15) {
        recurse(ex, ey, angle + state.branchAngle * (rng() * 0.8 + 0.6), blen * 0.65);
        recurse(ex, ey, angle - state.branchAngle * (rng() * 0.8 + 0.6), blen * 0.55);
      } else {
        branches.push(`<circle cx="${fmt(ex)}" cy="${fmt(ey)}" r="0.75" fill="${P.lineColor}" stroke="none"/>`);
      }
    };
    recurse(centerX, artTop + plantH, 0, plantH);
  }

  return { vase: vase.join("\n"), branches: branches.join("\n") };
}

function getPxPerMM() { return P.dpi / MM_PER_INCH; }
function mmToPx(mm) { return Math.max(1, Math.round(mm * getPxPerMM())); }
function getCanvasPixelSize() { return { width: mmToPx(P.canvasWMM), height: mmToPx(P.canvasHMM) }; }
function syncCanvasSize() {
  const size = getCanvasPixelSize();
  if (width !== size.width || height !== size.height) resizeCanvas(size.width, size.height, true);
  updateCanvasDisplaySize();
}
function updateCanvasDisplaySize() {
  const main = document.getElementById("main");
  if (!main) return;
  const rect = main.getBoundingClientRect();
  const pxSize = getCanvasPixelSize();
  const fitScale = Math.min((rect.width - 60) / pxSize.width, (rect.height - 60) / pxSize.height);
  const scale = P.fitToViewport ? fitScale : P.previewScale;
  if (cnv) {
    cnv.elt.style.width = `${Math.round(pxSize.width * scale)}px`;
    cnv.elt.style.height = `${Math.round(pxSize.height * scale)}px`;
  }
}
function fmt(value) { return Number(value).toFixed(3).replace(/\.?0+$/, ""); }

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
