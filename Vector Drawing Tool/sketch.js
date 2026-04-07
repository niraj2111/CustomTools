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
    flatNibAngleDeg: 45,
  },
};

let pane;
let cnv;
let strokeFolder;
let geometryDirty = true;
let hoveredAnchor = null;
let draggedAnchor = null;
let activeStrokeIndex = -1;
let drawingStrokeIndex = -1;
let cachedRenderStrokes = [];

const P = {
  canvasPreset: "A4Portrait",
  canvasWMM: CANVAS_PRESETS.A4Portrait.widthMM,
  canvasHMM: CANVAS_PRESETS.A4Portrait.heightMM,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  bg: "#ffffff",
  gridColor: "#dde3ee",
  strokeColor: "#0b1220",
  activeStrokeColor: "#2563eb",
  anchorColor: "#e11d48",
  hoverColor: "#f59e0b",
  showGrid: true,
  gridSpacingMM: 10,
  showAnchors: true,
  showStrokeOutlines: true,
  brushPreset: "Medium",
  brushStyle: "round",
  brushWidthMM: BRUSH_PRESETS.Medium.brushWidthMM,
  flatNibWidthMM: 8,
  flatNibAngleDeg: 45,
  minPointSpacingMM: 2,
  turnThresholdDeg: 18,
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

  if (P.showGrid) {
    drawGrid();
  }

  drawStrokes();

  if (P.showAnchors) {
    drawAnchors();
  }

  pop();
}

function mousePressed() {
  if (!isPointerInsideCanvas()) {
    return;
  }

  updateHoveredAnchor();
  if (hoveredAnchor) {
    draggedAnchor = { strokeIndex: hoveredAnchor.strokeIndex, pointIndex: hoveredAnchor.pointIndex };
    activeStrokeIndex = hoveredAnchor.strokeIndex;
    redraw();
    return;
  }

  const point = getMousePointMM();
  if (!point) {
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
  const point = getMousePointMM();
  if (!point) {
    return;
  }

  if (draggedAnchor) {
    const stroke = strokes[draggedAnchor.strokeIndex];
    if (!stroke) {
      return;
    }
    stroke.points[draggedAnchor.pointIndex] = point;
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

function mouseReleased() {
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
  const points = stroke.points;
  const last = points[points.length - 1];
  if (!force && last && distanceBetween(last, point) < Math.max(0.1, P.minPointSpacingMM)) {
    points[points.length - 1] = point;
    return;
  }

  if (!force && points.length >= 2) {
    const prev = points[points.length - 2];
    const angle = getCornerAngleDeg(prev, last, point);
    if (angle < Math.max(1, P.turnThresholdDeg) && distanceBetween(last, point) < P.minPointSpacingMM * 1.75) {
      points[points.length - 1] = point;
      return;
    }
  }

  points.push(point);
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

function drawGrid() {
  stroke(P.gridColor);
  strokeWeight(0.2);
  noFill();
  const spacing = Math.max(0.5, P.gridSpacingMM);

  for (let x = 0; x <= P.canvasWMM + 0.001; x += spacing) {
    line(x, 0, x, P.canvasHMM);
  }
  for (let y = 0; y <= P.canvasHMM + 0.001; y += spacing) {
    line(0, y, P.canvasWMM, y);
  }
}

function drawStrokes() {
  for (let i = 0; i < cachedRenderStrokes.length; i += 1) {
    const renderStroke = cachedRenderStrokes[i];
    if (!renderStroke) {
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

function updateHoveredAnchor() {
  hoveredAnchor = findHoveredAnchor();
}

function findHoveredAnchor() {
  const point = getMousePointMM();
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

function ensureGeometryCache() {
  if (!geometryDirty) {
    return;
  }

  cachedRenderStrokes = strokes.map((strokeData) => {
    const points = getRenderPointsForStroke(strokeData);
    if (strokeData.brushStyle === "flatNib") {
      return {
        brushStyle: strokeData.brushStyle,
        color: strokeData.color,
        brushWidthMM: strokeData.brushWidthMM,
        points,
        segments: buildFlatNibSegments(points, strokeData),
      };
    }

    return {
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

  switch (P.smoothingMode) {
    case "chaikin2":
      points = chaikin(points, P.chaikinCornerCut);
      points = chaikin(points, P.chaikinCornerCut);
      break;
    case "chaikin1":
      points = chaikin(points, P.chaikinCornerCut);
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

  const ratio = constrain(cutRatio, 0.01, 0.49);
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

  const spacing = Math.max(0.4, strokeData.brushWidthMM * 0.9);
  const centers = getSampledCenters(points, spacing);
  const angle = radians(strokeData.flatNibAngleDeg);
  const halfWidthX = Math.cos(angle) * strokeData.flatNibWidthMM * 0.5;
  const halfWidthY = Math.sin(angle) * strokeData.flatNibWidthMM * 0.5;

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

  const brushFolder = pane.addFolder({ title: "Brush" });
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

  const smoothingFolder = pane.addFolder({ title: "Smoothing" });
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
  viewFolder.addInput(P, "showGrid", { label: "Show Grid" });
  viewFolder.addInput(P, "gridSpacingMM", { min: 1, max: 100, step: 0.5, label: "Grid" });
  viewFolder.addInput(P, "showAnchors", { label: "Show Anchors" });
  viewFolder.addInput(P, "showStrokeOutlines", { label: "Show Active" });
  viewFolder.addInput(P, "bg", { label: "BG" });
  viewFolder.addInput(P, "gridColor", { label: "Grid Color" });
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
    if (event.presetKey === "canvasPreset" || event.target.key === "canvasPreset") {
      applyCanvasPreset(P.canvasPreset);
    }
    if (event.presetKey === "brushPreset" || event.target.key === "brushPreset") {
      applyBrushPreset(P.brushPreset);
    }
    updateStrokeDefaults();
    invalidateGeometry();
    syncCanvasSize();
    refreshStrokeMonitor();
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
  strokeFolder = pane.addFolder({ title: `Strokes (${strokes.length})` });
  strokeFolder.addMonitor({ count: strokes.length }, "count", { label: "Count" });
  const pointCount = strokes.reduce((sum, strokeData) => sum + strokeData.points.length, 0);
  strokeFolder.addMonitor({ pointCount }, "pointCount", { label: "Points" });
  const preview = strokes
    .slice(0, 5)
    .map((strokeData, index) => `${index + 1}: ${strokeData.points.length} pts`)
    .join(" | ");
  strokeFolder.addMonitor(
    { preview: preview || "Drag on the canvas to create a stroke" },
    "preview",
    {
      label: "Preview",
      multiline: true,
      lineCount: 3,
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

function applyCanvasPreset(key) {
  const preset = CANVAS_PRESETS[key];
  if (!preset) {
    return;
  }
  P.canvasWMM = preset.widthMM;
  P.canvasHMM = preset.heightMM;
  pane.refresh();
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
    if (!renderStroke) {
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
    if (!renderStroke || renderStroke.points.length < 2) {
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
  const scale = P.fitToViewport ? fitScale * P.previewScale : P.previewScale;
  cnv.style("width", `${Math.max(1, Math.round(pxSize.width * scale))}px`);
  cnv.style("height", `${Math.max(1, Math.round(pxSize.height * scale))}px`);
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
