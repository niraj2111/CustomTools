const MM_PER_INCH = 25.4;
const TWO_PI_VALUE = Math.PI * 2;
const PAPER_PRESETS_MM = {
  Custom: null,
  "A3 Portrait": { w: 297, h: 420 },
  "A3 Landscape": { w: 420, h: 297 },
  "A4 Portrait": { w: 210, h: 297 },
  "A4 Landscape": { w: 297, h: 210 },
  "A5 Portrait": { w: 148, h: 210 },
  "A5 Landscape": { w: 210, h: 148 },
};

let pane;
let cnv;
let anchorFolder;
let gridFolder;
let gridTypeControlBlades = [];
let hoveredAnchorIndex = -1;
let draggedAnchorIndex = -1;
let selectionMode = false;
let selectedAnchorIndices = new Set();
let marqueeSelection = null;
let geometryDirty = true;
let cachedRenderSpinePaths = [];
let cachedArcLengthSampleGroups = [];
let cachedSpringPaths = [];
let currentDisplayScale = 1;

const P = {
  canvasWMM: 148,
  canvasHMM: 210,
  paperPreset: "A5 Portrait",
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  bg: "#ffffff",
  springColor: "#0b0d12",
  spineColor: "#3f7cff",
  anchorColor: "#ff6b6b",
  gridColor: "#d6dae3",
  gridType: "square",
  gridSpacingMM: 5,
  hexGridSizeMM: 5,
  cursiveSpacingMM: 5,
  cursiveSlantDeg: 70,
  cursiveMajorEvery: 4,
  snapToGrid: true,
  showGrid: true,
  showSpine: true,
  showAnchors: true,
  spineStrokeMM: 0.35,
  springStrokeMM: 0.8,
  anchorRadiusMM: 1.6,
  hoverRadiusMM: 2.6,
  hoverColor: "#ffd166",
  selectionColor: "#22c55e",
  coilAmplitudeMM: 6,
  coilPitchMM: 2,
  samplesPerTurn: 48,
  orbitMode: "blackLetter",
  spineSmoothing: 4,
  spineSampleStepMM: 2,
  offsetLineCount: 5,
  offsetGapMM: 3,
  blackLetterAngleDeg: -45,
  blackLetterNibWidthMM: 3,
  presetMode: "none",
  presetInsetMM: 20,
  presetCols: 8,
  presetRows: 10,
  presetSeed: 42,
  presetPointCount: 64,
  springArcRadiusMM: 8,
  showSpring: true,
  svgFilename: "Spiral-Spring-Path.svg",
};

const spinePoints = [];

function setup() {
  const size = getCanvasPixelSize();
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  cnv.style("display", "block");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  syncCanvasSize();
  redraw();
}

function draw() {
  background("#101114");
  updateHoveredAnchor();
  ensureGeometryCache();
  const paper = getPaperSizeMM();

  push();
  scale(getPxPerMM());

  drawPaper(paper.width, paper.height);
  withPaperClip(paper.width, paper.height, () => {
    if (P.showGrid) {
      drawGrid(paper.width, paper.height);
    }

    if (P.showSpine) {
      drawSpine();
    }

    if (P.showSpring) {
      drawSpring();
    }

    if (P.showAnchors) {
      drawAnchors();
    }
  });

  drawSelectionOverlay();

  pop();
}

function mousePressed() {
  if (!isPointerInsideCanvas()) {
    return;
  }

  updateHoveredAnchor();
  if (selectionMode) {
    handleSelectionMousePressed();
    return;
  }

  if (hoveredAnchorIndex >= 0) {
    draggedAnchorIndex = hoveredAnchorIndex;
    return;
  }

  const point = getSnappedMousePointMM();
  if (!point) {
    return;
  }

  const last = getLastSpinePoint();
  if (last && nearlyEqual(last.x, point.x) && nearlyEqual(last.y, point.y)) {
    return;
  }

  spinePoints.push(point);
  invalidateGeometry();
  refreshAnchorMonitor();
  redraw();
}

function mouseDragged() {
  if (selectionMode) {
    updateSelectionMarquee();
    return;
  }

  if (draggedAnchorIndex < 0) {
    return;
  }

  const point = getSnappedMousePointMM();
  if (!point) {
    return;
  }

  spinePoints[draggedAnchorIndex] = point;
  updateHoveredAnchor();
  invalidateGeometry();
  redraw();
}

function mouseReleased() {
  if (selectionMode) {
    finalizeSelectionMarquee();
    return;
  }

  if (draggedAnchorIndex >= 0) {
    refreshAnchorMonitor();
  }
  draggedAnchorIndex = -1;
}

function mouseMoved() {
  const previous = hoveredAnchorIndex;
  updateHoveredAnchor();
  if (previous !== hoveredAnchorIndex) {
    redraw();
  }
}

function keyPressed() {
  if (key === "m" || key === "M") {
    selectionMode = !selectionMode;
    marqueeSelection = null;
    hoveredAnchorIndex = -1;
    draggedAnchorIndex = -1;
    redraw();
    return;
  }

  if (key === "n" || key === "N") {
    startNewSpine();
    return;
  }

  if (selectionMode && selectedAnchorIndices.size > 0 && handleArrowKeyMove()) {
    return;
  }

  const isDeleteKey = keyCode === DELETE || keyCode === BACKSPACE;
  if (!isDeleteKey || hoveredAnchorIndex < 0) {
    return;
  }

  selectedAnchorIndices.delete(hoveredAnchorIndex);
  shiftSelectedIndicesAfterRemoval(hoveredAnchorIndex);
  spinePoints.splice(hoveredAnchorIndex, 1);
  hoveredAnchorIndex = -1;
  draggedAnchorIndex = -1;
  invalidateGeometry();
  refreshAnchorMonitor();
  redraw();
}

function applyPreset() {
  const nextPoints = buildPresetPoints(P.presetMode);
  if (!nextPoints) {
    return;
  }

  spinePoints.length = 0;
  selectedAnchorIndices = new Set();
  marqueeSelection = null;
  for (const point of nextPoints) {
    spinePoints.push(point);
  }
  hoveredAnchorIndex = -1;
  draggedAnchorIndex = -1;
  selectedAnchorIndices = new Set();
  marqueeSelection = null;
  invalidateGeometry();
  refreshAnchorMonitor();
  redraw();
}

function windowResized() {
  updateCanvasDisplaySize();
}

function drawGrid(paperWMM, paperHMM) {
  const effectivePxPerMM = Math.max(0.0001, getPxPerMM() * Math.max(0.01, currentDisplayScale));
  const thinStrokeMM = Math.max(0.08, 1 / effectivePxPerMM);
  const majorStrokeMM = Math.max(0.12, 1.5 / effectivePxPerMM);
  stroke(P.gridColor);
  noFill();

  forEachGridLine(paperWMM, paperHMM, (lineDef) => {
    strokeWeight(lineDef.major ? majorStrokeMM : thinStrokeMM);
    line(lineDef.x1, lineDef.y1, lineDef.x2, lineDef.y2);
  });
}

function forEachGridLine(paperWMM, paperHMM, callback) {
  if (P.gridType === "hexagonal") {
    appendHexGridLines(paperWMM, paperHMM, callback);
    return;
  }
  if (P.gridType === "slantedCursive") {
    appendCursiveGridLines(paperWMM, paperHMM, callback);
    return;
  }
  appendSquareGridLines(paperWMM, paperHMM, callback);
}

function appendSquareGridLines(paperWMM, paperHMM, callback) {
  const spacing = Math.max(0.5, P.gridSpacingMM);
  let index = 0;
  for (let x = 0; x <= paperWMM + 0.001; x += spacing) {
    callback({ x1: x, y1: 0, x2: x, y2: paperHMM, major: index % 5 === 0 });
    index += 1;
  }

  index = 0;
  for (let y = 0; y <= paperHMM + 0.001; y += spacing) {
    callback({ x1: 0, y1: y, x2: paperWMM, y2: y, major: index % 5 === 0 });
    index += 1;
  }
}

function appendHexGridLines(paperWMM, paperHMM, callback) {
  const size = Math.max(0.5, P.hexGridSizeMM);
  const sqrt3 = Math.sqrt(3);
  const dx = sqrt3 * size;
  const dy = 1.5 * size;
  const maxRow = Math.ceil((paperHMM + size) / dy);
  const maxCol = Math.ceil((paperWMM + dx) / dx);

  for (let row = -1; row <= maxRow + 1; row += 1) {
    const cy = row * dy;
    const rowOffset = row % 2 === 0 ? 0 : dx / 2;
    for (let col = -1; col <= maxCol + 1; col += 1) {
      const cx = col * dx + rowOffset;
      const points = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i + Math.PI / 6;
        points.push({
          x: cx + size * Math.cos(angle),
          y: cy + size * Math.sin(angle),
        });
      }
      for (let i = 0; i < 6; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % 6];
        callback({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, major: false });
      }
    }
  }
}

function appendCursiveGridLines(paperWMM, paperHMM, callback) {
  const spacing = Math.max(0.5, P.cursiveSpacingMM);
  const slantDeg = constrain(P.cursiveSlantDeg, 10, 140);
  const slantRad = (slantDeg * Math.PI) / 180;
  const sinA = Math.sin(slantRad);
  const cosA = Math.cos(slantRad);
  if (Math.abs(sinA) < 1e-6) {
    return;
  }
  const majorEvery = Math.max(1, Math.floor(P.cursiveMajorEvery));

  let rowIndex = 0;
  for (let y = 0; y <= paperHMM + 0.001; y += spacing) {
    callback({ x1: 0, y1: y, x2: paperWMM, y2: y, major: rowIndex % majorEvery === 0 });
    rowIndex += 1;
  }

  // Slanted family: -sin(a)*x + cos(a)*y = c, where c is quantized by spacing.
  const c0 = 0;
  const c1 = -sinA * paperWMM;
  const c2 = cosA * paperHMM;
  const c3 = -sinA * paperWMM + cosA * paperHMM;
  const minC = Math.min(c0, c1, c2, c3) - spacing;
  const maxC = Math.max(c0, c1, c2, c3) + spacing;
  const startK = Math.floor(minC / spacing);
  const endK = Math.ceil(maxC / spacing);

  for (let k = startK; k <= endK; k += 1) {
    const c = k * spacing;
    const xTop = (0 * cosA - c) / sinA;
    const xBottom = (paperHMM * cosA - c) / sinA;
    callback({ x1: xTop, y1: 0, x2: xBottom, y2: paperHMM, major: false });
  }
}

function drawPaper(widthMM, heightMM) {
  noStroke();
  fill(P.bg);
  rect(0, 0, widthMM, heightMM);
}

function withPaperClip(widthMM, heightMM, fn) {
  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, widthMM, heightMM);
  ctx.clip();
  fn();
  ctx.restore();
}

function drawSpine() {
  const renderPaths = cachedRenderSpinePaths;
  if (renderPaths.length === 0) {
    return;
  }

  stroke(P.spineColor);
  strokeWeight(P.spineStrokeMM);
  noFill();

  for (const renderPoints of renderPaths) {
    if (renderPoints.length === 1) {
      point(renderPoints[0].x, renderPoints[0].y);
      continue;
    }

    beginShape();
    for (const point of renderPoints) {
      vertex(point.x, point.y);
    }
    endShape();
  }
}

function drawAnchors() {
  for (let i = 0; i < spinePoints.length; i += 1) {
    const point = spinePoints[i];
    if (!point) {
      continue;
    }
    const isHovered = i === hoveredAnchorIndex;
    const isDragged = i === draggedAnchorIndex;
    const isSelected = selectedAnchorIndices.has(i);

    if (isHovered || isDragged) {
      stroke(P.hoverColor);
      strokeWeight(0.35);
      fill(P.anchorColor);
      circle(point.x, point.y, P.hoverRadiusMM * 2);
    } else if (isSelected) {
      stroke(P.selectionColor);
      strokeWeight(0.35);
      fill(P.anchorColor);
      circle(point.x, point.y, P.hoverRadiusMM * 2);
    } else {
      noStroke();
      fill(P.anchorColor);
    }
    circle(point.x, point.y, P.anchorRadiusMM * 2);
  }
}

function drawSelectionOverlay() {
  if (!marqueeSelection) {
    return;
  }

  const x = Math.min(marqueeSelection.start.x, marqueeSelection.end.x);
  const y = Math.min(marqueeSelection.start.y, marqueeSelection.end.y);
  const w = Math.abs(marqueeSelection.end.x - marqueeSelection.start.x);
  const h = Math.abs(marqueeSelection.end.y - marqueeSelection.start.y);

  noFill();
  stroke(P.selectionColor);
  strokeWeight(0.35);
  rect(x, y, w, h);
}

function drawSpring() {
  const springPaths = cachedSpringPaths;
  if (springPaths.length === 0) {
    return;
  }

  stroke(P.springColor);
  strokeWeight(P.springStrokeMM);
  noFill();
  for (const springPath of springPaths) {
    if (springPath.length < 2) {
      continue;
    }
    beginShape();
    for (const point of springPath) {
      vertex(point.x, point.y);
    }
    endShape();
  }
}

function generateSpringPaths() {
  const paths = [];

  for (let i = 0; i < cachedRenderSpinePaths.length; i += 1) {
    const renderPath = cachedRenderSpinePaths[i];
    const spineSamples = cachedArcLengthSampleGroups[i] || [];
    if (renderPath.length < 2 || spineSamples.length < 2) {
      continue;
    }

    if (P.orbitMode === "blackLetter") {
      paths.push(...generateBlackLetterPaths(renderPath));
      continue;
    }

    const pitch = Math.max(0.5, P.coilPitchMM);
    const amplitude = Math.max(0, P.coilAmplitudeMM);
    if (P.orbitMode === "offsetPaths") {
      paths.push(...generateOffsetSpringPaths(spineSamples));
      continue;
    }

    const points = [];

    for (let sampleIndex = 0; sampleIndex < spineSamples.length; sampleIndex += 1) {
      const sample = spineSamples[sampleIndex];
      const phase = (sample.distance / pitch) * TWO_PI_VALUE;
      const offset = getOrbitOffset(phase, amplitude, sample.distance, pitch);
      points.push({
        x: sample.x + sample.normalX * offset,
        y: sample.y + sample.normalY * offset,
      });
    }

    if (P.orbitMode === "arcTurns") {
      paths.push(
        buildRoundedCornerPolyline(
          removeSequentialDuplicates(points),
          Math.max(0, P.springArcRadiusMM),
          getRoundedCornerStep(P.springArcRadiusMM)
        )
      );
      continue;
    }

    paths.push(points);
  }

  return paths;
}

function getRenderSpinePaths() {
  const spines = getSpineSegments();
  return spines.map((segment) => getRenderPathForSegment(segment)).filter((segment) => segment.length > 0);
}

function getRenderPathForSegment(segment) {
  if (segment.length <= 2) {
    return segment.map(copyPoint);
  }

  const iterations = Math.max(0, Math.floor(P.spineSmoothing));
  let points = segment.map(copyPoint);

  for (let i = 0; i < iterations; i += 1) {
    points = chaikin(points);
  }

  return points;
}

function chaikin(points) {
  if (points.length <= 2) {
    return points.map(copyPoint);
  }

  const next = [copyPoint(points[0])];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    next.push({
      x: lerp(a.x, b.x, 0.25),
      y: lerp(a.y, b.y, 0.25),
    });
    next.push({
      x: lerp(a.x, b.x, 0.75),
      y: lerp(a.y, b.y, 0.75),
    });
  }
  next.push(copyPoint(points[points.length - 1]));
  return next;
}

function getArcLengthSamplesForPath(renderPoints) {
  if (renderPoints.length < 2) {
    return [];
  }

  const totalLength = getPolylineLength(renderPoints);
  if (totalLength <= 0.0001) {
    return [];
  }

  const pitch = Math.max(0.5, P.coilPitchMM);
  const samplesPerTurn = Math.max(8, Math.floor(P.samplesPerTurn));
  const step = Math.min(Math.max(0.25, P.spineSampleStepMM), pitch / 2, pitch / samplesPerTurn);
  const sampleCount = Math.max(2, Math.ceil(totalLength / step));
  const samples = [];

  for (let i = 0; i <= sampleCount; i += 1) {
    const distance = i === sampleCount ? totalLength : Math.min(i * step, totalLength);
    const center = samplePolylineAtDistance(renderPoints, distance);
    samples.push({
      x: center.x,
      y: center.y,
      distance,
    });
  }

  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const tangent = normalizeVector(next.x - prev.x, next.y - prev.y);
    samples[i].tangentX = tangent.x;
    samples[i].tangentY = tangent.y;
    samples[i].normalX = -tangent.y;
    samples[i].normalY = tangent.x;
  }

  return samples;
}

function ensureGeometryCache() {
  if (!geometryDirty) {
    return;
  }

  cachedRenderSpinePaths = getRenderSpinePaths();
  cachedArcLengthSampleGroups = cachedRenderSpinePaths.map((path) => getArcLengthSamplesForPath(path));
  cachedSpringPaths = generateSpringPaths();
  geometryDirty = false;
}

function invalidateGeometry() {
  geometryDirty = true;
}

function getPolylineLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

function samplePolylineAtDistance(points, distance) {
  const target = Math.max(0, distance);
  let travelled = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (segmentLength <= 0.0001) {
      continue;
    }

    if (travelled + segmentLength >= target || i === points.length - 2) {
      const localDistance = constrain(target - travelled, 0, segmentLength);
      const t = localDistance / segmentLength;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
      };
    }

    travelled += segmentLength;
  }

  return copyPoint(points[points.length - 1]);
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.000001) {
    return { x: 1, y: 0 };
  }
  return {
    x: x / length,
    y: y / length,
  };
}

function buildPresetPoints(mode) {
  switch (mode) {
    case "spaceFill":
      return buildSpaceFillPreset();
    case "seedCurve":
      return buildSeedCurvePreset();
    case "seedFill":
      return buildSeedFillPreset();
    case "none":
    default:
      return null;
  }
}

function buildSpaceFillPreset() {
  const inset = getPresetInset();
  const cols = Math.max(2, Math.floor(P.presetCols));
  const rows = Math.max(2, Math.floor(P.presetRows));
  const usableW = Math.max(10, P.canvasWMM - inset * 2);
  const usableH = Math.max(10, P.canvasHMM - inset * 2);
  const dx = cols <= 1 ? 0 : usableW / (cols - 1);
  const dy = rows <= 1 ? 0 : usableH / (rows - 1);
  const points = [];

  for (let row = 0; row < rows; row += 1) {
    if (row % 2 === 0) {
      for (let col = 0; col < cols; col += 1) {
        points.push({
          x: inset + col * dx,
          y: inset + row * dy,
        });
      }
    } else {
      for (let col = cols - 1; col >= 0; col -= 1) {
        points.push({
          x: inset + col * dx,
          y: inset + row * dy,
        });
      }
    }
  }

  return snapPresetPoints(points);
}

function buildSeedCurvePreset() {
  const inset = getPresetInset();
  const cols = Math.max(2, Math.floor(P.presetCols));
  const rows = Math.max(2, Math.floor(P.presetRows));
  const usableW = Math.max(10, P.canvasWMM - inset * 2);
  const usableH = Math.max(10, P.canvasHMM - inset * 2);
  const dx = cols <= 1 ? 0 : usableW / (cols - 1);
  const dy = rows <= 1 ? 0 : usableH / (rows - 1);
  const rng = mulberry32(Math.floor(P.presetSeed));
  const maxPoints = Math.max(2, Math.floor(P.presetPointCount));
  const points = [];
  let col = Math.floor(rng() * cols);
  let row = Math.floor(rng() * rows);
  let lastDir = null;

  for (let i = 0; i < maxPoints; i += 1) {
    points.push({
      x: inset + col * dx,
      y: inset + row * dy,
    });

    const candidates = [];
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dCol = -1; dCol <= 1; dCol += 1) {
        if (dRow === 0 && dCol === 0) {
          continue;
        }

        const nextCol = col + dCol;
        const nextRow = row + dRow;
        if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) {
          continue;
        }

        const sameAsLast =
          lastDir && lastDir.dCol === -dCol && lastDir.dRow === -dRow;
        candidates.push({
          nextCol,
          nextRow,
          dCol,
          dRow,
          score: rng() + (sameAsLast ? -0.4 : 0),
        });
      }
    }

    if (candidates.length === 0) {
      break;
    }

    candidates.sort((a, b) => b.score - a.score);
    const next = candidates[0];
    col = next.nextCol;
    row = next.nextRow;
    lastDir = { dCol: next.dCol, dRow: next.dRow };
  }

  return snapPresetPoints(removeSequentialDuplicates(points));
}

function buildSeedFillPreset() {
  const inset = getPresetInset();
  const cols = Math.max(2, Math.floor(P.presetCols));
  const rows = Math.max(2, Math.floor(P.presetRows));
  const usableW = Math.max(10, P.canvasWMM - inset * 2);
  const usableH = Math.max(10, P.canvasHMM - inset * 2);
  const dx = cols <= 1 ? 0 : usableW / (cols - 1);
  const dy = rows <= 1 ? 0 : usableH / (rows - 1);
  const targetCount = Math.min(cols * rows, Math.max(2, Math.floor(P.presetPointCount)));
  const cells = generateSeedFillCells(cols, rows, targetCount, Math.floor(P.presetSeed));

  if (!cells || cells.length === 0) {
    return snapPresetPoints(buildSpaceFillPreset().slice(0, targetCount));
  }

  const points = cells.map((cell) => ({
    x: inset + cell.col * dx,
    y: inset + cell.row * dy,
  }));

  return snapPresetPoints(points);
}

function generateSeedFillCells(cols, rows, targetCount, seed) {
  const attempts = 24;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rng = mulberry32(seed + attempt * 1013);
    const result = buildFastSeedFillPath(cols, rows, targetCount, rng);
    if (result && result.length >= targetCount) {
      return result;
    }
  }

  return null;
}

function buildFastSeedFillPath(cols, rows, targetCount, rng) {
  const totalCells = cols * rows;
  const visited = new Uint8Array(totalCells);
  const path = [];
  const directions = [
    { dCol: 1, dRow: 0, dir: "E" },
    { dCol: -1, dRow: 0, dir: "W" },
    { dCol: 0, dRow: 1, dir: "S" },
    { dCol: 0, dRow: -1, dir: "N" },
  ];
  let col = Math.floor(rng() * cols);
  let row = Math.floor(rng() * rows);
  let previousDir = "";
  let straightRun = 0;
  const directionHistory = [];

  function indexOf(col, row) {
    return row * cols + col;
  }

  function isInBounds(col, row) {
    return col >= 0 && col < cols && row >= 0 && row < rows;
  }

  function countUnvisitedNeighbors(nextCol, nextRow) {
    let count = 0;
    for (const direction of directions) {
      const colCandidate = nextCol + direction.dCol;
      const rowCandidate = nextRow + direction.dRow;
      if (!isInBounds(colCandidate, rowCandidate)) {
        continue;
      }
      if (!visited[indexOf(colCandidate, rowCandidate)]) {
        count += 1;
      }
    }
    return count;
  }

  function countAxisBias(axis) {
    let count = 0;
    for (const dir of directionHistory) {
      if ((axis === "horizontal" && (dir === "E" || dir === "W")) ||
          (axis === "vertical" && (dir === "N" || dir === "S"))) {
        count += 1;
      }
    }
    return count;
  }

  function countBoundaryTouches(nextCol, nextRow) {
    let touches = 0;
    if (nextCol === 0 || nextCol === cols - 1) {
      touches += 1;
    }
    if (nextRow === 0 || nextRow === rows - 1) {
      touches += 1;
    }
    return touches;
  }

  function getAxis(dir) {
    return dir === "E" || dir === "W" ? "horizontal" : "vertical";
  }

  function getCandidates(currentCol, currentRow, currentDir, currentStraightRun) {
    const candidates = [];
    const centerCol = (cols - 1) * 0.5;
    const centerRow = (rows - 1) * 0.5;

    for (const direction of directions) {
      const nextCol = currentCol + direction.dCol;
      const nextRow = currentRow + direction.dRow;
      if (!isInBounds(nextCol, nextRow)) {
        continue;
      }
      const nextIndex = indexOf(nextCol, nextRow);
      if (visited[nextIndex]) {
        continue;
      }

      const onwardOptions = countUnvisitedNeighbors(nextCol, nextRow);
      const continuesStraight = currentDir === direction.dir;
      const turns = currentDir !== "" && currentDir !== direction.dir;
      const straightPenalty = continuesStraight ? 2.4 + currentStraightRun * 1.2 : 0;
      const turnBonus = turns ? -1.35 : 0;
      const deadEndPenalty = onwardOptions === 0 ? 3 : 0;
      const boundaryPenalty = countBoundaryTouches(nextCol, nextRow) * 0.65;
      const axisPenalty = countAxisBias(getAxis(direction.dir)) * 0.18;
      const centerBias =
        Math.abs(nextCol - centerCol) / Math.max(1, cols - 1) +
        Math.abs(nextRow - centerRow) / Math.max(1, rows - 1);

      candidates.push({
        col: nextCol,
        row: nextRow,
        dir: direction.dir,
        score:
          straightPenalty +
          turnBonus +
          deadEndPenalty +
          boundaryPenalty +
          axisPenalty -
          onwardOptions * 0.9 +
          centerBias * 0.18 +
          rng() * 0.28,
      });
    }

    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  }

  visited[indexOf(col, row)] = 1;
  path.push({ col, row });

  while (path.length < targetCount) {
    const candidates = getCandidates(col, row, previousDir, straightRun);
    if (candidates.length === 0) {
      break;
    }

    const pickIndex = candidates.length > 1 && rng() < 0.18 ? 1 : 0;
    const next = candidates[pickIndex];
    col = next.col;
    row = next.row;
    visited[indexOf(col, row)] = 1;
    path.push({ col, row });
    straightRun = next.dir === previousDir ? straightRun + 1 : 0;
    previousDir = next.dir;
    directionHistory.push(next.dir);
    if (directionHistory.length > 8) {
      directionHistory.shift();
    }
  }

  return path;
}

function snapPresetPoints(points) {
  if (!P.snapToGrid) {
    return points.map(copyPoint);
  }

  return points.map((point) => ({
    x: constrain(snapPointToActiveGrid(point).x, 0, P.canvasWMM),
    y: constrain(snapPointToActiveGrid(point).y, 0, P.canvasHMM),
  }));
}

function getPresetInset() {
  return constrain(P.presetInsetMM, 0, Math.min(P.canvasWMM, P.canvasHMM) * 0.45);
}

function getRoundedCornerStep(radiusMM) {
  const radius = Math.max(0.25, radiusMM);
  return Math.max(0.2, Math.min(P.spineSampleStepMM, radius * 0.3, 2));
}

function generateOffsetSpringPaths(spineSamples) {
  const lineCount = Math.max(1, Math.floor(P.offsetLineCount));
  const gap = Math.max(0, P.offsetGapMM);
  const radius = Math.max(0, P.springArcRadiusMM);
  const step = getRoundedCornerStep(radius);
  const centerOffset = (lineCount - 1) * 0.5;
  const paths = [];

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const offsetAmount = (lineIndex - centerOffset) * gap;
    const points = [];

    for (const sample of spineSamples) {
      points.push({
        x: sample.x + sample.normalX * offsetAmount,
        y: sample.y + sample.normalY * offsetAmount,
      });
    }

    paths.push(
      buildRoundedCornerPolyline(removeSequentialDuplicates(points), radius, step)
    );
  }

  return paths;
}

function generateBlackLetterPaths(renderPoints) {
  if (renderPoints.length < 2) {
    return [];
  }

  const spacing = Math.max(0.5, P.coilPitchMM);
  const nibWidth = Math.max(0.1, P.blackLetterNibWidthMM);
  const angle = radians(P.blackLetterAngleDeg);
  const halfWidthX = Math.cos(angle) * nibWidth * 0.5;
  const halfWidthY = Math.sin(angle) * nibWidth * 0.5;
  const centers = getPolylineStampPoints(renderPoints, spacing);

  return centers.map((center) => [
    {
      x: center.x - halfWidthX,
      y: center.y - halfWidthY,
    },
    {
      x: center.x + halfWidthX,
      y: center.y + halfWidthY,
    },
  ]);
}

function getPolylineStampPoints(points, spacing) {
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.0001) {
    return [];
  }

  const step = Math.max(0.1, spacing);
  const stampCount = Math.max(1, Math.floor(totalLength / step));
  const samples = [];

  for (let i = 0; i <= stampCount; i += 1) {
    const distance = Math.min(i * step, totalLength);
    samples.push(samplePolylineAtDistance(points, distance));
  }

  const last = samples[samples.length - 1];
  const endPoint = points[points.length - 1];
  if (!last || !nearlyEqual(last.x, endPoint.x) || !nearlyEqual(last.y, endPoint.y)) {
    samples.push(copyPoint(endPoint));
  }

  return samples;
}

function buildRoundedCornerPolyline(points, radius, step) {
  if (points.length <= 2 || radius <= 0.0001) {
    return points.map(copyPoint);
  }

  const safeStep = Math.max(0.2, step);
  const result = [copyPoint(points[0])];

  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const corner = getRoundedCornerData(a, b, c, radius);

    if (!corner) {
      appendPointIfDistinct(result, b);
      continue;
    }

    appendPointIfDistinct(result, corner.start);
    const arcPoints = sampleArcPoints(corner, safeStep);
    for (const point of arcPoints) {
      appendPointIfDistinct(result, point);
    }
  }

  appendPointIfDistinct(result, points[points.length - 1]);
  return result;
}

function getRoundedCornerData(a, b, c, radius) {
  const inbound = normalizeVector(a.x - b.x, a.y - b.y);
  const outbound = normalizeVector(c.x - b.x, c.y - b.y);
  const lenIn = Math.hypot(b.x - a.x, b.y - a.y);
  const lenOut = Math.hypot(c.x - b.x, c.y - b.y);
  if (lenIn <= 0.0001 || lenOut <= 0.0001) {
    return null;
  }

  const dot = constrain(inbound.x * outbound.x + inbound.y * outbound.y, -1, 1);
  const angle = Math.acos(dot);
  if (angle <= 0.05 || Math.abs(Math.PI - angle) <= 0.05) {
    return null;
  }

  const tangentDistance = radius / Math.tan(angle / 2);
  const maxDistance = Math.min(lenIn, lenOut) * 0.5;
  const clampedDistance = Math.min(tangentDistance, maxDistance);
  if (clampedDistance <= 0.0001) {
    return null;
  }

  const effectiveRadius = clampedDistance * Math.tan(angle / 2);
  const bisectorRawX = inbound.x + outbound.x;
  const bisectorRawY = inbound.y + outbound.y;
  const bisectorLength = Math.hypot(bisectorRawX, bisectorRawY);
  if (bisectorLength <= 0.0001) {
    return null;
  }
  const bisector = {
    x: bisectorRawX / bisectorLength,
    y: bisectorRawY / bisectorLength,
  };

  const centerDistance = effectiveRadius / Math.sin(angle / 2);
  const start = {
    x: b.x + inbound.x * clampedDistance,
    y: b.y + inbound.y * clampedDistance,
  };
  const end = {
    x: b.x + outbound.x * clampedDistance,
    y: b.y + outbound.y * clampedDistance,
  };
  const center = {
    x: b.x + bisector.x * centerDistance,
    y: b.y + bisector.y * centerDistance,
  };

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const turnCross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

  return {
    start,
    end,
    center,
    radius: effectiveRadius,
    startAngle,
    endAngle,
    clockwise: turnCross < 0,
  };
}

function sampleArcPoints(corner, step) {
  const { center, radius, startAngle, endAngle, clockwise, end } = corner;
  let sweep = endAngle - startAngle;

  if (clockwise && sweep >= 0) {
    sweep -= TWO_PI_VALUE;
  } else if (!clockwise && sweep <= 0) {
    sweep += TWO_PI_VALUE;
  }

  const arcLength = Math.abs(sweep) * radius;
  const segmentCount = Math.max(2, Math.ceil(arcLength / Math.max(0.2, step)));
  const points = [];

  for (let i = 1; i <= segmentCount; i += 1) {
    const t = i / segmentCount;
    const angle = startAngle + sweep * t;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }

  points[points.length - 1] = copyPoint(end);
  return points;
}

function appendPointIfDistinct(points, point) {
  const last = points[points.length - 1];
  if (!last || !nearlyEqual(last.x, point.x) || !nearlyEqual(last.y, point.y)) {
    points.push(copyPoint(point));
  }
}

function removeSequentialDuplicates(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || !nearlyEqual(last.x, point.x) || !nearlyEqual(last.y, point.y)) {
      result.push(point);
    }
  }
  return result;
}

function handleSelectionMousePressed() {
  const point = getMousePointMM();
  if (!point) {
    return;
  }

  if (hoveredAnchorIndex >= 0) {
    if (keyIsDown(SHIFT)) {
      toggleAnchorSelection(hoveredAnchorIndex);
    } else {
      selectedAnchorIndices = new Set([hoveredAnchorIndex]);
    }
    refreshAnchorMonitor();
    redraw();
    return;
  }

  marqueeSelection = {
    start: point,
    end: point,
    additive: keyIsDown(SHIFT),
  };
  redraw();
}

function updateSelectionMarquee() {
  if (!marqueeSelection) {
    return;
  }

  const point = getMousePointMM();
  if (!point) {
    return;
  }

  marqueeSelection.end = point;
  redraw();
}

function finalizeSelectionMarquee() {
  if (!marqueeSelection) {
    return;
  }

  const rect = getSelectionRect(marqueeSelection.start, marqueeSelection.end);
  const isClickSelection = rect.w <= 0.2 && rect.h <= 0.2;
  if (!marqueeSelection.additive) {
    selectedAnchorIndices = new Set();
  }

  if (!isClickSelection) {
    for (let i = 0; i < spinePoints.length; i += 1) {
      const point = spinePoints[i];
      if (!point) {
        continue;
      }
      if (isPointInsideRect(point, rect)) {
        selectedAnchorIndices.add(i);
      }
    }
  }

  marqueeSelection = null;
  refreshAnchorMonitor();
  redraw();
}

function getSelectionRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function isPointInsideRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

function toggleAnchorSelection(index) {
  if (selectedAnchorIndices.has(index)) {
    selectedAnchorIndices.delete(index);
    return;
  }
  selectedAnchorIndices.add(index);
}

function handleArrowKeyMove() {
  const step = getActiveGridStepMM();
  let dx = 0;
  let dy = 0;

  if (keyCode === LEFT_ARROW) {
    dx = -step;
  } else if (keyCode === RIGHT_ARROW) {
    dx = step;
  } else if (keyCode === UP_ARROW) {
    dy = -step;
  } else if (keyCode === DOWN_ARROW) {
    dy = step;
  } else {
    return false;
  }

  const orderedIndices = Array.from(selectedAnchorIndices).sort((a, b) => a - b);
  for (const index of orderedIndices) {
    const point = spinePoints[index];
    if (!point) {
      continue;
    }
    spinePoints[index] = {
      x: constrain(point.x + dx, 0, P.canvasWMM),
      y: constrain(point.y + dy, 0, P.canvasHMM),
    };
  }

  invalidateGeometry();
  refreshAnchorMonitor();
  redraw();
  return true;
}

function shiftSelectedIndicesAfterRemoval(removedIndex) {
  const nextSelection = new Set();
  for (const index of selectedAnchorIndices) {
    if (index < removedIndex) {
      nextSelection.add(index);
    } else if (index > removedIndex) {
      nextSelection.add(index - 1);
    }
  }
  selectedAnchorIndices = nextSelection;
}

function updateHoveredAnchor() {
  hoveredAnchorIndex = findHoveredAnchorIndex();
}

function findHoveredAnchorIndex() {
  const point = getMousePointMM();
  if (!point) {
    return -1;
  }

  const threshold = Math.max(P.hoverRadiusMM, P.anchorRadiusMM);
  const thresholdSq = threshold * threshold;
  let closestIndex = -1;
  let closestDistSq = Infinity;

  for (let i = 0; i < spinePoints.length; i += 1) {
    const anchor = spinePoints[i];
    if (!anchor) {
      continue;
    }
    const dx = anchor.x - point.x;
    const dy = anchor.y - point.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= thresholdSq && distSq < closestDistSq) {
      closestIndex = i;
      closestDistSq = distSq;
    }
  }

  return closestIndex;
}

function getOrbitOffset(phase, amplitude, distance, pitch) {
  switch (P.orbitMode) {
    case "cosine":
      return Math.cos(phase) * amplitude;
    case "triangle":
      return triangleWave(phase) * amplitude;
    case "square":
      return Math.sign(Math.sin(phase)) * amplitude;
    case "saw":
      return sawWave(phase) * amplitude;
    case "lissajous":
      return (0.7 * Math.sin(phase) + 0.3 * Math.sin(phase * 3)) * amplitude;
    case "damped":
      return Math.sin(phase) * amplitude * (0.75 + 0.25 * Math.cos((distance / pitch) * Math.PI));
    case "sine":
    default:
      return Math.sin(phase) * amplitude;
  }
}

function triangleWave(phase) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

function sawWave(phase) {
  const normalized = phase / TWO_PI_VALUE;
  return 2 * (normalized - Math.floor(normalized + 0.5));
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Spiral Spring",
  });

  const canvasFolder = pane.addFolder({ title: "Canvas (mm)" });
  canvasFolder
    .addInput(P, "paperPreset", {
      options: Object.keys(PAPER_PRESETS_MM).reduce((acc, label) => {
        acc[label] = label;
        return acc;
      }, {}),
      label: "Paper",
    })
    .on("change", (ev) => {
      applyPaperPreset(ev.value);
      pane.refresh();
      syncCanvasSize();
      redraw();
    });
  canvasFolder.addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" });
  canvasFolder.addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" });
  canvasFolder.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" });
  canvasFolder.addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" });
  canvasFolder.addInput(P, "fitToViewport", { label: "Fit View" });

  gridFolder = pane.addFolder({ title: "Base Grid" });
  gridFolder
    .addInput(P, "gridType", {
      options: {
        square: "square",
        hexagonal: "hexagonal",
        "slanted cursive": "slantedCursive",
      },
      label: "Type",
    })
    .on("change", () => {
      rebuildGridTypeControls();
      pane.refresh();
      redraw();
    });
  gridFolder.addInput(P, "snapToGrid", { label: "Snap" });
  gridFolder.addInput(P, "showGrid", { label: "Show Grid" });
  rebuildGridTypeControls();

  const presetFolder = pane.addFolder({ title: "Spine Presets" });
  presetFolder.addInput(P, "presetMode", {
    options: {
      none: "none",
      spaceFill: "spaceFill",
      seedCurve: "seedCurve",
      seedFill: "seedFill",
    },
    label: "Preset",
  });
  presetFolder.addInput(P, "presetInsetMM", {
    min: 0,
    max: 100,
    step: 1,
    label: "Inset",
  });
  presetFolder.addInput(P, "presetCols", {
    min: 2,
    max: 40,
    step: 1,
    label: "Cols",
  });
  presetFolder.addInput(P, "presetRows", {
    min: 2,
    max: 40,
    step: 1,
    label: "Rows",
  });
  presetFolder.addInput(P, "presetSeed", {
    min: 0,
    max: 999999,
    step: 1,
    label: "Seed",
  });
  presetFolder.addInput(P, "presetPointCount", {
    min: 2,
    max: 400,
    step: 1,
    label: "Points",
  });
  presetFolder.addButton({ title: "Apply Preset" }).on("click", applyPreset);

  const springFolder = pane.addFolder({ title: "Spring" });
  springFolder.addInput(P, "orbitMode", {
    options: {
      sine: "sine",
      cosine: "cosine",
      triangle: "triangle",
      square: "square",
      saw: "saw",
      lissajous: "lissajous",
      damped: "damped",
      arcTurns: "arcTurns",
      offsetPaths: "offsetPaths",
      blackLetter: "blackLetter",
    },
    label: "Orbit",
  });
  springFolder.addInput(P, "coilAmplitudeMM", {
    min: 0,
    max: 80,
    step: 0.1,
    label: "Amplitude",
  });
  springFolder.addInput(P, "coilPitchMM", { min: 1, max: 100, step: 0.1, label: "Pitch" });
  springFolder.addInput(P, "samplesPerTurn", {
    min: 8,
    max: 240,
    step: 1,
    label: "Samples",
  });
  springFolder.addInput(P, "offsetLineCount", {
    min: 1,
    max: 40,
    step: 1,
    label: "Num Lines",
  });
  springFolder.addInput(P, "offsetGapMM", {
    min: 0,
    max: 40,
    step: 0.1,
    label: "Gap",
  });
  springFolder.addInput(P, "spineSmoothing", {
    min: 0,
    max: 5,
    step: 1,
    label: "Corners",
  });
  springFolder.addInput(P, "spineSampleStepMM", {
    min: 0.25,
    max: 10,
    step: 0.25,
    label: "Sample Step",
  });
  springFolder.addInput(P, "springArcRadiusMM", {
    min: 0,
    max: 80,
    step: 0.1,
    label: "Arc Radius",
  });
  springFolder.addInput(P, "blackLetterAngleDeg", {
    min: -180,
    max: 180,
    step: 1,
    label: "Nib Angle",
  });
  springFolder.addInput(P, "blackLetterNibWidthMM", {
    min: 0.1,
    max: 80,
    step: 0.1,
    label: "Nib Width",
  });
  springFolder.addInput(P, "showSpring", { label: "Show Spring" });

  const styleFolder = pane.addFolder({ title: "Style" });
  styleFolder.addInput(P, "bg", { label: "BG" });
  styleFolder.addInput(P, "springColor", { label: "Spring" });
  styleFolder.addInput(P, "spineColor", { label: "Spine" });
  styleFolder.addInput(P, "anchorColor", { label: "Anchors" });
  styleFolder.addInput(P, "hoverColor", { label: "Hover" });
  styleFolder.addInput(P, "gridColor", { label: "Grid" });
  styleFolder.addInput(P, "springStrokeMM", {
    min: 0.05,
    max: 10,
    step: 0.05,
    label: "Spring W",
  });
  styleFolder.addInput(P, "spineStrokeMM", {
    min: 0.05,
    max: 10,
    step: 0.05,
    label: "Spine W",
  });
  styleFolder.addInput(P, "anchorRadiusMM", {
    min: 0.2,
    max: 20,
    step: 0.1,
    label: "Anchor R",
  });
  styleFolder.addInput(P, "hoverRadiusMM", {
    min: 0.2,
    max: 24,
    step: 0.1,
    label: "Hover R",
  });
  styleFolder.addInput(P, "showSpine", { label: "Show Spine" });
  styleFolder.addInput(P, "showAnchors", { label: "Show Anchors" });

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgFilename", { label: "Filename" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });

  anchorFolder = pane.addFolder({ title: "Spine" });
  refreshAnchorMonitor();

  pane.on("change", () => {
    syncPaperPresetFromSize();
    invalidateGeometry();
    syncCanvasSize();
    redraw();
  });
}

function hookUI() {
  document.getElementById("undoBtn").addEventListener("click", () => {
    removeLastSpinePoint();
    refreshAnchorMonitor();
    invalidateGeometry();
    redraw();
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    spinePoints.length = 0;
    selectedAnchorIndices = new Set();
    marqueeSelection = null;
    refreshAnchorMonitor();
    invalidateGeometry();
    redraw();
  });

  document.getElementById("svgBtn").addEventListener("click", () => {
    exportSVG();
  });

  document.getElementById("spineSvgBtn").addEventListener("click", () => {
    exportSpineSVG();
  });

  window.addEventListener("resize", updateCanvasDisplaySize);
}

function refreshAnchorMonitor() {
  if (!anchorFolder) {
    return;
  }

  anchorFolder.dispose();
  const segments = getSpineSegments();
  const pointCount = spinePoints.filter(Boolean).length;
  anchorFolder = pane.addFolder({ title: `Spines (${segments.length})` });
  anchorFolder.addMonitor({ count: segments.length }, "count", { label: "Spines" });
  anchorFolder.addMonitor({ pointCount }, "pointCount", { label: "Points" });
  anchorFolder.addMonitor({ selectedCount: selectedAnchorIndices.size }, "selectedCount", {
    label: "Selected",
  });

  const preview = spinePoints
    .filter(Boolean)
    .slice(0, 8)
    .map((point, index) => `${index + 1}: ${fmt(point.x)}, ${fmt(point.y)}`)
    .join(" | ");
  const state = {
    preview: preview || "Click canvas to add snapped points",
  };
  anchorFolder.addMonitor(state, "preview", {
    label: "Anchors",
    multiline: true,
    lineCount: 4,
  });
}

function exportSVG() {
  ensureGeometryCache();
  const springPaths = cachedSpringPaths;
  const svg = [];

  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(
      P.canvasHMM
    )}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`
  );
  svg.push(
    `<rect x="0" y="0" width="${fmt(P.canvasWMM)}" height="${fmt(P.canvasHMM)}" fill="${escapeXML(
      P.bg
    )}"/>`
  );

  if (P.showGrid) {
    svg.push(
      `<g stroke="${escapeXML(P.gridColor)}" stroke-width="0.2" fill="none" opacity="0.85">`
    );
    forEachGridLine(P.canvasWMM, P.canvasHMM, (lineDef) => {
      svg.push(
        `<line x1="${fmt(lineDef.x1)}" y1="${fmt(lineDef.y1)}" x2="${fmt(lineDef.x2)}" y2="${fmt(
          lineDef.y2
        )}"/>`
      );
    });
    svg.push("</g>");
  }

  if (P.showSpine) {
    for (const renderPath of cachedRenderSpinePaths) {
      if (renderPath.length < 2) {
        continue;
      }
      svg.push(
        `<path d="${polylineToPath(renderPath)}" fill="none" stroke="${escapeXML(
          P.spineColor
        )}" stroke-width="${fmt(P.spineStrokeMM)}"/>`
      );
    }
  }

  if (P.showSpring) {
    for (const springPath of springPaths) {
      if (springPath.length < 2) {
        continue;
      }
      svg.push(
        `<path d="${polylineToPath(springPath)}" fill="none" stroke="${escapeXML(
          P.springColor
        )}" stroke-width="${fmt(P.springStrokeMM)}"/>`
      );
    }
  }

  if (P.showAnchors) {
    svg.push(`<g fill="${escapeXML(P.anchorColor)}" stroke="none">`);
    for (const point of spinePoints) {
      if (!point) {
        continue;
      }
      svg.push(
        `<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="${fmt(P.anchorRadiusMM)}"/>`
      );
    }
    svg.push("</g>");
  }

  svg.push("</svg>");
  downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function exportSpineSVG() {
  ensureGeometryCache();
  if (cachedRenderSpinePaths.length === 0) {
    return;
  }

  const filename = getSpineSvgFilename();
  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(
      P.canvasHMM
    )}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`
  );
  for (const renderPath of cachedRenderSpinePaths) {
    if (renderPath.length < 2) {
      continue;
    }
    svg.push(
      `<path d="${polylineToPath(renderPath)}" fill="none" stroke="${escapeXML(
        P.spineColor
      )}" stroke-width="${fmt(P.spineStrokeMM)}"/>`
    );
  }
  svg.push("</svg>");
  downloadText(svg.join("\n"), filename, "image/svg+xml");
}

function getSpineSegments() {
  const segments = [];
  let current = [];

  for (const point of spinePoints) {
    if (!point) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(point);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function getLastSpinePoint() {
  for (let i = spinePoints.length - 1; i >= 0; i -= 1) {
    if (spinePoints[i]) {
      return spinePoints[i];
    }
    if (spinePoints[i] === null) {
      break;
    }
  }
  return null;
}

function startNewSpine() {
  const last = spinePoints[spinePoints.length - 1];
  const hasAnyPoints = spinePoints.some(Boolean);
  if (!hasAnyPoints || last === null) {
    return;
  }

  spinePoints.push(null);
  hoveredAnchorIndex = -1;
  draggedAnchorIndex = -1;
  invalidateGeometry();
  refreshAnchorMonitor();
  redraw();
}

function removeLastSpinePoint() {
  while (spinePoints.length > 0 && spinePoints[spinePoints.length - 1] === null) {
    spinePoints.pop();
  }

  if (spinePoints.length === 0) {
    return;
  }

  const removedIndex = spinePoints.length - 1;
  spinePoints.pop();
  selectedAnchorIndices.delete(removedIndex);
  shiftSelectedIndicesAfterRemoval(removedIndex);

  while (spinePoints.length > 0 && spinePoints[spinePoints.length - 1] === null) {
    spinePoints.pop();
  }
}

function getSpineSvgFilename() {
  if (typeof P.svgFilename !== "string" || P.svgFilename.trim() === "") {
    return "Spiral-Spring-Path-spine.svg";
  }

  if (P.svgFilename.toLowerCase().endsWith(".svg")) {
    return `${P.svgFilename.slice(0, -4)}-spine.svg`;
  }

  return `${P.svgFilename}-spine.svg`;
}

function polylineToPath(points) {
  if (points.length === 0) {
    return "";
  }

  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${fmt(points[i].x)} ${fmt(points[i].y)}`;
  }
  return d;
}

function isPointerInsideCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

function getMousePointMM() {
  const pxPerMM = getPxPerMM();
  if (pxPerMM <= 0 || !isPointerInsideCanvas()) {
    return null;
  }

  return {
    x: mouseX / pxPerMM,
    y: mouseY / pxPerMM,
  };
}

function getSnappedMousePointMM() {
  const point = getMousePointMM();
  if (!point) {
    return null;
  }

  let xMM = point.x;
  let yMM = point.y;

  if (P.snapToGrid) {
    const snapped = snapPointToActiveGrid({ x: xMM, y: yMM });
    xMM = snapped.x;
    yMM = snapped.y;
  }

  return {
    x: constrain(xMM, 0, P.canvasWMM),
    y: constrain(yMM, 0, P.canvasHMM),
  };
}

function syncCanvasSize() {
  const size = getCanvasPixelSize();
  resizeCanvas(size.width, size.height, true);
  updateCanvasDisplaySize();
}

function updateCanvasDisplaySize() {
  if (!cnv) {
    return;
  }

  const wrap = document.getElementById("wrap");
  const rect = wrap.getBoundingClientRect();
  const pxSize = getCanvasPixelSize();
  const padding = 24;
  const availableW = Math.max(1, rect.width - padding);
  const availableH = Math.max(1, rect.height - padding);
  const fitScale = Math.min(availableW / pxSize.width, availableH / pxSize.height, 1);
  const zoomScale = Math.max(0.05, P.previewScale);
  const unclampedScale = P.fitToViewport ? fitScale * zoomScale : zoomScale;
  const scale = P.fitToViewport ? Math.min(fitScale, unclampedScale) : unclampedScale;
  currentDisplayScale = Math.max(0.01, scale);
  const displayW = Math.max(1, Math.round(pxSize.width * scale));
  const displayH = Math.max(1, Math.round(pxSize.height * scale));

  cnv.style("width", `${displayW}px`);
  cnv.style("height", `${displayH}px`);
}

function getPxPerMM() {
  return P.dpi / MM_PER_INCH;
}

function rebuildGridTypeControls() {
  if (!gridFolder) {
    return;
  }
  normalizeGridTypeValue();
  for (const blade of gridTypeControlBlades) {
    blade.dispose();
  }
  gridTypeControlBlades = [];

  if (P.gridType === "hexagonal") {
    gridTypeControlBlades.push(
      gridFolder.addInput(P, "hexGridSizeMM", { min: 1, max: 60, step: 0.5, label: "Hex Size" })
    );
    return;
  }

  if (P.gridType === "slantedCursive") {
    gridTypeControlBlades.push(
      gridFolder.addInput(P, "cursiveSpacingMM", {
        min: 1,
        max: 60,
        step: 0.5,
        label: "Spacing",
      })
    );
    gridTypeControlBlades.push(
      gridFolder.addInput(P, "cursiveSlantDeg", { min: 10, max: 140, step: 1, label: "Slant" })
    );
    gridTypeControlBlades.push(
      gridFolder.addInput(P, "cursiveMajorEvery", {
        min: 1,
        max: 12,
        step: 1,
        label: "Major Every",
      })
    );
    return;
  }

  gridTypeControlBlades.push(
    gridFolder.addInput(P, "gridSpacingMM", { min: 1, max: 100, step: 0.5, label: "Grid" })
  );
}

function normalizeGridTypeValue() {
  if (P.gridType === "slanted cursive") {
    P.gridType = "slantedCursive";
    return;
  }
  if (P.gridType === "hex") {
    P.gridType = "hexagonal";
    return;
  }
  if (P.gridType !== "square" && P.gridType !== "hexagonal" && P.gridType !== "slantedCursive") {
    P.gridType = "square";
  }
}

function getActiveGridStepMM() {
  if (P.gridType === "hexagonal") {
    return Math.max(0.5, P.hexGridSizeMM);
  }
  if (P.gridType === "slantedCursive") {
    return Math.max(0.5, P.cursiveSpacingMM);
  }
  return Math.max(0.5, P.gridSpacingMM);
}

function snapPointToActiveGrid(point) {
  if (P.gridType === "hexagonal") {
    return snapPointToHexGrid(point);
  }
  if (P.gridType === "slantedCursive") {
    return snapPointToCursiveGrid(point);
  }
  const spacing = Math.max(0.5, P.gridSpacingMM);
  return {
    x: Math.round(point.x / spacing) * spacing,
    y: Math.round(point.y / spacing) * spacing,
  };
}

function snapPointToHexGrid(point) {
  const size = Math.max(0.5, P.hexGridSizeMM);
  const sqrt3 = Math.sqrt(3);
  const q = (sqrt3 / 3 / size) * point.x - (1 / 3 / size) * point.y;
  const r = (2 / 3 / size) * point.y;
  const rounded = roundAxialHex(q, r);
  return {
    x: size * sqrt3 * (rounded.q + rounded.r / 2),
    y: size * 1.5 * rounded.r,
  };
}

function roundAxialHex(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

function snapPointToCursiveGrid(point) {
  const spacing = Math.max(0.5, P.cursiveSpacingMM);
  const slantDeg = constrain(P.cursiveSlantDeg, 10, 140);
  const slantRad = (slantDeg * Math.PI) / 180;
  const sinA = Math.sin(slantRad);
  const cosA = Math.cos(slantRad);

  const y = Math.round(point.y / spacing) * spacing;
  if (Math.abs(sinA) < 1e-6) {
    return { x: point.x, y };
  }

  const nX = -sinA;
  const nY = cosA;
  const normalDistance = point.x * nX + point.y * nY;
  const snappedNormal = Math.round(normalDistance / spacing) * spacing;
  const x = (cosA * y - snappedNormal) / sinA;

  return { x, y };
}

function getPaperSizeMM() {
  const pxPerMM = Math.max(0.0001, getPxPerMM());
  return {
    width: width / pxPerMM,
    height: height / pxPerMM,
  };
}

function applyPaperPreset(presetName) {
  const preset = PAPER_PRESETS_MM[presetName];
  if (!preset) {
    return;
  }

  P.canvasWMM = preset.w;
  P.canvasHMM = preset.h;
}

function syncPaperPresetFromSize() {
  for (const [name, preset] of Object.entries(PAPER_PRESETS_MM)) {
    if (!preset) {
      continue;
    }
    if (nearlyEqual(P.canvasWMM, preset.w) && nearlyEqual(P.canvasHMM, preset.h)) {
      P.paperPreset = name;
      return;
    }
  }
  P.paperPreset = "Custom";
}

function mmToPx(mm) {
  return Math.max(1, Math.round(mm * getPxPerMM()));
}

function getCanvasPixelSize() {
  return {
    width: mmToPx(P.canvasWMM),
    height: mmToPx(P.canvasHMM),
  };
}

function fmt(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 0.0001;
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function escapeXML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
