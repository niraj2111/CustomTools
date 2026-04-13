const MM_PER_INCH = 25.4;

const CANVAS_PRESETS = {
  A5Portrait: { label: "A5 Portrait", widthMM: 148, heightMM: 210 },
  A5Landscape: { label: "A5 Landscape", widthMM: 210, heightMM: 148 },
  A4Portrait: { label: "A4 Portrait", widthMM: 210, heightMM: 297 },
  A4Landscape: { label: "A4 Landscape", widthMM: 297, heightMM: 210 },
  A3Portrait: { label: "A3 Portrait", widthMM: 297, heightMM: 420 },
  A3Landscape: { label: "A3 Landscape", widthMM: 420, heightMM: 297 },
};

const BRUSH_PRESETS = {
  Fine: { brushStyle: "round", brushWidthMM: 0.8 },
  Medium: { brushStyle: "round", brushWidthMM: 1.8 },
  Bold: { brushStyle: "round", brushWidthMM: 3.6 },
  Marker: { brushStyle: "round", brushWidthMM: 6 },
  FlatNib: {
    brushStyle: "flatNib",
    brushWidthMM: 1.2,
    flatNibWidthMM: 8,
    flatNibAngleDeg: -45,
  },
};

let pane;
let cnv;
let strokeFolder;
let gridFolder;
let gridTypeControlBlades = [];
let geometryDirty = true;
let hoveredAnchor = null;
let draggedAnchor = null;
let activeStrokeIndex = -1;
let drawingStrokeIndex = -1;
let cachedRenderStrokes = [];
let currentDisplayScale = 1;
let pinchGestureState = null;
let activeTouchId = null;
let suppressMouseUntil = 0;

const P = {
  canvasPreset: "A4Portrait",
  canvasWMM: CANVAS_PRESETS.A4Portrait.widthMM,
  canvasHMM: CANVAS_PRESETS.A4Portrait.heightMM,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  bg: "#ffffff",
  gridColor: "#dde3ee",
  majorGridColor: "#d9485f",
  strokeColor: "#0b1220",
  activeStrokeColor: "#2563eb",
  anchorColor: "#e11d48",
  hoverColor: "#f59e0b",
  showGrid: true,
  snapToGrid: true,
  gridType: "square",
  gridSpacingMM: 10,
  cursiveSpacingMM: 10,
  cursiveSlantDeg: 70,
  cursiveMajorEvery: 4,
  showAnchors: true,
  showStrokeOutlines: true,
  brushPreset: "Medium",
  brushStyle: "round",
  brushWidthMM: BRUSH_PRESETS.Medium.brushWidthMM,
  flatNibWidthMM: 8,
  flatNibAngleDeg: -45,
  minPointSpacingMM: 2,
  turnThresholdDeg: 18,
  simplifyToleranceMM: 4,
  smoothingMode: "chaikin1",
  chaikinCornerCut: 0.25,
  anchorRadiusMM: 1.25,
  hoverRadiusMM: 2.8,
  svgFilename: "Vector-Drawing-Tool.svg",
};

const strokes = [];

function setup() {
  const size = getCanvasPixelSize();
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  syncCanvasSize();
  redraw();
}

function draw() {
  background(P.bg);
  updateHoveredAnchor();
  ensureGeometryCache();

  push();
  scale(getPxPerMM());
  drawPaper();
  withCanvasClip(() => {
    if (P.showGrid) {
      drawGrid(P.canvasWMM, P.canvasHMM);
    }

    drawStrokes();

    if (P.showAnchors) {
      drawAnchors();
    }
  });

  pop();
}

function mousePressed() {
  if (shouldSuppressMouseEvent()) {
    return;
  }

  const point = getMousePointMM();
  if (!point) {
    return;
  }

  beginPointerStroke(point);
}

function beginPointerStroke(point) {
  if (!point) {
    return;
  }

  updateHoveredAnchor(point);
  if (hoveredAnchor) {
    draggedAnchor = { strokeIndex: hoveredAnchor.strokeIndex, pointIndex: hoveredAnchor.pointIndex };
    activeStrokeIndex = hoveredAnchor.strokeIndex;
    refreshStrokeMonitor();
    redraw();
    return;
  }

  const stroke = createStroke();
  strokes.push(stroke);
  drawingStrokeIndex = strokes.length - 1;
  activeStrokeIndex = drawingStrokeIndex;
  appendPointToStroke(stroke, point, true);
  appendPointToStroke(stroke, point, true);
  invalidateGeometry();
  refreshStrokeMonitor();
  redraw();
}

function mouseDragged() {
  if (shouldSuppressMouseEvent()) {
    return;
  }

  const point = getMousePointMM();
  continuePointerStroke(point);
}

function mouseReleased() {
  if (shouldSuppressMouseEvent()) {
    return;
  }

  endPointerStroke();
}

function continuePointerStroke(point) {
  if (!point) {
    return;
  }

  if (draggedAnchor) {
    const stroke = strokes[draggedAnchor.strokeIndex];
    if (!stroke) {
      return;
    }
    stroke.points[draggedAnchor.pointIndex] = P.snapToGrid ? snapPointToActiveGrid(point) : point;
    invalidateGeometry();
    refreshStrokeMonitor();
    redraw();
    return;
  }

  if (drawingStrokeIndex < 0) {
    return;
  }

  const stroke = strokes[drawingStrokeIndex];
  appendPointToStroke(stroke, point, false);
  invalidateGeometry();
  redraw();
}

function endPointerStroke() {
  if (draggedAnchor) {
    draggedAnchor = null;
    invalidateGeometry();
    refreshStrokeMonitor();
    redraw();
    return;
  }

  if (drawingStrokeIndex >= 0) {
    finalizeStroke(strokes[drawingStrokeIndex]);
    drawingStrokeIndex = -1;
    invalidateGeometry();
    refreshStrokeMonitor();
    redraw();
  }
}

function mouseMoved() {
  const previous = hoveredAnchor ? `${hoveredAnchor.strokeIndex}:${hoveredAnchor.pointIndex}` : "";
  updateHoveredAnchor();
  const next = hoveredAnchor ? `${hoveredAnchor.strokeIndex}:${hoveredAnchor.pointIndex}` : "";
  if (previous !== next) {
    redraw();
  }
}

function touchStarted(event) {
  if (!event || !event.touches) {
    return true;
  }

  if (!isTouchEventOnCanvas(event)) {
    return true;
  }

  suppressMouseUntil = Date.now() + 700;
  if (event.touches.length >= 2) {
    endActiveTouchStroke();
    return false;
  }

  const touch = getPrimaryChangedTouch(event);
  const point = getTouchPointMM(touch);
  if (!point) {
    return true;
  }

  activeTouchId = touch.identifier;
  beginPointerStroke(point);
  return false;
}

function touchMoved(event) {
  if (!event || !event.touches) {
    return true;
  }

  if (activeTouchId === null && !isTouchEventOnCanvas(event)) {
    return true;
  }

  suppressMouseUntil = Date.now() + 700;
  if (event.touches.length >= 2) {
    endActiveTouchStroke();
    return false;
  }

  const touch = getActiveTouch(event);
  const point = getTouchPointMM(touch);
  if (!point) {
    return true;
  }

  continuePointerStroke(point);
  return false;
}

function touchEnded(event) {
  if (!event) {
    endActiveTouchStroke();
    return false;
  }

  if (activeTouchId === null && drawingStrokeIndex < 0 && !draggedAnchor) {
    return true;
  }

  suppressMouseUntil = Date.now() + 700;
  const endedTouch = getEndedActiveTouch(event);
  if (!endedTouch && activeTouchId !== null) {
    return false;
  }

  endActiveTouchStroke();
  return false;
}

function touchCancelled() {
  if (activeTouchId === null && drawingStrokeIndex < 0 && !draggedAnchor) {
    return true;
  }

  suppressMouseUntil = Date.now() + 700;
  endActiveTouchStroke();
  return false;
}

function shouldSuppressMouseEvent() {
  return Date.now() < suppressMouseUntil;
}

function keyPressed() {
  const isDeleteKey = keyCode === DELETE || keyCode === BACKSPACE;
  if (isDeleteKey && hoveredAnchor) {
    const stroke = strokes[hoveredAnchor.strokeIndex];
    if (stroke) {
      stroke.points.splice(hoveredAnchor.pointIndex, 1);
      if (stroke.points.length < 2) {
        strokes.splice(hoveredAnchor.strokeIndex, 1);
        activeStrokeIndex = Math.min(activeStrokeIndex, strokes.length - 1);
      }
      hoveredAnchor = null;
      invalidateGeometry();
      refreshStrokeMonitor();
      redraw();
    }
    return;
  }

  if (key === "z" || key === "Z") {
    undoLastPoint();
  }
}

function windowResized() {
  updateCanvasDisplaySize();
}

function createStroke() {
  return {
    points: [],
    label: `Object ${strokes.length + 1}`,
    kind: "calligraphy",
    visible: true,
    exportEnabled: true,
    exportMode: "preview",
    brushStyle: P.brushStyle,
    brushWidthMM: P.brushWidthMM,
    flatNibWidthMM: P.flatNibWidthMM,
    flatNibAngleDeg: P.flatNibAngleDeg,
    color: P.strokeColor,
    smoothingMode: P.smoothingMode,
    chaikinCornerCut: P.chaikinCornerCut,
  };
}

function appendPointToStroke(stroke, point, force) {
  const nextPoint = P.snapToGrid ? snapPointToActiveGrid(point) : point;
  const points = stroke.points;
  const last = points[points.length - 1];
  if (!force && last && distanceBetween(last, nextPoint) < Math.max(0.1, P.minPointSpacingMM)) {
    points[points.length - 1] = nextPoint;
    return;
  }

  if (!force && points.length >= 2) {
    const prev = points[points.length - 2];
    const angle = getCornerAngleDeg(prev, last, nextPoint);
    if (
      angle < Math.max(1, P.turnThresholdDeg) &&
      distanceBetween(last, nextPoint) < P.minPointSpacingMM * 1.75
    ) {
      points[points.length - 1] = nextPoint;
      return;
    }
  }

  points.push(nextPoint);
}

function finalizeStroke(stroke) {
  stroke.points = simplifyStrokePoints(stroke.points);
  if (stroke.points.length < 2) {
    strokes.pop();
    activeStrokeIndex = strokes.length - 1;
  }
}

function simplifyStrokePoints(points) {
  if (points.length <= 2) {
    return points.map(copyPoint);
  }

  const result = [copyPoint(points[0])];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const keepByDistance = distanceBetween(prev, curr) >= Math.max(0.1, P.minPointSpacingMM * 0.75);
    const keepByTurn = getCornerAngleDeg(prev, curr, next) >= Math.max(1, P.turnThresholdDeg);
    if (keepByDistance || keepByTurn) {
      result.push(copyPoint(curr));
    }
  }
  result.push(copyPoint(points[points.length - 1]));
  return removeSequentialDuplicates(result);
}

function drawPaper() {
  noStroke();
  fill(P.bg);
  rect(0, 0, P.canvasWMM, P.canvasHMM);
}

function withCanvasClip(fn) {
  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, P.canvasWMM, P.canvasHMM);
  ctx.clip();
  fn();
  ctx.restore();
}

function drawGrid(paperWMM, paperHMM) {
  const effectivePxPerMM = Math.max(0.0001, getPxPerMM() * Math.max(0.01, currentDisplayScale));
  const thinStrokeMM = Math.max(0.08, 1 / effectivePxPerMM);
  const majorStrokeMM = Math.max(0.12, 1.5 / effectivePxPerMM);
  noFill();

  forEachGridLine(paperWMM, paperHMM, (lineDef) => {
    stroke(lineDef.major ? P.majorGridColor : P.gridColor);
    strokeWeight(lineDef.major ? majorStrokeMM : thinStrokeMM);
    line(lineDef.x1, lineDef.y1, lineDef.x2, lineDef.y2);
  });
}

function forEachGridLine(paperWMM, paperHMM, callback) {
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

function drawStrokes() {
  for (let i = 0; i < cachedRenderStrokes.length; i += 1) {
    const renderStroke = cachedRenderStrokes[i];
    if (!renderStroke || renderStroke.visible === false) {
      continue;
    }

    if (renderStroke.brushStyle === "flatNib") {
      stroke(renderStroke.color);
      strokeWeight(renderStroke.brushWidthMM);
      noFill();
      for (const segment of renderStroke.segments) {
        line(segment.a.x, segment.a.y, segment.b.x, segment.b.y);
      }
    } else {
      if (renderStroke.points.length === 0) {
        continue;
      }

      stroke(renderStroke.color);
      strokeWeight(renderStroke.brushWidthMM);
      noFill();

      if (renderStroke.points.length === 1) {
        point(renderStroke.points[0].x, renderStroke.points[0].y);
        continue;
      }

      beginShape();
      for (const pointData of renderStroke.points) {
        vertex(pointData.x, pointData.y);
      }
      endShape();
    }

    if (P.showStrokeOutlines && i === activeStrokeIndex) {
      stroke(P.activeStrokeColor);
      strokeWeight(0.3);
      noFill();
      beginShape();
      for (const pointData of renderStroke.points) {
        vertex(pointData.x, pointData.y);
      }
      endShape();
    }
  }
}

function drawAnchors() {
  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
    const strokeData = strokes[strokeIndex];
    for (let pointIndex = 0; pointIndex < strokeData.points.length; pointIndex += 1) {
      const pointData = strokeData.points[pointIndex];
      const isHovered =
        hoveredAnchor &&
        hoveredAnchor.strokeIndex === strokeIndex &&
        hoveredAnchor.pointIndex === pointIndex;
      const isDragged =
        draggedAnchor &&
        draggedAnchor.strokeIndex === strokeIndex &&
        draggedAnchor.pointIndex === pointIndex;

      if (isHovered || isDragged) {
        stroke(P.hoverColor);
        strokeWeight(0.35);
        fill(P.anchorColor);
        circle(pointData.x, pointData.y, P.hoverRadiusMM * 2);
      } else {
        noStroke();
        fill(strokeIndex === activeStrokeIndex ? P.activeStrokeColor : P.anchorColor);
      }

      circle(pointData.x, pointData.y, P.anchorRadiusMM * 2);
    }
  }
}

function updateHoveredAnchor(point = getMousePointMM()) {
  hoveredAnchor = findHoveredAnchor(point);
}

function findHoveredAnchor(point = getMousePointMM()) {
  if (!point) {
    return null;
  }

  let closest = null;
  let closestDistSq = Infinity;
  const thresholdSq = Math.pow(Math.max(P.hoverRadiusMM, P.anchorRadiusMM), 2);

  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
    const strokeData = strokes[strokeIndex];
    for (let pointIndex = 0; pointIndex < strokeData.points.length; pointIndex += 1) {
      const anchor = strokeData.points[pointIndex];
      const dx = anchor.x - point.x;
      const dy = anchor.y - point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= thresholdSq && distSq < closestDistSq) {
        closest = { strokeIndex, pointIndex };
        closestDistSq = distSq;
      }
    }
  }

  return closest;
}

function getPrimaryChangedTouch(event) {
  if (event.changedTouches && event.changedTouches.length > 0) {
    return event.changedTouches[0];
  }
  if (event.touches && event.touches.length > 0) {
    return event.touches[0];
  }
  return null;
}

function getActiveTouch(event) {
  if (!event || activeTouchId === null) {
    return getPrimaryChangedTouch(event);
  }

  for (const touch of event.touches || []) {
    if (touch.identifier === activeTouchId) {
      return touch;
    }
  }
  return null;
}

function getEndedActiveTouch(event) {
  if (!event || activeTouchId === null) {
    return getPrimaryChangedTouch(event);
  }

  for (const touch of event.changedTouches || []) {
    if (touch.identifier === activeTouchId) {
      return touch;
    }
  }
  return null;
}

function isTouchEventOnCanvas(event) {
  const touch =
    (event.touches && event.touches[0]) ||
    (event.changedTouches && event.changedTouches[0]);
  return Boolean(getTouchPointMM(touch));
}

function endActiveTouchStroke() {
  if (activeTouchId === null && drawingStrokeIndex < 0 && !draggedAnchor) {
    return;
  }

  activeTouchId = null;
  endPointerStroke();
}

function ensureGeometryCache() {
  if (!geometryDirty) {
    return;
  }

  cachedRenderStrokes = strokes.map((strokeData) => {
    const points = getRenderPointsForStroke(strokeData);
    if (strokeData.brushStyle === "flatNib") {
      return {
        kind: strokeData.kind,
        visible: strokeData.visible,
        exportEnabled: strokeData.exportEnabled,
        exportMode: strokeData.exportMode,
        brushStyle: strokeData.brushStyle,
        color: strokeData.color,
        brushWidthMM: strokeData.brushWidthMM,
        points,
        segments: buildFlatNibSegments(points, strokeData),
      };
    }

    return {
      kind: strokeData.kind,
      visible: strokeData.visible,
      exportEnabled: strokeData.exportEnabled,
      exportMode: strokeData.exportMode,
      brushStyle: strokeData.brushStyle,
      color: strokeData.color,
      brushWidthMM: strokeData.brushWidthMM,
      points,
      segments: [],
    };
  });
  geometryDirty = false;
}

function invalidateGeometry() {
  geometryDirty = true;
}

function getRenderPointsForStroke(strokeData) {
  let points = strokeData.points.map(copyPoint);
  if (points.length <= 2) {
    return points;
  }

  const smoothingMode = typeof strokeData.smoothingMode === "string" ? strokeData.smoothingMode : "off";
  const cornerCut = sanitizeNumber(strokeData.chaikinCornerCut, P.chaikinCornerCut);

  switch (smoothingMode) {
    case "chaikin2":
      points = chaikin(points, cornerCut);
      points = chaikin(points, cornerCut);
      break;
    case "chaikin1":
      points = chaikin(points, cornerCut);
      break;
    case "off":
    default:
      break;
  }

  return points;
}

function chaikin(points, cutRatio) {
  if (points.length <= 2) {
    return points.map(copyPoint);
  }

  const ratio = constrain(sanitizeNumber(cutRatio, 0.25), 0.01, 0.49);
  const next = [copyPoint(points[0])];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    next.push({ x: lerp(a.x, b.x, ratio), y: lerp(a.y, b.y, ratio) });
    next.push({ x: lerp(a.x, b.x, 1 - ratio), y: lerp(a.y, b.y, 1 - ratio) });
  }
  next.push(copyPoint(points[points.length - 1]));
  return next;
}

function buildFlatNibSegments(points, strokeData) {
  if (points.length < 2) {
    return [];
  }

  const brushWidth = Math.max(0.1, sanitizeNumber(strokeData.brushWidthMM, P.brushWidthMM));
  const nibWidth = Math.max(0.1, sanitizeNumber(strokeData.flatNibWidthMM, P.flatNibWidthMM));
  const nibAngle = sanitizeNumber(strokeData.flatNibAngleDeg, P.flatNibAngleDeg);
  const spacing = Math.max(0.4, brushWidth * 0.9);
  const centers = getSampledCenters(points, spacing);
  const angle = radians(nibAngle);
  const halfWidthX = Math.cos(angle) * nibWidth * 0.5;
  const halfWidthY = Math.sin(angle) * nibWidth * 0.5;

  return centers.map((center) => ({
    a: {
      x: center.x - halfWidthX,
      y: center.y - halfWidthY,
    },
    b: {
      x: center.x + halfWidthX,
      y: center.y + halfWidthY,
    },
  }));
}

function getSampledCenters(points, spacing) {
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.0001) {
    return points.map(copyPoint);
  }

  const step = Math.max(0.1, spacing);
  const count = Math.max(1, Math.floor(totalLength / step));
  const samples = [];
  for (let i = 0; i <= count; i += 1) {
    samples.push(samplePolylineAtDistance(points, Math.min(i * step, totalLength)));
  }

  const lastSample = samples[samples.length - 1];
  const end = points[points.length - 1];
  if (!lastSample || !nearlyEqual(lastSample.x, end.x) || !nearlyEqual(lastSample.y, end.y)) {
    samples.push(copyPoint(end));
  }
  return samples;
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Vector Drawing Tool",
  });

  const canvasFolder = pane.addFolder({ title: "Canvas" });
  canvasFolder.addInput(P, "canvasPreset", {
    options: Object.fromEntries(
      Object.entries(CANVAS_PRESETS).map(([key, value]) => [value.label, key])
    ),
    label: "Preset",
  });
  canvasFolder.addInput(P, "canvasWMM", { min: 50, max: 1000, step: 1, label: "W mm" });
  canvasFolder.addInput(P, "canvasHMM", { min: 50, max: 1000, step: 1, label: "H mm" });
  canvasFolder.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" });
  canvasFolder.addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" });
  canvasFolder.addInput(P, "fitToViewport", { label: "Fit View" });

  gridFolder = pane.addFolder({ title: "Grid" });
  gridFolder.addInput(P, "showGrid", { label: "Show Grid" });
  gridFolder.addInput(P, "snapToGrid", { label: "Snap" });
  gridFolder
    .addInput(P, "gridType", {
      options: {
        Square: "square",
        "Slanted Cursive": "slantedCursive",
      },
      label: "Type",
    })
    .on("change", () => {
      rebuildGridTypeControls();
      pane.refresh();
      redraw();
    });
  gridFolder.addInput(P, "gridColor", { label: "Grid" });
  gridFolder.addInput(P, "majorGridColor", { label: "Major" });
  rebuildGridTypeControls();

  const brushFolder = pane.addFolder({ title: "New Object Defaults" });
  brushFolder.addInput(P, "brushPreset", {
    options: Object.fromEntries(Object.keys(BRUSH_PRESETS).map((key) => [key, key])),
    label: "Preset",
  });
  brushFolder.addInput(P, "brushStyle", {
    options: {
      Round: "round",
      FlatNib: "flatNib",
    },
    label: "Style",
  });
  brushFolder.addInput(P, "brushWidthMM", { min: 0.1, max: 40, step: 0.1, label: "Width" });
  brushFolder.addInput(P, "flatNibWidthMM", {
    min: 0.1,
    max: 80,
    step: 0.1,
    label: "Nib Width",
  });
  brushFolder.addInput(P, "flatNibAngleDeg", {
    min: -180,
    max: 180,
    step: 1,
    label: "Nib Angle",
  });
  brushFolder.addInput(P, "strokeColor", { label: "Color" });

  const captureFolder = pane.addFolder({ title: "Capture" });
  captureFolder.addInput(P, "minPointSpacingMM", {
    min: 0.1,
    max: 30,
    step: 0.1,
    label: "Min Spacing",
  });
  captureFolder.addInput(P, "turnThresholdDeg", {
    min: 1,
    max: 180,
    step: 1,
    label: "Turn Threshold",
  });
  captureFolder.addInput(P, "simplifyToleranceMM", {
    min: 0.1,
    max: 40,
    step: 0.1,
    label: "Simplify Tol",
  });

  const smoothingFolder = pane.addFolder({ title: "New Object Smoothing" });
  smoothingFolder.addInput(P, "smoothingMode", {
    options: {
      Off: "off",
      "Chaikin 1": "chaikin1",
      "Chaikin 2": "chaikin2",
    },
    label: "Mode",
  });
  smoothingFolder.addInput(P, "chaikinCornerCut", {
    min: 0.05,
    max: 0.45,
    step: 0.01,
    label: "Corner Cut",
  });

  const viewFolder = pane.addFolder({ title: "View" });
  viewFolder.addInput(P, "showAnchors", { label: "Show Anchors" });
  viewFolder.addInput(P, "showStrokeOutlines", { label: "Show Active" });
  viewFolder.addInput(P, "bg", { label: "BG" });
  viewFolder.addInput(P, "activeStrokeColor", { label: "Active Color" });
  viewFolder.addInput(P, "anchorColor", { label: "Anchor Color" });
  viewFolder.addInput(P, "hoverColor", { label: "Hover Color" });

  const editFolder = pane.addFolder({ title: "Editing" });
  editFolder.addInput(P, "anchorRadiusMM", { min: 0.2, max: 12, step: 0.1, label: "Anchor R" });
  editFolder.addInput(P, "hoverRadiusMM", { min: 0.5, max: 20, step: 0.1, label: "Hover R" });

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgFilename", { label: "Filename" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });

  strokeFolder = pane.addFolder({ title: "Strokes" });
  refreshStrokeMonitor();

  pane.on("change", (event) => {
    const key = event?.presetKey || event?.target?.key || "";
    if (key === "canvasPreset") {
      applyCanvasPreset(P.canvasPreset);
    }
    if (key === "brushPreset") {
      applyBrushPreset(P.brushPreset);
    }
    updateStrokeDefaults();
    sanitizeProjectState();
    invalidateGeometry();
    syncCanvasSize();
    redraw();
  });
}

function hookUI() {
  document.getElementById("undoBtn").addEventListener("click", undoLastPoint);
  document.getElementById("removeStrokeBtn").addEventListener("click", removeActiveStroke);
  document.getElementById("clearBtn").addEventListener("click", () => {
    strokes.length = 0;
    activeStrokeIndex = -1;
    hoveredAnchor = null;
    draggedAnchor = null;
    drawingStrokeIndex = -1;
    invalidateGeometry();
    refreshStrokeMonitor();
    redraw();
  });
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  document.getElementById("spineSvgBtn").addEventListener("click", exportSpineSVG);
  const wrap = document.getElementById("wrap");
  wrap.addEventListener(
    "wheel",
    (event) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      applyPreviewZoom(delta, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    { passive: false }
  );
  wrap.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 2) {
        pinchGestureState = null;
        return;
      }
      event.preventDefault();
      pinchGestureState = getPinchGestureSnapshot(event.touches);
    },
    { passive: false }
  );
  wrap.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 2) {
        pinchGestureState = null;
        return;
      }
      event.preventDefault();
      const nextGesture = getPinchGestureSnapshot(event.touches);
      if (!pinchGestureState || pinchGestureState.distance <= 0 || nextGesture.distance <= 0) {
        pinchGestureState = nextGesture;
        return;
      }
      const zoomFactor = nextGesture.distance / pinchGestureState.distance;
      applyPreviewZoom(zoomFactor, nextGesture.center);
      pinchGestureState = nextGesture;
    },
    { passive: false }
  );
  wrap.addEventListener("touchend", () => {
    pinchGestureState = null;
  });
  wrap.addEventListener("touchcancel", () => {
    pinchGestureState = null;
  });
  window.addEventListener("resize", updateCanvasDisplaySize);
}

function undoLastPoint() {
  const stroke = strokes[strokes.length - 1];
  if (!stroke) {
    return;
  }
  stroke.points.pop();
  if (stroke.points.length < 2) {
    strokes.pop();
  }
  activeStrokeIndex = strokes.length - 1;
  invalidateGeometry();
  refreshStrokeMonitor();
  redraw();
}

function removeActiveStroke() {
  if (activeStrokeIndex < 0 || activeStrokeIndex >= strokes.length) {
    return;
  }
  strokes.splice(activeStrokeIndex, 1);
  activeStrokeIndex = Math.min(activeStrokeIndex, strokes.length - 1);
  hoveredAnchor = null;
  draggedAnchor = null;
  invalidateGeometry();
  refreshStrokeMonitor();
  redraw();
}

function refreshStrokeMonitor() {
  if (!strokeFolder) {
    return;
  }

  strokeFolder.dispose();
  strokeFolder = pane.addFolder({ title: `Objects (${strokes.length})` });
  strokeFolder.addMonitor({ count: strokes.length }, "count", { label: "Count" });
  const pointCount = strokes.reduce((sum, strokeData) => sum + strokeData.points.length, 0);
  strokeFolder.addMonitor({ pointCount }, "pointCount", { label: "Points" });

  const layersFolder = strokeFolder.addFolder({ title: "Layers" });
  if (strokes.length === 0) {
    layersFolder.addMonitor({ empty: "Drag on the canvas to create an object" }, "empty", {
      label: "State",
    });
    return;
  }

  strokes.forEach((strokeData, index) => {
    const marker = index === activeStrokeIndex ? "●" : "○";
    const visibility = strokeData.visible ? "" : " [hidden]";
    const label = `${marker} ${strokeData.label || `Object ${index + 1}`} (${strokeData.points.length} pts)${visibility}`;
    layersFolder.addButton({ title: label }).on("click", () => {
      setActiveStroke(index);
    });
  });

  const activeStroke = getActiveStroke();
  if (!activeStroke) {
    return;
  }

  const objectFolder = strokeFolder.addFolder({ title: "Active Object" });
  objectFolder.addInput(activeStroke, "label", { label: "Name" });
  objectFolder.addInput(activeStroke, "kind", {
    options: {
      Calligraphy: "calligraphy",
      Spine: "spine",
      Guide: "guide",
    },
    label: "Kind",
  });
  objectFolder.addInput(activeStroke, "visible", { label: "Visible" });
  objectFolder.addInput(activeStroke, "exportEnabled", { label: "Export" });
  objectFolder.addInput(activeStroke, "exportMode", {
    options: {
      Preview: "preview",
      Spine: "spine",
    },
    label: "SVG Mode",
  });

  const styleFolder = objectFolder.addFolder({ title: "Style" });
  styleFolder.addInput(activeStroke, "brushStyle", {
    options: {
      Round: "round",
      FlatNib: "flatNib",
    },
    label: "Style",
  });
  styleFolder.addInput(activeStroke, "brushWidthMM", {
    min: 0.1,
    max: 40,
    step: 0.1,
    label: "Width",
  });
  styleFolder.addInput(activeStroke, "flatNibWidthMM", {
    min: 0.1,
    max: 80,
    step: 0.1,
    label: "Nib Width",
  });
  styleFolder.addInput(activeStroke, "flatNibAngleDeg", {
    min: -180,
    max: 180,
    step: 1,
    label: "Nib Angle",
  });
  styleFolder.addInput(activeStroke, "color", { label: "Color" });

  const smoothingFolder = objectFolder.addFolder({ title: "Smoothing" });
  smoothingFolder.addInput(activeStroke, "smoothingMode", {
    options: {
      Off: "off",
      "Chaikin 1": "chaikin1",
      "Chaikin 2": "chaikin2",
    },
    label: "Mode",
  });
  smoothingFolder.addInput(activeStroke, "chaikinCornerCut", {
    min: 0.05,
    max: 0.45,
    step: 0.01,
    label: "Corner Cut",
  });

  const spineFolder = objectFolder.addFolder({ title: "Spine Ops" });
  spineFolder.addButton({ title: "Simplify" }).on("click", () => {
    simplifyActiveStroke(false);
  });
  spineFolder.addButton({ title: "Simplify + Snap" }).on("click", () => {
    simplifyActiveStroke(true);
  });
  spineFolder.addButton({ title: "Snap Anchors" }).on("click", () => {
    snapActiveStrokeToGrid();
  });

  const preview = activeStroke.points
    .slice(0, 8)
    .map((point, index) => `${index + 1}: ${fmt(point.x)}, ${fmt(point.y)}`)
    .join(" | ");
  objectFolder.addMonitor(
    { preview: preview || "Drag to draw this object" },
    "preview",
    {
      label: "Spine",
      multiline: true,
      lineCount: 4,
    }
  );
}

function updateStrokeDefaults() {
  if (drawingStrokeIndex >= 0 && strokes[drawingStrokeIndex]) {
    const strokeData = strokes[drawingStrokeIndex];
    strokeData.brushStyle = P.brushStyle;
    strokeData.brushWidthMM = P.brushWidthMM;
    strokeData.flatNibWidthMM = P.flatNibWidthMM;
    strokeData.flatNibAngleDeg = P.flatNibAngleDeg;
    strokeData.color = P.strokeColor;
    strokeData.smoothingMode = P.smoothingMode;
    strokeData.chaikinCornerCut = P.chaikinCornerCut;
  }
}

function getActiveStroke() {
  if (activeStrokeIndex < 0 || activeStrokeIndex >= strokes.length) {
    return null;
  }
  return strokes[activeStrokeIndex];
}

function setActiveStroke(index) {
  activeStrokeIndex = constrain(index, 0, Math.max(0, strokes.length - 1));
  hoveredAnchor = null;
  draggedAnchor = null;
  refreshStrokeMonitor();
  redraw();
}

function getPinchGestureSnapshot(touches) {
  const first = touches[0];
  const second = touches[1];
  return {
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    center: {
      clientX: (first.clientX + second.clientX) * 0.5,
      clientY: (first.clientY + second.clientY) * 0.5,
    },
  };
}

function applyPreviewZoom(multiplier, pointer) {
  if (!cnv || !pointer || !Number.isFinite(multiplier) || multiplier <= 0) {
    return;
  }

  const wrap = document.getElementById("wrap");
  const previousRect = cnv.elt.getBoundingClientRect();
  const previousScale = P.previewScale;
  const nextScale = constrain(previousScale * multiplier, 0.1, 10);
  if (Math.abs(nextScale - previousScale) < 0.0001) {
    return;
  }

  const relativeX =
    previousRect.width > 0 ? (pointer.clientX - previousRect.left) / previousRect.width : 0.5;
  const relativeY =
    previousRect.height > 0 ? (pointer.clientY - previousRect.top) / previousRect.height : 0.5;

  P.previewScale = nextScale;
  P.fitToViewport = false;
  pane.refresh();
  updateCanvasDisplaySize();

  const nextRect = cnv.elt.getBoundingClientRect();
  wrap.scrollLeft += (nextRect.width - previousRect.width) * relativeX;
  wrap.scrollTop += (nextRect.height - previousRect.height) * relativeY;
  redraw();
}

function simplifyActiveStroke(shouldSnapToGrid) {
  const activeStroke = getActiveStroke();
  if (!activeStroke || activeStroke.points.length < 3) {
    return;
  }

  let nextPoints = simplifyPolylineRDP(
    activeStroke.points,
    Math.max(0.1, P.simplifyToleranceMM)
  );
  if (shouldSnapToGrid) {
    nextPoints = snapPointsToGrid(nextPoints);
  }

  activeStroke.points = ensureValidAnchorSet(nextPoints);
  hoveredAnchor = null;
  draggedAnchor = null;
  invalidateGeometry();
  refreshStrokeMonitor();
  redraw();
}

function snapActiveStrokeToGrid() {
  const activeStroke = getActiveStroke();
  if (!activeStroke || activeStroke.points.length === 0) {
    return;
  }

  activeStroke.points = ensureValidAnchorSet(snapPointsToGrid(activeStroke.points));
  hoveredAnchor = null;
  draggedAnchor = null;
  invalidateGeometry();
  refreshStrokeMonitor();
  redraw();
}

function snapPointsToGrid(points) {
  const spacing = Math.max(0.5, P.gridSpacingMM);
  return points.map((point) => ({
    x: constrain(Math.round(point.x / spacing) * spacing, 0, P.canvasWMM),
    y: constrain(Math.round(point.y / spacing) * spacing, 0, P.canvasHMM),
  }));
}

function ensureValidAnchorSet(points) {
  const deduped = removeSequentialDuplicates(points);
  if (deduped.length <= 2) {
    return deduped.map(copyPoint);
  }

  const result = [copyPoint(deduped[0])];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const point = deduped[i];
    if (distanceBetween(result[result.length - 1], point) > 0.0001) {
      result.push(copyPoint(point));
    }
  }
  result.push(copyPoint(deduped[deduped.length - 1]));
  return result;
}

function simplifyPolylineRDP(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) {
    return points.map(copyPoint);
  }

  const epsilon = Math.max(0.01, tolerance);
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  function recurse(startIndex, endIndex) {
    if (endIndex <= startIndex + 1) {
      return;
    }

    let bestIndex = -1;
    let bestDistance = -1;
    const start = points[startIndex];
    const end = points[endIndex];

    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const distance = perpendicularDistanceToSegment(points[i], start, end);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestDistance > epsilon && bestIndex >= 0) {
      keep[bestIndex] = true;
      recurse(startIndex, bestIndex);
      recurse(bestIndex, endIndex);
    }
  }

  recurse(0, points.length - 1);
  const result = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) {
      result.push(copyPoint(points[i]));
    }
  }
  return result;
}

function perpendicularDistanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return distanceBetween(point, start);
  }

  const t = constrain(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1
  );
  const proj = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  return distanceBetween(point, proj);
}

function applyCanvasPreset(key) {
  const preset = CANVAS_PRESETS[key];
  if (!preset) {
    return;
  }
  P.canvasWMM = preset.widthMM;
  P.canvasHMM = preset.heightMM;
  pane.refresh();
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
      gridFolder.addInput(P, "cursiveSlantDeg", {
        min: 10,
        max: 140,
        step: 1,
        label: "Slant",
      })
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
  if (P.gridType !== "square" && P.gridType !== "slantedCursive") {
    P.gridType = "square";
  }
}

function getActiveGridStepMM() {
  if (P.gridType === "slantedCursive") {
    return Math.max(0.5, P.cursiveSpacingMM);
  }
  return Math.max(0.5, P.gridSpacingMM);
}

function snapPointToActiveGrid(point) {
  if (P.gridType === "slantedCursive") {
    return snapPointToCursiveGrid(point);
  }
  const spacing = Math.max(0.5, P.gridSpacingMM);
  return {
    x: Math.round(point.x / spacing) * spacing,
    y: Math.round(point.y / spacing) * spacing,
  };
}

function snapPointToCursiveGrid(point) {
  const spacing = Math.max(0.5, P.cursiveSpacingMM);
  const slantDeg = constrain(P.cursiveSlantDeg, 10, 140);
  const slantRad = (slantDeg * Math.PI) / 180;
  const sinA = Math.sin(slantRad);
  const cosA = Math.cos(slantRad);
  if (Math.abs(sinA) < 1e-6) {
    return copyPoint(point);
  }

  const snappedY = Math.round(point.y / spacing) * spacing;
  const c = -sinA * point.x + cosA * point.y;
  const snappedC = Math.round(c / spacing) * spacing;
  const snappedX = (cosA * snappedY - snappedC) / sinA;
  return {
    x: snappedX,
    y: snappedY,
  };
}

function applyBrushPreset(key) {
  const preset = BRUSH_PRESETS[key];
  if (!preset) {
    return;
  }
  P.brushStyle = preset.brushStyle;
  P.brushWidthMM = preset.brushWidthMM;
  if (typeof preset.flatNibWidthMM === "number") {
    P.flatNibWidthMM = preset.flatNibWidthMM;
  }
  if (typeof preset.flatNibAngleDeg === "number") {
    P.flatNibAngleDeg = preset.flatNibAngleDeg;
  }
  pane.refresh();
}

function exportSVG() {
  ensureGeometryCache();
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

  for (const renderStroke of cachedRenderStrokes) {
    if (!renderStroke || renderStroke.exportEnabled === false) {
      continue;
    }

    if (renderStroke.exportMode === "spine") {
      if (renderStroke.points.length < 2) {
        continue;
      }
      svg.push(
        `<path d="${polylineToPath(renderStroke.points)}" fill="none" stroke="${escapeXML(
          renderStroke.color
        )}" stroke-width="${fmt(0.35)}" stroke-linecap="round" stroke-linejoin="round"/>`
      );
      continue;
    }

    if (renderStroke.brushStyle === "flatNib") {
      for (const segment of renderStroke.segments) {
        svg.push(
          `<line x1="${fmt(segment.a.x)}" y1="${fmt(segment.a.y)}" x2="${fmt(segment.b.x)}" y2="${fmt(
            segment.b.y
          )}" stroke="${escapeXML(renderStroke.color)}" stroke-width="${fmt(
            renderStroke.brushWidthMM
          )}" stroke-linecap="square"/>`
        );
      }
      continue;
    }

    if (renderStroke.points.length < 2) {
      continue;
    }
    svg.push(
      `<path d="${polylineToPath(renderStroke.points)}" fill="none" stroke="${escapeXML(
        renderStroke.color
      )}" stroke-width="${fmt(renderStroke.brushWidthMM)}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  svg.push("</svg>");
  downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function exportSpineSVG() {
  ensureGeometryCache();
  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(
      P.canvasHMM
    )}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`
  );

  for (const renderStroke of cachedRenderStrokes) {
    if (!renderStroke || renderStroke.exportEnabled === false || renderStroke.points.length < 2) {
      continue;
    }
    svg.push(
      `<path d="${polylineToPath(renderStroke.points)}" fill="none" stroke="${escapeXML(
        renderStroke.color
      )}" stroke-width="${fmt(0.35)}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  svg.push("</svg>");
  downloadText(svg.join("\n"), getSpineSvgFilename(), "image/svg+xml");
}

function getSpineSvgFilename() {
  if (typeof P.svgFilename !== "string" || P.svgFilename.trim() === "") {
    return "Vector-Drawing-Tool-spine.svg";
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

function getPolylineLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distanceBetween(points[i], points[i + 1]);
  }
  return total;
}

function samplePolylineAtDistance(points, distance) {
  const target = Math.max(0, distance);
  let travelled = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const segmentLength = distanceBetween(a, b);
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

function getMousePointMM() {
  const pxPerMM = getPxPerMM();
  if (pxPerMM <= 0 || !isPointerInsideCanvas()) {
    return null;
  }
  return {
    x: constrain(mouseX / pxPerMM, 0, P.canvasWMM),
    y: constrain(mouseY / pxPerMM, 0, P.canvasHMM),
  };
}

function getTouchPointMM(touch) {
  if (!touch) {
    return null;
  }
  return getClientPointMM(touch.clientX, touch.clientY);
}

function getClientPointMM(clientX, clientY) {
  const pxPerMM = getPxPerMM();
  if (!cnv || pxPerMM <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const rect = cnv.elt.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  const canvasX = ((clientX - rect.left) / rect.width) * width;
  const canvasY = ((clientY - rect.top) / rect.height) * height;
  return {
    x: constrain(canvasX / pxPerMM, 0, P.canvasWMM),
    y: constrain(canvasY / pxPerMM, 0, P.canvasHMM),
  };
}

function isPointerInsideCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
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
  const zoomScale = Math.max(0.05, sanitizeNumber(P.previewScale, 1));
  const scale = P.fitToViewport ? fitScale * zoomScale : zoomScale;
  currentDisplayScale = Math.max(0.01, scale);
  cnv.style("width", `${Math.max(1, Math.round(pxSize.width * scale))}px`);
  cnv.style("height", `${Math.max(1, Math.round(pxSize.height * scale))}px`);
  wrap.style.overflow = P.fitToViewport ? "hidden" : "auto";
}

function getCanvasPixelSize() {
  return {
    width: mmToPx(P.canvasWMM),
    height: mmToPx(P.canvasHMM),
  };
}

function getPxPerMM() {
  return P.dpi / MM_PER_INCH;
}

function mmToPx(mm) {
  return Math.max(1, Math.round(mm * getPxPerMM()));
}

function getCornerAngleDeg(a, b, c) {
  if (!a || !b || !c) {
    return 180;
  }

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const abLength = Math.hypot(abx, aby);
  const bcLength = Math.hypot(bcx, bcy);
  if (abLength <= 0.0001 || bcLength <= 0.0001) {
    return 180;
  }

  const dot = constrain((abx * bcx + aby * bcy) / (abLength * bcLength), -1, 1);
  return degrees(Math.acos(dot));
}

function distanceBetween(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function removeSequentialDuplicates(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || !nearlyEqual(last.x, point.x) || !nearlyEqual(last.y, point.y)) {
      result.push(copyPoint(point));
    }
  }
  return result;
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 0.0001;
}

function sanitizeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeProjectState() {
  normalizeGridTypeValue();
  P.gridSpacingMM = Math.max(0.5, sanitizeNumber(P.gridSpacingMM, 10));
  P.cursiveSpacingMM = Math.max(0.5, sanitizeNumber(P.cursiveSpacingMM, 10));
  P.cursiveSlantDeg = constrain(sanitizeNumber(P.cursiveSlantDeg, 70), 10, 140);
  P.cursiveMajorEvery = Math.max(1, Math.floor(sanitizeNumber(P.cursiveMajorEvery, 4)));
  P.previewScale = Math.max(0.1, sanitizeNumber(P.previewScale, 1));
  P.chaikinCornerCut = constrain(sanitizeNumber(P.chaikinCornerCut, 0.25), 0.05, 0.45);
  P.anchorRadiusMM = Math.max(0.2, sanitizeNumber(P.anchorRadiusMM, 1.25));
  P.hoverRadiusMM = Math.max(P.anchorRadiusMM, sanitizeNumber(P.hoverRadiusMM, 2.8));

  for (const strokeData of strokes) {
    strokeData.brushWidthMM = Math.max(0.1, sanitizeNumber(strokeData.brushWidthMM, P.brushWidthMM));
    strokeData.flatNibWidthMM = Math.max(
      0.1,
      sanitizeNumber(strokeData.flatNibWidthMM, P.flatNibWidthMM)
    );
    strokeData.flatNibAngleDeg = sanitizeNumber(strokeData.flatNibAngleDeg, P.flatNibAngleDeg);
    strokeData.chaikinCornerCut = constrain(
      sanitizeNumber(strokeData.chaikinCornerCut, P.chaikinCornerCut),
      0.05,
      0.45
    );
    if (typeof strokeData.smoothingMode !== "string") {
      strokeData.smoothingMode = P.smoothingMode;
    }
  }
}

function fmt(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
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
