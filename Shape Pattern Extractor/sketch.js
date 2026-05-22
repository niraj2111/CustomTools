const SOURCE_SIZE = 320;
const MAX_COMPONENTS = 48;
const MAX_PATTERN_PATHS = 2400;
const MAX_PATH_POINTS = 240;

let pane;
let cnv;
let sourceCanvas;
let sourceCtx;
let redrawTimer = null;
let rebuildTimer = null;
let sourceStroke = null;
let veinPatternBlades = [];
let rootPatternBlades = [];

const scene = {
  components: [],
  outlinePathsMM: [],
  patternPathsMM: [],
};

const P = {
  canvasWMM: 210,
  canvasHMM: 297,
  paperPreset: "A4 Portrait",
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 16,
  bg: "#f4f6f9",
  paperColor: "#ffffff",
  patternColor: "#17202b",
  outlineColor: "#93a1b3",
  sourceBoxColor: "#cfd8e3",
  patternStrokeMM: 0.35,
  outlineStrokeMM: 0.18,
  brushSizePx: 18,
  brushMode: "paint",
  threshold: 0.48,
  invert: false,
  analysisCols: 140,
  minComponentCells: 22,
  simplifyTolerance: 0.0015,
  showOutlines: true,
  showBounds: false,
  showSourceGuide: true,
  seed: 1,
  patternPreset: "veins",
  veinSpacingMM: 8,
  veinSpacingJitter: 0.45,
  veinDensity: 1,
  veinForwardThreshold: 0.15,
  veinForwardPull: 0.18,
  veinLateralPenalty: 0.6,
  veinRootBias: 0.04,
  veinTipBias: 0.3,
  veinForwardBias: 0.22,
  veinCurve: 0.32,
  veinCurveJitter: 0.35,
  rootSpacingMM: 18,
  rootTrunkCurve: 0.18,
  rootBranchCurve: 0.26,
  rootBaseCount: 1,
  rootBranchSpreadDeg: 26,
  rootHierarchyBias: 0.42,
  rootMinSplitSpanMM: 22,
  rootMaxDepth: 5,
  rootContactInsetMM: 1.2,
  rootNoiseMM: 7,
  svgFilename: "Shape-Pattern-Extractor.svg",
};

function setup() {
  const size = PaperUtils.getCanvasPixelSize(P);
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  cnv.style("display", "block");
  pixelDensity(1);
  noLoop();

  initSourcePad();
  buildPane();
  hookUI();
  PaperUtils.applyPaperPreset(P, P.paperPreset);
  syncCanvasSize();
  clearSourcePad();
  rebuildScene();
}

function draw() {
  background(P.bg);

  push();
  scale(PaperUtils.getPxPerMM(P));
  drawPaper();
  if (P.showSourceGuide) {
    drawSourceGuide();
  }
  if (P.showOutlines) {
    drawOutlinePaths();
  }
  drawPatternPaths();
  pop();
}

function windowResized() {
  updateCanvasDisplaySize();
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Shape Pattern Extractor",
  });

  const canvasFolder = pane.addFolder({ title: "Canvas (mm)" });
  canvasFolder
    .addInput(P, "paperPreset", {
      options: Object.keys(PaperUtils.PAPER_PRESETS_MM).reduce((acc, label) => {
        acc[label] = label;
        return acc;
      }, {}),
      label: "Paper",
    })
    .on("change", (ev) => {
      PaperUtils.applyPaperPreset(P, ev.value);
      pane.refresh();
      syncCanvasSize();
      requestRebuild();
    });
  canvasFolder
    .addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      requestRebuild();
    });
  canvasFolder
    .addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      requestRebuild();
    });
  canvasFolder.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" }).on("change", () => {
    syncCanvasSize();
    redrawScene();
  });
  canvasFolder
    .addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" })
    .on("change", updateCanvasDisplaySize);
  canvasFolder.addInput(P, "fitToViewport", { label: "Fit View" }).on("change", updateCanvasDisplaySize);
  canvasFolder
    .addInput(P, "marginMM", { min: 0, max: 80, step: 0.5, label: "Margin" })
    .on("change", requestRebuild);

  const sourceFolder = pane.addFolder({ title: "Source" });
  sourceFolder
    .addInput(P, "brushSizePx", { min: 2, max: 80, step: 1, label: "Brush" })
    .on("change", redrawSourcePadCursor);
  sourceFolder
    .addInput(P, "brushMode", {
      options: { paint: "paint", erase: "erase" },
      label: "Mode",
    })
    .on("change", redrawSourcePadCursor);

  const extractFolder = pane.addFolder({ title: "Extract" });
  extractFolder.addInput(P, "threshold", { min: 0.01, max: 0.99, step: 0.01, label: "Threshold" }).on("change", requestRebuild);
  extractFolder.addInput(P, "invert", { label: "Invert" }).on("change", requestRebuild);
  extractFolder
    .addInput(P, "analysisCols", { min: 32, max: 260, step: 1, label: "Resolution" })
    .on("change", requestRebuild);
  extractFolder
    .addInput(P, "minComponentCells", { min: 1, max: 1000, step: 1, label: "Min Cells" })
    .on("change", requestRebuild);
  extractFolder
    .addInput(P, "simplifyTolerance", { min: 0, max: 0.02, step: 0.0005, label: "Simplify" })
    .on("change", requestRebuild);

  const patternFolder = pane.addFolder({ title: "Pattern" });
  patternFolder
    .addInput(P, "patternPreset", { options: { veins: "veins", roots: "roots" }, label: "Type" })
    .on("change", () => {
      updatePatternControlVisibility();
      requestRebuild();
    });
  patternFolder.addInput(P, "seed", { min: 1, max: 999999, step: 1, label: "Seed" }).on("change", requestRebuild);
  veinPatternBlades = [
    patternFolder.addInput(P, "veinSpacingMM", { min: 2, max: 40, step: 0.25, label: "Spacing" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinSpacingJitter", { min: 0, max: 1.2, step: 0.01, label: "Spacing Var" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinDensity", { min: 0.25, max: 3, step: 0.01, label: "Density" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinForwardThreshold", { min: 0.02, max: 0.8, step: 0.01, label: "Forward Min" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinForwardPull", { min: 0, max: 1.2, step: 0.01, label: "Forward Pull" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinLateralPenalty", { min: 0, max: 2.5, step: 0.01, label: "Lateral Pen" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinRootBias", { min: -0.5, max: 0.5, step: 0.01, label: "Root Bias" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinTipBias", { min: -0.5, max: 1.5, step: 0.01, label: "Tip Bias" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinForwardBias", { min: 0, max: 0.8, step: 0.01, label: "Forward Bend" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinCurve", { min: 0, max: 0.8, step: 0.01, label: "Curve" }).on("change", requestRebuild),
    patternFolder.addInput(P, "veinCurveJitter", { min: 0, max: 1, step: 0.01, label: "Curve Var" }).on("change", requestRebuild),
  ];
  rootPatternBlades = [
    patternFolder.addInput(P, "rootSpacingMM", { min: 4, max: 80, step: 0.5, label: "Root Gap" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootTrunkCurve", { min: 0, max: 0.8, step: 0.01, label: "Trunk Curve" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootBranchCurve", { min: 0, max: 0.8, step: 0.01, label: "Branch Curve" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootBaseCount", { min: 1, max: 8, step: 1, label: "Base Count" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootBranchSpreadDeg", { min: 4, max: 70, step: 1, label: "Branch Spread" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootHierarchyBias", { min: 0, max: 1, step: 0.01, label: "Hierarchy" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootMinSplitSpanMM", { min: 4, max: 80, step: 0.5, label: "Split Span" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootMaxDepth", { min: 1, max: 8, step: 1, label: "Max Depth" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootContactInsetMM", { min: 0, max: 10, step: 0.1, label: "Contact Inset" }).on("change", requestRebuild),
    patternFolder.addInput(P, "rootNoiseMM", { min: 0, max: 24, step: 0.25, label: "Noise" }).on("change", requestRebuild),
  ];
  updatePatternControlVisibility();

  const styleFolder = pane.addFolder({ title: "Style" });
  styleFolder.addInput(P, "bg", { label: "BG" }).on("change", redrawScene);
  styleFolder.addInput(P, "paperColor", { label: "Paper" }).on("change", redrawScene);
  styleFolder.addInput(P, "patternColor", { label: "Pattern" }).on("change", redrawScene);
  styleFolder.addInput(P, "outlineColor", { label: "Outline" }).on("change", redrawScene);
  styleFolder.addInput(P, "sourceBoxColor", { label: "Guide" }).on("change", redrawScene);
  styleFolder
    .addInput(P, "patternStrokeMM", { min: 0.05, max: 3, step: 0.01, label: "Pattern W" })
    .on("change", redrawScene);
  styleFolder
    .addInput(P, "outlineStrokeMM", { min: 0.05, max: 2, step: 0.01, label: "Outline W" })
    .on("change", redrawScene);
  styleFolder.addInput(P, "showOutlines", { label: "Show Shapes" }).on("change", redrawScene);
  styleFolder.addInput(P, "showBounds", { label: "Show Bounds" }).on("change", redrawScene);
  styleFolder.addInput(P, "showSourceGuide", { label: "Show Guide" }).on("change", redrawScene);

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgFilename", { label: "Filename" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });
}

function hookUI() {
  document.getElementById("analyzeBtn").addEventListener("click", rebuildScene);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  document.getElementById("loadBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("clearSourceBtn").addEventListener("click", () => {
    clearSourcePad();
    requestRebuild();
  });
  document.getElementById("fileInput").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      loadSourceImageFile(file);
    }
    event.target.value = "";
  });
  window.addEventListener("resize", updateCanvasDisplaySize);
}

function updatePatternControlVisibility() {
  const showVeins = P.patternPreset === "veins";
  for (const blade of veinPatternBlades) {
    blade.hidden = !showVeins;
  }
  for (const blade of rootPatternBlades) {
    blade.hidden = showVeins;
  }
}

function initSourcePad() {
  sourceCanvas = document.getElementById("sourcePad");
  sourceCtx = sourceCanvas.getContext("2d");
  sourceCanvas.addEventListener("pointerdown", onSourcePointerDown);
  sourceCanvas.addEventListener("pointermove", onSourcePointerMove);
  sourceCanvas.addEventListener("pointerup", onSourcePointerUp);
  sourceCanvas.addEventListener("pointerleave", onSourcePointerUp);
  sourceCanvas.addEventListener("dragenter", (event) => {
    event.preventDefault();
    sourceCanvas.classList.add("dragover");
  });
  sourceCanvas.addEventListener("dragover", (event) => {
    event.preventDefault();
    sourceCanvas.classList.add("dragover");
  });
  sourceCanvas.addEventListener("dragleave", () => {
    sourceCanvas.classList.remove("dragover");
  });
  sourceCanvas.addEventListener("drop", (event) => {
    event.preventDefault();
    sourceCanvas.classList.remove("dragover");
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      loadSourceImageFile(file);
    }
  });
}

function syncCanvasSize() {
  PaperUtils.syncCanvasSize(cnv, P, resizeCanvas, "wrap", 28);
}

function updateCanvasDisplaySize() {
  PaperUtils.updateCanvasDisplaySize(cnv, P, "wrap", 28);
}

function requestRebuild() {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildScene();
  }, 60);
}

function requestRedraw() {
  if (redrawTimer) {
    clearTimeout(redrawTimer);
  }

  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    redrawScene();
  }, 20);
}

function redrawScene() {
  redraw();
}

function clearSourcePad() {
  sourceCtx.save();
  sourceCtx.fillStyle = "#ffffff";
  sourceCtx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  sourceCtx.restore();
  redrawSourcePadCursor();
}

function redrawSourcePadCursor() {
  sourceCanvas.style.cursor = P.brushMode === "erase" ? "cell" : "crosshair";
}

function onSourcePointerDown(event) {
  sourceCanvas.setPointerCapture(event.pointerId);
  const point = getSourcePointerPoint(event);
  sourceStroke = {
    prev: point,
  };
  stampSourceBrush(point);
  requestRebuild();
}

function onSourcePointerMove(event) {
  if (!sourceStroke) {
    return;
  }

  const point = getSourcePointerPoint(event);
  drawSourceBrushLine(sourceStroke.prev, point);
  sourceStroke.prev = point;
  requestRebuild();
}

function onSourcePointerUp() {
  sourceStroke = null;
}

function getSourcePointerPoint(event) {
  const rect = sourceCanvas.getBoundingClientRect();
  const scaleX = sourceCanvas.width / rect.width;
  const scaleY = sourceCanvas.height / rect.height;
  return {
    x: constrain((event.clientX - rect.left) * scaleX, 0, sourceCanvas.width),
    y: constrain((event.clientY - rect.top) * scaleY, 0, sourceCanvas.height),
  };
}

function stampSourceBrush(point) {
  sourceCtx.save();
  sourceCtx.fillStyle = P.brushMode === "erase" ? "#ffffff" : "#000000";
  sourceCtx.beginPath();
  sourceCtx.arc(point.x, point.y, Math.max(1, P.brushSizePx * 0.5), 0, Math.PI * 2);
  sourceCtx.fill();
  sourceCtx.restore();
}

function drawSourceBrushLine(a, b) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, P.brushSizePx * 0.25)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    stampSourceBrush({
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
    });
  }
}

function loadSourceImageFile(file) {
  const url = URL.createObjectURL(file);
  loadImage(
    url,
    (img) => {
      sourceCtx.save();
      sourceCtx.fillStyle = "#ffffff";
      sourceCtx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
      const scale = Math.min(SOURCE_SIZE / img.width, SOURCE_SIZE / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const x = (SOURCE_SIZE - drawW) * 0.5;
      const y = (SOURCE_SIZE - drawH) * 0.5;
      sourceCtx.drawImage(img.canvas || img.elt || img, x, y, drawW, drawH);
      sourceCtx.restore();
      URL.revokeObjectURL(url);
      requestRebuild();
    },
    () => {
      URL.revokeObjectURL(url);
    }
  );
}

function rebuildScene() {
  randomSeed(P.seed);
  noiseSeed(P.seed);
  analyzeSourceComponents();
  buildOutputGeometry();
  redrawScene();
}

function analyzeSourceComponents() {
  const imageData = sourceCtx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  const cols = Math.max(16, Math.floor(P.analysisCols));
  const rows = cols;
  const occupancy = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const sampleX = Math.min(SOURCE_SIZE - 1, Math.floor(((col + 0.5) / cols) * SOURCE_SIZE));
      const sampleY = Math.min(SOURCE_SIZE - 1, Math.floor(((row + 0.5) / rows) * SOURCE_SIZE));
      const pixelIndex = (sampleY * SOURCE_SIZE + sampleX) * 4;
      const r = imageData.data[pixelIndex];
      const g = imageData.data[pixelIndex + 1];
      const b = imageData.data[pixelIndex + 2];
      const a = imageData.data[pixelIndex + 3] / 255;
      const luminance = ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * a + (1 - a);
      let signal = 1 - luminance;
      if (P.invert) {
        signal = 1 - signal;
      }
      occupancy[row * cols + col] = signal >= P.threshold ? 1 : 0;
    }
  }

  scene.components = extractComponents(occupancy, cols, rows);
}

function extractComponents(occupancy, cols, rows) {
  const visited = new Uint8Array(cols * rows);
  const components = [];
  const minCells = Math.max(1, Math.floor(P.minComponentCells));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const startIndex = row * cols + col;
      if (!occupancy[startIndex] || visited[startIndex]) {
        continue;
      }

      const queue = [startIndex];
      const cellIndices = [];
      visited[startIndex] = 1;

      while (queue.length > 0) {
        const index = queue.pop();
        cellIndices.push(index);
        const x = index % cols;
        const y = Math.floor(index / cols);
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
            continue;
          }
          const nextIndex = ny * cols + nx;
          if (!occupancy[nextIndex] || visited[nextIndex]) {
            continue;
          }
          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }

      if (cellIndices.length < minCells) {
        continue;
      }

      components.push(buildComponent(cellIndices, cols, rows));
      if (components.length >= MAX_COMPONENTS) {
        return components;
      }
    }
  }

  return components;
}

function buildComponent(cellIndices, cols, rows) {
  const cellSet = new Set(cellIndices);
  let sumX = 0;
  let sumY = 0;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;

  for (const index of cellIndices) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const centerX = (col + 0.5) / cols;
    const centerY = (row + 0.5) / rows;
    sumX += centerX;
    sumY += centerY;
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }

  const centroid = {
    x: sumX / cellIndices.length,
    y: sumY / cellIndices.length,
  };
  const axis = getPrincipalAxis(cellIndices, cols, rows, centroid);
  const outlinePaths = buildComponentOutlinePaths(cellSet, cols, rows);

  return {
    cols,
    rows,
    cellIndices,
    cellSet,
    centroid,
    minCol,
    maxCol,
    minRow,
    maxRow,
    axis,
    outlinePaths,
  };
}

function getPrincipalAxis(cellIndices, cols, rows, centroid) {
  let covXX = 0;
  let covYY = 0;
  let covXY = 0;

  for (const index of cellIndices) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = (col + 0.5) / cols - centroid.x;
    const y = (row + 0.5) / rows - centroid.y;
    covXX += x * x;
    covYY += y * y;
    covXY += x * y;
  }

  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const major = normalizeVector(Math.cos(angle), Math.sin(angle));
  return {
    major,
    minor: { x: -major.y, y: major.x },
  };
}

function buildComponentOutlinePaths(cellSet, cols, rows) {
  const adjacency = new Map();

  function addEdge(a, b) {
    const aKey = `${a.x},${a.y}`;
    const bKey = `${b.x},${b.y}`;
    if (!adjacency.has(aKey)) {
      adjacency.set(aKey, []);
    }
    if (!adjacency.has(bKey)) {
      adjacency.set(bKey, []);
    }
    adjacency.get(aKey).push(b);
    adjacency.get(bKey).push(a);
  }

  for (const index of cellSet) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = row * cols + (col - 1);
    const right = row * cols + (col + 1);
    const top = (row - 1) * cols + col;
    const bottom = (row + 1) * cols + col;

    if (col === 0 || !cellSet.has(left)) {
      addEdge({ x: col / cols, y: row / rows }, { x: col / cols, y: (row + 1) / rows });
    }
    if (col === cols - 1 || !cellSet.has(right)) {
      addEdge({ x: (col + 1) / cols, y: row / rows }, { x: (col + 1) / cols, y: (row + 1) / rows });
    }
    if (row === 0 || !cellSet.has(top)) {
      addEdge({ x: col / cols, y: row / rows }, { x: (col + 1) / cols, y: row / rows });
    }
    if (row === rows - 1 || !cellSet.has(bottom)) {
      addEdge({ x: col / cols, y: (row + 1) / rows }, { x: (col + 1) / cols, y: (row + 1) / rows });
    }
  }

  const visited = new Set();
  const loops = [];

  for (const [startKey, neighbors] of adjacency.entries()) {
    for (const next of neighbors) {
      const edgeKey = makeUndirectedEdgeKey(parsePointKey(startKey), next);
      if (visited.has(edgeKey)) {
        continue;
      }

      const loop = [];
      let current = parsePointKey(startKey);
      let previous = null;

      while (true) {
        loop.push({ x: current.x, y: current.y });
        const currentKey = `${current.x},${current.y}`;
        const options = (adjacency.get(currentKey) || []).filter((candidate) => {
          if (!previous) {
            return true;
          }
          return !(nearlyEqual(candidate.x, previous.x) && nearlyEqual(candidate.y, previous.y));
        });

        if (options.length === 0) {
          break;
        }

        let nextPoint = options[0];
        if (options.length > 1) {
          nextPoint = chooseClockwiseEdge(previous, current, options);
        }

        visited.add(makeUndirectedEdgeKey(current, nextPoint));
        previous = current;
        current = nextPoint;

        if (nearlyEqual(current.x, loop[0].x) && nearlyEqual(current.y, loop[0].y)) {
          break;
        }
      }

      if (loop.length >= 3) {
        loops.push(simplifyClosedPath(loop, P.simplifyTolerance));
      }
    }
  }

  return loops;
}

function chooseClockwiseEdge(previous, current, options) {
  if (!previous) {
    return options[0];
  }

  const incomingAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
  let best = options[0];
  let bestDelta = Infinity;

  for (const option of options) {
    const angle = Math.atan2(option.y - current.y, option.x - current.x);
    let delta = angle - incomingAngle;
    while (delta <= 0) {
      delta += Math.PI * 2;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = option;
    }
  }

  return best;
}

function buildOutputGeometry() {
  scene.outlinePathsMM = [];
  scene.patternPathsMM = [];

  const mapper = getSourceToPaperMapper();
  const componentPatterns = [];
  for (const component of scene.components) {
    for (const loop of component.outlinePaths) {
      const mmLoop = loop.map((point) => mapSourcePointToMM(point, mapper));
      if (mmLoop.length >= 3) {
        scene.outlinePathsMM.push(mmLoop);
      }
    }
  }

  if (P.patternPreset === "roots") {
    componentPatterns.push(...buildRootGraphPattern(scene.components, mapper));
  } else {
    for (const component of scene.components) {
      componentPatterns.push(...buildVeinPatternForComponent(component, mapper));
    }
  }

  for (const path of componentPatterns) {
    if (path.length < 2) {
      continue;
    }
    scene.patternPathsMM.push(path);
    if (scene.patternPathsMM.length >= MAX_PATTERN_PATHS) {
      return;
    }
  }
}

function getSourceToPaperMapper() {
  const innerW = Math.max(1, P.canvasWMM - P.marginMM * 2);
  const innerH = Math.max(1, P.canvasHMM - P.marginMM * 2);
  const size = Math.min(innerW, innerH);
  return {
    scaleMM: size,
    offsetXMM: P.marginMM + (innerW - size) * 0.5,
    offsetYMM: P.marginMM + (innerH - size) * 0.5,
    sizeMM: size,
  };
}

function mapSourcePointToMM(point, mapper) {
  return {
    x: mapper.offsetXMM + point.x * mapper.scaleMM,
    y: mapper.offsetYMM + point.y * mapper.scaleMM,
  };
}

function buildVeinPatternForComponent(component, mapper) {
  const result = [];
  const centroid = component.centroid;
  const major = component.axis.major;
  const minor = component.axis.minor;

  const positive = rayDistanceInMask(component, centroid, major, 0.01, 2);
  const negative = rayDistanceInMask(component, centroid, { x: -major.x, y: -major.y }, 0.01, 2);
  if (positive <= 0.001 || negative <= 0.001) {
    return result;
  }

  const trunkStart = {
    x: centroid.x - major.x * negative * 0.94,
    y: centroid.y - major.y * negative * 0.94,
  };
  const trunkEnd = {
    x: centroid.x + major.x * positive * 0.94,
    y: centroid.y + major.y * positive * 0.94,
  };
  const trunkLengthMM = Math.hypot(trunkEnd.x - trunkStart.x, trunkEnd.y - trunkStart.y) * mapper.scaleMM;
  const root = copyPoint(trunkStart);
  const tip = copyPoint(trunkEnd);
  const spacingNorm = Math.max(0.004, P.veinSpacingMM / mapper.scaleMM);
  const sampleSpacingNorm = spacingNorm / Math.max(0.25, P.veinDensity);
  const poissonPoints = samplePoissonPointsInComponent(
    component,
    sampleSpacingNorm * 0.8,
    Math.floor(P.seed + component.cellIndices.length * 17)
  );

  const nodes = [
    { point: root, kind: "root" },
    { point: tip, kind: "tip" },
    ...poissonPoints.map((point) => ({ point, kind: "sample" })),
  ];

  const rootProjection = dot2(root, major);
  const sortedNodes = nodes
    .map((node) => ({
      ...node,
      projection: dot2(node.point, major) - rootProjection,
      lateral: dot2(
        {
          x: node.point.x - centroid.x,
          y: node.point.y - centroid.y,
        },
        minor
      ),
    }))
    .sort((a, b) => a.projection - b.projection);

  const built = [sortedNodes[0]];
  for (let i = 1; i < sortedNodes.length; i += 1) {
    const node = sortedNodes[i];
    let bestParent = built[0];
    let bestScore = Infinity;

    for (const candidate of built) {
      const forwardDelta = node.projection - candidate.projection;
      if (forwardDelta <= spacingNorm * P.veinForwardThreshold) {
        continue;
      }

      const dx = node.point.x - candidate.point.x;
      const dy = node.point.y - candidate.point.y;
      const distance = Math.hypot(dx, dy);
      const lateralDelta = Math.abs(node.lateral - candidate.lateral);
      const score =
        distance +
        lateralDelta * P.veinLateralPenalty -
        forwardDelta * P.veinForwardPull +
        (candidate.kind === "root" ? P.veinRootBias : 0) +
        (candidate.kind === "tip" ? P.veinTipBias : 0);

      if (score < bestScore) {
        bestScore = score;
        bestParent = candidate;
      }
    }

    const edge = buildVeinNetworkEdge(bestParent.point, node.point, centroid, major, mapper);
    if (edge.length >= 2) {
      result.push(edge);
    }
    built.push(node);
  }

  return result;
}

function buildRootGraphPattern(components, mapper) {
  const result = [];
  if (!components || components.length === 0) {
    return result;
  }

  const sorted = components
    .map((component, index) => ({
      component,
      index,
      anchor: getRootContactPoint(component, mapper),
    }))
    .filter((entry) => entry.anchor)
    .sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);

  if (sorted.length === 0) {
    return result;
  }

  const obstacles = sorted.map((entry) => buildRootObstacle(entry.component, mapper));
  const rootXs = sampleRootBaseXs(mapper, sorted.length, Math.max(1, Math.floor(P.rootBaseCount)));
  const baseNodes = rootXs.map((x) => ({ x, y: P.canvasHMM - P.marginMM }));
  for (let i = 1; i < baseNodes.length; i += 1) {
    result.push(buildOrganicGraphPath(baseNodes[i - 1], baseNodes[i], P.rootNoiseMM * 0.16, i * 0.51, obstacles));
  }

  const groups = baseNodes.map((base) => ({ base, entries: [] }));
  for (const entry of sorted) {
    const nearest = chooseNearestRootNode(baseNodes, entry.anchor.x);
    const group = groups[baseNodes.indexOf(nearest)];
    group.entries.push(entry);
  }

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (group.entries.length === 0) {
      continue;
    }
    group.entries.sort((a, b) => a.anchor.x - b.anchor.x);
    const tree = buildRootHierarchy(group.entries, 0);
    const trunkPoint = getInternalRootNodePoint(group.base, tree, 0, 1, 0);
    const trunkPath = buildLSystemLikeBranch(group.base, trunkPoint, 0, i * 0.83 + 1.7, true, obstacles);
    if (trunkPath.length >= 2) {
      result.push(trunkPath);
    }
    renderRootHierarchy(tree, trunkPoint, result, i, 1, obstacles);
  }

  return result.filter((path) => path.length >= 2);
}

function buildRootHierarchy(entries, depth) {
  const centroid = getAnchorCentroid(entries);
  if (entries.length <= 1 || depth >= Math.max(1, Math.floor(P.rootMaxDepth))) {
    return {
      entries,
      centroid,
      depth,
      children: [],
      isLeaf: true,
      anchor: entries[0].anchor,
    };
  }

  const minX = entries[0].anchor.x;
  const maxX = entries[entries.length - 1].anchor.x;
  const span = maxX - minX;
  if (span < P.rootMinSplitSpanMM) {
    if (entries.length === 2) {
      return {
        entries,
        centroid,
        depth,
        isLeaf: false,
        children: entries.map((entry) => ({
          entries: [entry],
          centroid: copyPoint(entry.anchor),
          depth: depth + 1,
          children: [],
          isLeaf: true,
          anchor: entry.anchor,
        })),
      };
    }
    return {
      entries,
      centroid,
      depth,
      children: [],
      isLeaf: true,
      anchor: centroid,
    };
  }

  const splitIndex = chooseRootSplitIndex(entries);
  const leftEntries = entries.slice(0, splitIndex);
  const rightEntries = entries.slice(splitIndex);
  if (leftEntries.length === 0 || rightEntries.length === 0) {
    return {
      entries,
      centroid,
      depth,
      children: [],
      isLeaf: true,
      anchor: centroid,
    };
  }

  return {
    entries,
    centroid,
    depth,
    isLeaf: false,
    children: [
      buildRootHierarchy(leftEntries, depth + 1),
      buildRootHierarchy(rightEntries, depth + 1),
    ],
  };
}

function chooseRootSplitIndex(entries) {
  if (entries.length <= 2) {
    return 1;
  }

  let bestIndex = Math.floor(entries.length * 0.5);
  let bestGap = -Infinity;
  for (let i = 1; i < entries.length; i += 1) {
    const gap = entries[i].anchor.x - entries[i - 1].anchor.x;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return constrain(bestIndex, 1, entries.length - 1);
}

function renderRootHierarchy(node, parentPoint, result, seedIndex, depth, obstacles) {
  if (!node) {
    return;
  }

  if (node.isLeaf) {
    const approach = getLeafApproachPoint(parentPoint, node.anchor, depth);
    const trunk = buildLSystemLikeBranch(parentPoint, approach, depth, seedIndex * 1.31 + depth * 0.19, false, obstacles);
    const twig = buildLSystemLikeBranch(approach, node.anchor, depth + 1, seedIndex * 1.91 + depth * 0.27, false, obstacles);
    if (trunk.length >= 2) {
      result.push(trunk);
    }
    if (twig.length >= 2) {
      result.push(twig);
    }
    return;
  }

  const childCount = node.children.length;
  for (let i = 0; i < childCount; i += 1) {
    const child = node.children[i];
    const childPoint = child.isLeaf
      ? getLeafApproachPoint(parentPoint, child.anchor, depth)
      : getInternalRootNodePoint(parentPoint, child, i, childCount, depth);
    const branch = buildLSystemLikeBranch(
      parentPoint,
      childPoint,
      depth,
      seedIndex * 1.17 + i * 0.71 + depth * 0.13,
      false,
      obstacles
    );
    if (branch.length >= 2) {
      result.push(branch);
    }
    renderRootHierarchy(child, childPoint, result, seedIndex + i + 1, depth + 1, obstacles);
  }
}

function getInternalRootNodePoint(parentPoint, node, siblingIndex, siblingCount, depth) {
  const target = node.centroid;
  const upwardDistance = Math.max(6, (parentPoint.y - target.y) * (0.12 + P.rootHierarchyBias * 0.18));
  const basePoint = {
    x: lerp(parentPoint.x, target.x, 0.14 + P.rootHierarchyBias * 0.16),
    y: Math.max(P.marginMM, parentPoint.y - upwardDistance),
  };
  const sideT = siblingCount <= 1 ? 0 : siblingIndex / (siblingCount - 1) - 0.5;
  const spread = Math.tan(radians(P.rootBranchSpreadDeg)) * upwardDistance * 0.22;
  return {
    x: basePoint.x + sideT * spread,
    y: Math.min(basePoint.y, parentPoint.y - 2),
  };
}

function getLeafApproachPoint(parentPoint, anchor, depth) {
  const lift = Math.max(4, (parentPoint.y - anchor.y) * (0.08 + P.rootHierarchyBias * 0.1));
  return {
    x: lerp(parentPoint.x, anchor.x, 0.22 + P.rootHierarchyBias * 0.08),
    y: Math.min(Math.max(P.marginMM, anchor.y + lift), parentPoint.y - 1.5),
  };
}

function buildRootBranchCluster(origin, entries, result, seedIndex, depth, obstacles) {
  if (!entries || entries.length === 0) {
    return;
  }

  const minX = entries[0].anchor.x;
  const maxX = entries[entries.length - 1].anchor.x;
  const span = maxX - minX;
  if (entries.length === 1) {
    const entry = entries[0];
    const target = entry.anchor;
    const lift = Math.max(5, (origin.y - target.y) * (0.12 + P.rootHierarchyBias * 0.12));
    const intermediate = {
      x: lerp(origin.x, target.x, 0.22 + P.rootHierarchyBias * 0.14),
      y: Math.max(P.marginMM, target.y + lift),
    };
    const trunk = buildLSystemLikeBranch(origin, intermediate, depth, seedIndex * 1.29 + depth * 0.23, true, obstacles);
    const twig = buildLSystemLikeBranch(intermediate, target, depth + 1, seedIndex * 1.71 + depth * 0.41, false, obstacles);
    if (trunk.length >= 2) {
      result.push(trunk);
    }
    if (twig.length >= 2) {
      result.push(twig);
    }
    return;
  }

  if (span < P.rootMinSplitSpanMM || depth >= Math.max(1, Math.floor(P.rootMaxDepth))) {
    for (let i = 0; i < entries.length; i += 1) {
      buildRootBranchCluster(origin, [entries[i]], result, seedIndex * 3.1 + i * 0.77, depth + 1, obstacles);
    }
    return;
  }

  const mid = Math.floor(entries.length * 0.5);
  const leftEntries = entries.slice(0, mid);
  const rightEntries = entries.slice(mid);
  const splitTarget = getAnchorCentroid(entries);
  const verticalLift = Math.max(7, (origin.y - splitTarget.y) * (0.16 + P.rootHierarchyBias * 0.22));
  const splitNode = {
    x: lerp(origin.x, splitTarget.x, 0.14 + P.rootHierarchyBias * 0.18),
    y: Math.max(P.marginMM, origin.y - verticalLift),
  };

  const trunkPath = buildLSystemLikeBranch(origin, splitNode, depth, seedIndex * 0.97 + 1.1, true, obstacles);
  if (trunkPath.length >= 2) {
    result.push(trunkPath);
  }

  const spreadRad = radians(P.rootBranchSpreadDeg);
  const leftTarget = getAnchorCentroid(leftEntries);
  const rightTarget = getAnchorCentroid(rightEntries);
  const leftNode = offsetSplitNode(splitNode, leftTarget, -spreadRad * (0.55 + depth * 0.08));
  const rightNode = offsetSplitNode(splitNode, rightTarget, spreadRad * (0.55 + depth * 0.08));

  const leftPath = buildLSystemLikeBranch(splitNode, leftNode, depth + 1, seedIndex * 1.33 + 2.7, false, obstacles);
  const rightPath = buildLSystemLikeBranch(splitNode, rightNode, depth + 1, seedIndex * 1.67 + 3.9, false, obstacles);
  if (leftPath.length >= 2) {
    result.push(leftPath);
  }
  if (rightPath.length >= 2) {
    result.push(rightPath);
  }

  buildRootBranchCluster(leftNode, leftEntries, result, seedIndex + 1, depth + 1, obstacles);
  buildRootBranchCluster(rightNode, rightEntries, result, seedIndex + 2, depth + 1, obstacles);
}

function buildLSystemLikeBranch(start, end, depth, seedOffset, isTrunk = false, obstacles = []) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(5, Math.ceil(length / 4.5));
  const tangent = normalizeVector(end.x - start.x, end.y - start.y);
  const normal = { x: -tangent.y, y: tangent.x };
  const noiseAmount = P.rootNoiseMM * (isTrunk ? P.rootTrunkCurve : P.rootBranchCurve) * (1 - depth * 0.12);
  const swayAmount = noiseAmount * (0.6 + Math.min(0.5, depth * 0.08));
  const path = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const envelope = Math.sin(t * Math.PI);
    const basePoint = {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
    };
    const waveA = map(noise(seedOffset + t * 1.7, P.seed * 0.01 + depth * 0.27), 0, 1, -1, 1);
    const waveB = Math.sin(t * Math.PI * (1.4 + depth * 0.18) + seedOffset);
    const offset = envelope * swayAmount * (waveA * 0.65 + waveB * 0.35);
    let point = {
      x: basePoint.x + normal.x * offset,
      y: basePoint.y + normal.y * offset,
    };
    point = applyBlobAvoidance(point, obstacles, start, end, isTrunk ? 4.5 : 6.5);
    const downwardSlack = isTrunk ? 0.35 : 0.2;
    point.y = Math.min(point.y, basePoint.y + downwardSlack);
    path.push(point);
  }

  path[0] = copyPoint(start);
  path[path.length - 1] = copyPoint(end);
  return path;
}

function getAnchorCentroid(entries) {
  let sumX = 0;
  let sumY = 0;
  for (const entry of entries) {
    sumX += entry.anchor.x;
    sumY += entry.anchor.y;
  }
  return {
    x: sumX / entries.length,
    y: sumY / entries.length,
  };
}

function offsetSplitNode(origin, target, rotationRad) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const cosA = Math.cos(rotationRad);
  const sinA = Math.sin(rotationRad);
  return {
    x: origin.x + dx * cosA - dy * sinA * 0.2,
    y: origin.y + dx * sinA * 0.2 + dy * cosA,
  };
}

function buildRootObstacle(component, mapper) {
  const x = mapper.offsetXMM + (component.minCol / component.cols) * mapper.scaleMM;
  const y = mapper.offsetYMM + (component.minRow / component.rows) * mapper.scaleMM;
  const w = ((component.maxCol + 1 - component.minCol) / component.cols) * mapper.scaleMM;
  const h = ((component.maxRow + 1 - component.minRow) / component.rows) * mapper.scaleMM;
  return {
    x,
    y,
    w,
    h,
    cx: x + w * 0.5,
    cy: y + h * 0.5,
  };
}

function applyBlobAvoidance(point, obstacles, start, end, paddingMM) {
  let out = copyPoint(point);
  for (const obstacle of obstacles) {
    if (pointInsideExpandedObstacle(end, obstacle, paddingMM)) {
      continue;
    }
    const expanded = {
      x: obstacle.x - paddingMM,
      y: obstacle.y - paddingMM,
      w: obstacle.w + paddingMM * 2,
      h: obstacle.h + paddingMM * 2,
    };
    if (
      out.x >= expanded.x &&
      out.x <= expanded.x + expanded.w &&
      out.y >= expanded.y &&
      out.y <= expanded.y + expanded.h
    ) {
      const repel = normalizeVector(out.x - obstacle.cx, out.y - obstacle.cy);
      out = {
        x: obstacle.cx + repel.x * (Math.max(obstacle.w, obstacle.h) * 0.65 + paddingMM),
        y: obstacle.cy + repel.y * (Math.max(obstacle.w, obstacle.h) * 0.65 + paddingMM),
      };
    }
  }
  return out;
}

function pointInsideExpandedObstacle(point, obstacle, paddingMM) {
  return (
    point.x >= obstacle.x - paddingMM &&
    point.x <= obstacle.x + obstacle.w + paddingMM &&
    point.y >= obstacle.y - paddingMM &&
    point.y <= obstacle.y + obstacle.h + paddingMM
  );
}

function getRootContactPoint(component, mapper) {
  const major = component.axis.major;
  const centroid = component.centroid;
  const positive = rayDistanceInMask(component, centroid, major, 0.01, 2);
  const negative = rayDistanceInMask(component, centroid, { x: -major.x, y: -major.y }, 0.01, 2);
  const tipA = {
    x: centroid.x + major.x * positive,
    y: centroid.y + major.y * positive,
  };
  const tipB = {
    x: centroid.x - major.x * negative,
    y: centroid.y - major.y * negative,
  };
  let tip = tipA.y > tipB.y ? tipA : tipB;

  const inwardDir = normalizeVector(centroid.x - tip.x, centroid.y - tip.y);
  const insetNorm = P.rootContactInsetMM / mapper.scaleMM;
  const contact = {
    x: tip.x + inwardDir.x * insetNorm,
    y: tip.y + inwardDir.y * insetNorm,
  };
  return mapSourcePointToMM(contact, mapper);
}

function sampleRootBaseXs(mapper, count, baseCount = count) {
  const innerWidth = mapper.sizeMM;
  const minX = mapper.offsetXMM + innerWidth * 0.08;
  const maxX = mapper.offsetXMM + innerWidth * 0.92;
  const width = Math.max(1, maxX - minX);
  const baseSpacing = Math.max(4, P.rootSpacingMM);
  const target = Math.max(1, Math.min(count, baseCount));
  const samples = [];

  if (target === 1) {
    samples.push((minX + maxX) * 0.5);
    return samples;
  }

  const step = Math.max(baseSpacing, width / (target - 1));
  const occupied = [];
  const rng = mulberry32(Math.floor(P.seed * 1.37));
  for (let i = 0; i < target; i += 1) {
    const base = minX + Math.min(width, i * step);
    const jitter = (rng() - 0.5) * Math.min(baseSpacing * 0.6, width / target);
    let candidate = constrain(base + jitter, minX, maxX);
    candidate = nudgeAwayFromOccupied(candidate, occupied, Math.max(4, baseSpacing * 0.75), minX, maxX);
    occupied.push(candidate);
    samples.push(candidate);
  }

  return samples.sort((a, b) => a - b);
}

function chooseNearestRootNode(nodes, x) {
  let best = nodes[0];
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = Math.abs(node.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

function buildOrganicGraphPath(start, end, noiseAmount, seedOffset) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(4, Math.ceil(length / 5));
  const tangent = normalizeVector(end.x - start.x, end.y - start.y);
  const normal = { x: -tangent.y, y: tangent.x };
  const path = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const sway = Math.sin(t * Math.PI) * noiseAmount;
    const noiseSample = map(noise(seedOffset + t * 1.9, P.seed * 0.01 + 3.17), 0, 1, -1, 1);
    path.push({
      x: lerp(start.x, end.x, t) + normal.x * sway * noiseSample,
      y: lerp(start.y, end.y, t) + normal.y * sway * noiseSample,
    });
  }

  path[0] = copyPoint(start);
  path[path.length - 1] = copyPoint(end);
  return path;
}

function shouldBuildLeftBranch(index) {
  if (P.veinBranchSides === "both" || P.veinBranchSides === "left") {
    return true;
  }
  if (P.veinBranchSides === "alternating") {
    return index % 2 === 0;
  }
  return false;
}

function shouldBuildRightBranch(index) {
  if (P.veinBranchSides === "both" || P.veinBranchSides === "right") {
    return true;
  }
  if (P.veinBranchSides === "alternating") {
    return index % 2 === 1;
  }
  return false;
}

function buildVeinBranch(component, base, major, sideDir, taper, mapper) {
  const boundaryDistance = rayDistanceInMask(component, base, sideDir, 0.006, 2);
  const availableMM = boundaryDistance * mapper.scaleMM * 0.92;
  const branchLengthMM = constrain(availableMM * taper, P.veinMinBranchMM, P.veinMaxBranchMM);
  if (branchLengthMM < P.veinMinBranchMM || availableMM < P.veinMinBranchMM * 0.7) {
    return [];
  }

  const branchLengthNorm = branchLengthMM / mapper.scaleMM;
  const end = {
    x: base.x + sideDir.x * branchLengthNorm,
    y: base.y + sideDir.y * branchLengthNorm,
  };
  const control = {
    x: base.x + sideDir.x * branchLengthNorm * 0.55 + major.x * branchLengthNorm * P.veinForwardBias,
    y: base.y + sideDir.y * branchLengthNorm * 0.55 + major.y * branchLengthNorm * P.veinForwardBias,
  };
  const sourcePath = sampleQuadraticPath(base, control, end, Math.max(6, Math.ceil(branchLengthMM / 2.5)));
  const clipped = [];

  for (const point of sourcePath) {
    if (!isInsideComponent(component, point.x, point.y)) {
      break;
    }
    clipped.push(mapSourcePointToMM(point, mapper));
    if (clipped.length >= MAX_PATH_POINTS) {
      break;
    }
  }

  return clipped;
}

function buildVeinNetworkEdge(a, b, centroid, major, mapper) {
  const distanceMM = Math.hypot(b.x - a.x, b.y - a.y) * mapper.scaleMM;
  const tangent = normalizeVector(b.x - a.x, b.y - a.y);
  const normal = { x: -tangent.y, y: tangent.x };
  const centerVector = normalizeVector(centroid.x - a.x, centroid.y - a.y);
  const inwardSign = Math.sign(normal.x * centerVector.x + normal.y * centerVector.y) || 1;
  const jitter = lerp(
    1 - P.veinCurveJitter,
    1 + P.veinCurveJitter,
    noise(a.x * 12.7 + b.x * 7.3, a.y * 11.1 + b.y * 5.9, P.seed * 0.013)
  );
  const curveAmountNorm = (distanceMM / mapper.scaleMM) * P.veinCurve * 0.22 * jitter;
  const forwardBendNorm = (distanceMM / mapper.scaleMM) * P.veinForwardBias * 0.12;
  const control = {
    x: (a.x + b.x) * 0.5 + normal.x * curveAmountNorm * inwardSign + major.x * forwardBendNorm,
    y: (a.y + b.y) * 0.5 + normal.y * curveAmountNorm * inwardSign + major.y * forwardBendNorm,
  };
  const sourcePath = sampleQuadraticPath(a, control, b, Math.max(4, Math.ceil(distanceMM / 2.2)));
  return sourcePath.map((point) => mapSourcePointToMM(point, mapper));
}


function samplePoissonPointsInComponent(component, minDistanceNorm, seed) {
  const rng = mulberry32(seed);
  const points = [];
  const attempts = Math.min(1200, Math.max(240, component.cellIndices.length * 6));
  const minDistSq = minDistanceNorm * minDistanceNorm;

  for (let i = 0; i < attempts; i += 1) {
    const x = component.minCol / component.cols + rng() * ((component.maxCol + 1 - component.minCol) / component.cols);
    const y = component.minRow / component.rows + rng() * ((component.maxRow + 1 - component.minRow) / component.rows);
    if (!isInsideComponent(component, x, y)) {
      continue;
    }

    let ok = true;
    for (const point of points) {
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy < minDistSq) {
        ok = false;
        break;
      }
    }

    if (ok) {
      points.push({ x, y });
      if (points.length >= MAX_PATH_POINTS) {
        break;
      }
    }
  }

  return points;
}

function samplePoissonAlongLength(totalLengthMM, spacingMM, jitterAmount, seed) {
  const result = [];
  if (totalLengthMM <= spacingMM * 0.75) {
    return result;
  }

  const rng = mulberry32(seed);
  const minGap = Math.max(0.5, spacingMM * Math.max(0.2, 1 - jitterAmount * 0.55));
  const maxGap = Math.max(minGap, spacingMM * (1 + jitterAmount));
  let distance = spacingMM * 0.65;

  while (distance < totalLengthMM - spacingMM * 0.35) {
    result.push(distance);
    const gap = lerp(minGap, maxGap, rng());
    distance += gap;
  }

  return result;
}

function drawPaper() {
  noStroke();
  fill(P.paperColor);
  rect(0, 0, P.canvasWMM, P.canvasHMM);
}

function drawSourceGuide() {
  const mapper = getSourceToPaperMapper();
  noFill();
  stroke(P.sourceBoxColor);
  strokeWeight(0.18);
  rect(mapper.offsetXMM, mapper.offsetYMM, mapper.sizeMM, mapper.sizeMM);
}

function drawOutlinePaths() {
  noFill();
  stroke(P.outlineColor);
  strokeWeight(P.outlineStrokeMM);

  for (const loop of scene.outlinePathsMM) {
    beginShape();
    for (const point of loop) {
      vertex(point.x, point.y);
    }
    endShape(CLOSE);
  }

  if (!P.showBounds) {
    return;
  }

  for (const component of scene.components) {
    const mapper = getSourceToPaperMapper();
    const x = mapper.offsetXMM + (component.minCol / component.cols) * mapper.scaleMM;
    const y = mapper.offsetYMM + (component.minRow / component.rows) * mapper.scaleMM;
    const w = ((component.maxCol + 1 - component.minCol) / component.cols) * mapper.scaleMM;
    const h = ((component.maxRow + 1 - component.minRow) / component.rows) * mapper.scaleMM;
    rect(x, y, w, h);
  }
}

function drawPatternPaths() {
  noFill();
  stroke(P.patternColor);
  strokeWeight(P.patternStrokeMM);
  strokeJoin(ROUND);
  strokeCap(ROUND);

  for (const path of scene.patternPathsMM) {
    beginShape();
    for (const point of path) {
      vertex(point.x, point.y);
    }
    endShape();
  }
}

function exportSVG() {
  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(
      P.canvasWMM
    )}mm" height="${ExportUtils.fmt(P.canvasHMM)}mm" viewBox="0 0 ${ExportUtils.fmt(
      P.canvasWMM
    )} ${ExportUtils.fmt(P.canvasHMM)}">`
  );
  svg.push(
    `<g fill="none" stroke="${ExportUtils.escapeXML(P.patternColor)}" stroke-width="${ExportUtils.fmt(
      Math.max(0.0001, P.patternStrokeMM)
    )}" stroke-linecap="round" stroke-linejoin="round">`
  );

  for (const path of scene.patternPathsMM) {
    if (path.length < 2) {
      continue;
    }
    svg.push(`<path d="${buildPathD(path)}"/>`);
  }

  svg.push("</g>");
  svg.push("</svg>");
  ExportUtils.downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function buildPathD(points) {
  let d = `M ${ExportUtils.fmt(points[0].x)} ${ExportUtils.fmt(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${ExportUtils.fmt(points[i].x)} ${ExportUtils.fmt(points[i].y)}`;
  }
  return d;
}

function rayDistanceInMask(component, origin, dir, step, maxDistance) {
  let distance = 0;
  let lastInside = 0;
  while (distance <= maxDistance) {
    const point = {
      x: origin.x + dir.x * distance,
      y: origin.y + dir.y * distance,
    };
    if (!isInsideComponent(component, point.x, point.y)) {
      break;
    }
    lastInside = distance;
    distance += step;
  }
  return lastInside;
}

function isInsideComponent(component, x, y) {
  const col = Math.floor(x * component.cols);
  const row = Math.floor(y * component.rows);
  if (col < 0 || col >= component.cols || row < 0 || row >= component.rows) {
    return false;
  }
  return component.cellSet.has(row * component.cols + col);
}

function sampleStraightPath(a, b, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / Math.max(1, steps);
    points.push({
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
    });
  }
  return points;
}

function sampleQuadraticPath(a, b, c, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / Math.max(1, steps);
    const mt = 1 - t;
    points.push({
      x: mt * mt * a.x + 2 * mt * t * b.x + t * t * c.x,
      y: mt * mt * a.y + 2 * mt * t * b.y + t * t * c.y,
    });
  }
  return points;
}

function simplifyClosedPath(points, tolerance) {
  if (!points || points.length <= 4 || tolerance <= 0) {
    return points.map(copyPoint);
  }
  const simplified = simplifyPolylineRDP(points.concat([points[0]]), tolerance);
  simplified.pop();
  return simplified.length >= 3 ? simplified : points.map(copyPoint);
}

function simplifyPolylineRDP(points, epsilon) {
  if (points.length <= 2) {
    return points.map(copyPoint);
  }

  let maxDistance = -1;
  let splitIndex = -1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = getPointToLineDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= epsilon || splitIndex < 0) {
    return [copyPoint(points[0]), copyPoint(points[points.length - 1])];
  }

  const left = simplifyPolylineRDP(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyPolylineRDP(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function getPointToLineDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  const area = Math.abs(dx * (lineStart.y - point.y) - (lineStart.x - point.x) * dy);
  return area / Math.sqrt(lengthSq);
}

function makeUndirectedEdgeKey(a, b) {
  const aKey = `${a.x},${a.y}`;
  const bKey = `${b.x},${b.y}`;
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function parsePointKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

function nudgeAwayFromOccupied(candidate, occupied, minGap, minX, maxX) {
  let x = candidate;
  for (let pass = 0; pass < 8; pass += 1) {
    let adjusted = false;
    for (const other of occupied) {
      const delta = x - other;
      if (Math.abs(delta) < minGap) {
        x = constrain(other + Math.sign(delta || 1) * minGap, minX, maxX);
        adjusted = true;
      }
    }
    if (!adjusted) {
      break;
    }
  }
  return x;
}

function dot2(point, direction) {
  return point.x * direction.x + point.y * direction.y;
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.000001) {
    return { x: 1, y: 0 };
  }
  return { x: x / length, y: y / length };
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function nearlyEqual(a, b, epsilon = 0.000001) {
  return Math.abs(a - b) <= epsilon;
}

function pointsNearlyEqual(a, b, epsilon = 0.000001) {
  return nearlyEqual(a.x, b.x, epsilon) && nearlyEqual(a.y, b.y, epsilon);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), 1 | t);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
