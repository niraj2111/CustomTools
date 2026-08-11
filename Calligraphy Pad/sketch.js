const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const paneHost = document.getElementById("pane");
const appShell = document.getElementById("appShell");
const controlPanel = document.getElementById("controlPanel");
const collapseBtn = document.getElementById("collapseBtn");
const showPanelBtn = document.getElementById("showPanelBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const streamBtn = document.getElementById("streamBtn");
const pathSvgBtn = document.getElementById("pathSvgBtn");
const brushSvgBtn = document.getElementById("brushSvgBtn");
const floatingUndoBtn = document.getElementById("floatingUndoBtn");
const floatingStreamBtn = document.getElementById("floatingStreamBtn");
const connectionBadge = document.getElementById("connectionBadge");
const paperBadge = document.getElementById("paperBadge");
const brushBadge = document.getElementById("brushBadge");
const status = document.getElementById("status");
const canvasWrap = document.getElementById("canvasWrap");
const penMarker = document.getElementById("penMarker");

const strokes = [];
const selectedStrokeIds = new Set();

const P = {
  paperPreset: "A4 Portrait",
  canvasWMM: 210,
  canvasHMM: 297,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 20,
  showMargins: true,
};

const UI = {
  tool: "draw",
  autoStream: false,
  showGrid: true,
  snapGrid: false,
  brushType: "round",
  roundSize: 1.6,
  flatWidth: 3.2,
  flatAngle: 40,
  streamline: 0.45,
  smoothing: 0.25,
  minDistance: 0.6,
};

const saxiHost = "127.0.0.1:9080";
const view = {
  pxPerMM: 1,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  canvasWidth: 0,
  canvasHeight: 0,
};

let committedLayer = createLayer();
let activeLayer = createLayer();
let current = null;
let socket = null;
let streamTimer = null;
let frameTimer = null;
let connected = false;
let pane = null;
let tool = "draw";
let panelCollapsed = false;
let lassoPoints = [];
let transformState = null;
let nextStrokeId = 1;
let committedDirty = true;
let hoverPointer = null;
let gestureState = null;
const activeTouchPointers = new Map();

function makeValueBinding(object, key) {
  return {
    get value() {
      return String(object[key]);
    },
    set value(next) {
      object[key] = typeof object[key] === "number" ? Number(next) : next;
    },
  };
}

function makeCheckedBinding(object, key) {
  return {
    get checked() {
      return !!object[key];
    },
    set checked(next) {
      object[key] = !!next;
    },
  };
}

const autoStream = makeCheckedBinding(UI, "autoStream");
const showGrid = makeCheckedBinding(UI, "showGrid");
const snapGrid = makeCheckedBinding(UI, "snapGrid");
const brushType = makeValueBinding(UI, "brushType");
const roundSize = makeValueBinding(UI, "roundSize");
const flatWidth = makeValueBinding(UI, "flatWidth");
const flatAngle = makeValueBinding(UI, "flatAngle");
const streamlineInput = makeValueBinding(UI, "streamline");
const smoothingInput = makeValueBinding(UI, "smoothing");
const minDistanceInput = makeValueBinding(UI, "minDistance");

function createLayer() {
  return document.createElement("canvas");
}

function fmt(n, digits = 3) {
  return ExportUtils.fmt(Number(n), digits);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function sq(v) {
  return v * v;
}

function mmToCanvasPx(point) {
  const scale = view.pxPerMM * view.zoom;
  return {
    x: view.offsetX + point.x * scale,
    y: view.offsetY + point.y * scale,
  };
}

function pointerToMM(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const xPx = (event.clientX - rect.left) * (canvas.width / rect.width);
  const yPx = (event.clientY - rect.top) * (canvas.height / rect.height);
  const scale = view.pxPerMM * view.zoom;
  return {
    x: clamp((xPx - view.offsetX) / scale, 0, P.canvasWMM),
    y: clamp((yPx - view.offsetY) / scale, 0, P.canvasHMM),
  };
}

function pointFromPointer(event) {
  return pointerToMM(event);
}

function makeStrokeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const id = nextStrokeId;
  nextStrokeId += 1;
  return `stroke-${id}`;
}

function getBrushSnapshot() {
  return {
    type: brushType.value,
    roundSizeMM: Number(roundSize.value),
    flatWidthMM: Number(flatWidth.value),
    flatAngleDeg: Number(flatAngle.value),
    streamline: Number(streamlineInput.value),
    smoothing: Number(smoothingInput.value),
    minDistanceMM: Number(minDistanceInput.value),
    snapToGrid: snapGrid.checked,
  };
}

function getBrushDisplayLabel(brush) {
  if (brush.type === "flat") {
    return `brush: flat ${fmt(brush.flatWidthMM)} mm @ ${fmt(brush.flatAngleDeg)} deg`;
  }
  return `brush: round ${fmt(brush.roundSizeMM)} mm`;
}

function isPenPointerEvent(event) {
  return event && event.pointerType === "pen";
}

function eventShowsHover(event) {
  return isPenPointerEvent(event) && (event.buttons === 0 || event.pressure === 0);
}

function updatePenMarkerFromPointer(pointMm, brush, pointerEvent = null) {
  if (!pointMm) return;

  const pointPx = mmToCanvasPx(pointMm);
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const x = canvasRect.left - wrapRect.left + pointPx.x * (canvasRect.width / Math.max(1, canvas.width));
  const y = canvasRect.top - wrapRect.top + pointPx.y * (canvasRect.height / Math.max(1, canvas.height));

  const scale = canvasRect.width / Math.max(1, canvas.width);
  const sizePx = Math.max(8, getBrushSizeMM(brush) * view.pxPerMM * scale);
  penMarker.style.width = `${sizePx}px`;
  penMarker.style.height = `${Math.max(8, brush.type === "flat" ? sizePx * 0.26 : sizePx)}px`;
  penMarker.style.left = `${x}px`;
  penMarker.style.top = `${y}px`;
  penMarker.classList.toggle("flat", brush.type === "flat");

  const angle = brush.type === "flat" ? brush.flatAngleDeg : 0;
  const pressure = pointerEvent && Number.isFinite(pointerEvent.pressure) ? pointerEvent.pressure : 0;
  const opacity = eventShowsHover(pointerEvent) ? 0.7 : clamp(0.45 + pressure * 0.5, 0.45, 1);
  penMarker.style.opacity = `${opacity}`;
  penMarker.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  penMarker.classList.remove("hidden");
}

function hidePenMarker() {
  penMarker.classList.add("hidden");
  hoverPointer = null;
}

function getBrushSizeMM(brush) {
  return brush.type === "flat" ? brush.flatWidthMM : brush.roundSizeMM;
}

function getBrushStampStepMM(brush) {
  return Math.max(0.25, getBrushSizeMM(brush) * 0.25);
}

function getViewportBaseScale() {
  return PaperUtils.getPxPerMM(P);
}

function getViewportScale() {
  return view.pxPerMM * view.zoom;
}

function fitPaperToViewport(resetPan = false) {
  const baseScale = getViewportBaseScale();
  const fitScaleX = view.canvasWidth / Math.max(P.canvasWMM, 1);
  const fitScaleY = view.canvasHeight / Math.max(P.canvasHMM, 1);
  const fitZoom = Math.min(fitScaleX, fitScaleY) / Math.max(baseScale, 0.0001);

  if (P.fitToViewport) {
    view.zoom = clamp(fitZoom, 0.05, 12);
    P.previewScale = view.zoom;
  } else if (!Number.isFinite(view.zoom) || view.zoom <= 0) {
    view.zoom = clamp(P.previewScale || 1, 0.05, 12);
  }

  view.pxPerMM = baseScale;
  const scale = getViewportScale();
  const paperWidthPx = P.canvasWMM * scale;
  const paperHeightPx = P.canvasHMM * scale;

  if (resetPan || P.fitToViewport) {
    view.offsetX = (view.canvasWidth - paperWidthPx) * 0.5;
    view.offsetY = (view.canvasHeight - paperHeightPx) * 0.5;
    return;
  }

  const minOffsetX = Math.min(32, view.canvasWidth - paperWidthPx - 32);
  const maxOffsetX = Math.max(view.canvasWidth - paperWidthPx - 32, 32);
  const minOffsetY = Math.min(32, view.canvasHeight - paperHeightPx - 32);
  const maxOffsetY = Math.max(view.canvasHeight - paperHeightPx - 32, 32);
  view.offsetX = clamp(view.offsetX, minOffsetX, maxOffsetX);
  view.offsetY = clamp(view.offsetY, minOffsetY, maxOffsetY);
}

function setManualZoom(nextZoom, anchorPx = null) {
  const prevScale = getViewportScale();
  const prevOffsetX = view.offsetX;
  const prevOffsetY = view.offsetY;
  const clampedZoom = clamp(nextZoom, 0.05, 12);
  P.fitToViewport = false;
  view.zoom = clampedZoom;
  P.previewScale = clampedZoom;
  view.pxPerMM = getViewportBaseScale();

  if (anchorPx && prevScale > 0) {
    const mmX = (anchorPx.x - prevOffsetX) / prevScale;
    const mmY = (anchorPx.y - prevOffsetY) / prevScale;
    const nextScale = getViewportScale();
    view.offsetX = anchorPx.x - mmX * nextScale;
    view.offsetY = anchorPx.y - mmY * nextScale;
  }

  fitPaperToViewport(false);
  syncPaperControlsFromState();
  committedDirty = true;
  queueRedraw();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
}

function panViewport(deltaX, deltaY) {
  P.fitToViewport = false;
  view.offsetX += deltaX;
  view.offsetY += deltaY;
  fitPaperToViewport(false);
  syncPaperControlsFromState();
  committedDirty = true;
  queueRedraw();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
}

function getEventCanvasPx(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)),
    y: (event.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)),
  };
}

function gestureCenter(points) {
  return {
    x: (points[0].x + points[1].x) * 0.5,
    y: (points[0].y + points[1].y) * 0.5,
  };
}

function gestureDistance(points) {
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

function beginTouchGesture() {
  const points = Array.from(activeTouchPointers.values());
  if (points.length < 2) return;
  gestureState = {
    center: gestureCenter(points),
    distance: Math.max(gestureDistance(points), 1),
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
  };
}

function updateTouchGesture() {
  const points = Array.from(activeTouchPointers.values());
  if (points.length < 2) return;
  if (!gestureState) {
    beginTouchGesture();
  }
  if (!gestureState) return;

  const center = gestureCenter(points);
  const distance = Math.max(gestureDistance(points), 1);
  const zoomRatio = distance / gestureState.distance;
  const nextZoom = clamp(gestureState.zoom * zoomRatio, 0.05, 12);
  const anchorCanvas = {
    x: center.x,
    y: center.y,
  };

  P.fitToViewport = false;
  view.zoom = nextZoom;
  P.previewScale = nextZoom;
  view.pxPerMM = getViewportBaseScale();

  const scaleAtStart = view.pxPerMM * gestureState.zoom;
  const anchorMM = {
    x: (gestureState.center.x - gestureState.offsetX) / scaleAtStart,
    y: (gestureState.center.y - gestureState.offsetY) / scaleAtStart,
  };
  const nextScale = getViewportScale();
  view.offsetX = anchorCanvas.x - anchorMM.x * nextScale;
  view.offsetY = anchorCanvas.y - anchorMM.y * nextScale;
  view.offsetX += center.x - gestureState.center.x;
  view.offsetY += center.y - gestureState.center.y;

  fitPaperToViewport(false);
  syncPaperControlsFromState();
  committedDirty = true;
  queueRedraw();
}

function syncPaperControlsFromState() {
  pane?.refresh();
}

function updateBadges() {
  connectionBadge.textContent = `socket: ${connected ? "connected" : "disconnected"}`;
  const presetText = P.paperPreset === "Custom" ? "Custom" : P.paperPreset;
  paperBadge.textContent = `paper: ${presetText} ${fmt(P.canvasWMM)} x ${fmt(P.canvasHMM)} mm`;
  brushBadge.textContent = getBrushDisplayLabel(getBrushSnapshot());
}

function updateControlLabels() {
  updateBadges();
  pane?.refresh();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
}

function updateToolButtons() {
  UI.tool = tool;
  pane?.refresh();
}

function setTool(next) {
  tool = next;
  current = null;
  clearLayer(activeLayer);
  lassoPoints = [];
  transformState = null;
  if (tool !== "transform") {
    selectedStrokeIds.clear();
  }
  updateToolButtons();
  queueRedraw();
}

function setPanelCollapsed(next) {
  panelCollapsed = next;
  appShell.classList.toggle("panel-collapsed", panelCollapsed);
  controlPanel.classList.toggle("collapsed", panelCollapsed);
  showPanelBtn.classList.toggle("hidden", !panelCollapsed);
  syncCanvasSize();
}

function buildPane() {
  pane = new Tweakpane.Pane({ container: paneHost, title: "Controls" });

  const fTool = pane.addFolder({ title: "Tool", expanded: true });
  fTool
    .addInput(UI, "tool", {
      options: {
        Draw: "draw",
        Lasso: "lasso",
        Transform: "transform",
      },
    })
    .on("change", (event) => setTool(event.value));
  fTool.addInput(UI, "autoStream", { label: "Auto stream" });
  fTool.addInput(UI, "showGrid", { label: "Show grid" }).on("change", () => {
    committedDirty = true;
    queueRedraw();
  });
  fTool.addInput(UI, "snapGrid", { label: "Snap grid" }).on("change", () => {
    applyCurrentBrushToExistingStrokes();
  });

  const fPaper = pane.addFolder({ title: "Paper", expanded: true });
  fPaper
    .addInput(P, "paperPreset", {
      label: "Preset",
      options: Object.keys(PaperUtils.PAPER_PRESETS_MM).reduce((acc, name) => {
        acc[name] = name;
        return acc;
      }, {}),
    })
    .on("change", (event) => {
      PaperUtils.applyPaperPreset(P, event.value);
      syncPaperControlsFromState();
      updateBadges();
      syncCanvasSize();
    });
  fPaper
    .addInput(P, "canvasWMM", { label: "Width", min: 60, max: 1000, step: 1 })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      syncPaperControlsFromState();
      updateBadges();
      syncCanvasSize();
    });
  fPaper
    .addInput(P, "canvasHMM", { label: "Height", min: 60, max: 1000, step: 1 })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      syncPaperControlsFromState();
      updateBadges();
      syncCanvasSize();
    });
  fPaper.addInput(P, "dpi", { min: 36, max: 1200, step: 1 }).on("change", syncCanvasSize);
  fPaper.addInput(P, "fitToViewport", { label: "Fit preview" }).on("change", syncCanvasSize);
  fPaper.addInput(P, "previewScale", { label: "Zoom", min: 0.05, max: 12, step: 0.01 }).on("change", () => {
    setManualZoom(P.previewScale);
  });
  fPaper.addInput(P, "showMargins", { label: "Show margins" }).on("change", () => {
    committedDirty = true;
    queueRedraw();
  });
  fPaper.addInput(P, "marginMM", { label: "Margin", min: 0, max: 80, step: 0.5 }).on("change", () => {
    committedDirty = true;
    queueRedraw();
    updateBadges();
  });

  const fBrush = pane.addFolder({ title: "Brush", expanded: true });
  fBrush
    .addInput(UI, "brushType", {
      label: "Type",
      options: {
        Round: "round",
        "Flat nib": "flat",
      },
    })
    .on("change", () => {
      updateControlLabels();
      applyCurrentBrushToExistingStrokes();
    });
  fBrush.addInput(UI, "roundSize", { label: "Round size", min: 0.4, max: 8, step: 0.1 }).on("change", () => {
    applyCurrentBrushToExistingStrokes();
    updateControlLabels();
  });
  fBrush.addInput(UI, "flatWidth", { label: "Flat width", min: 0.6, max: 12, step: 0.1 }).on("change", () => {
    applyCurrentBrushToExistingStrokes();
    updateControlLabels();
  });
  fBrush.addInput(UI, "flatAngle", { label: "Nib angle", min: 0, max: 180, step: 1 }).on("change", () => {
    applyCurrentBrushToExistingStrokes();
    updateControlLabels();
  });

  const fStroke = pane.addFolder({ title: "Stroke", expanded: true });
  fStroke.addInput(UI, "streamline", { min: 0, max: 2, step: 0.01 }).on("change", applyCurrentBrushToExistingStrokes);
  fStroke.addInput(UI, "smoothing", { min: 0, max: 2, step: 0.01 }).on("change", applyCurrentBrushToExistingStrokes);
  fStroke.addInput(UI, "minDistance", { label: "Min distance", min: 0.1, max: 5, step: 0.1 }).on(
    "change",
    applyCurrentBrushToExistingStrokes,
  );
}

function styleProxyForCanvas(target) {
  return {
    style(name, value) {
      target.style[name] = value;
    },
  };
}

function syncCanvasSize() {
  const wrapRect = canvasWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(wrapRect.width * dpr));
  const height = Math.max(1, Math.round(wrapRect.height * dpr));

  view.canvasWidth = width;
  view.canvasHeight = height;
  canvas.width = width;
  canvas.height = height;
  committedLayer.width = width;
  committedLayer.height = height;
  activeLayer.width = width;
  activeLayer.height = height;

  canvas.style.width = "100%";
  canvas.style.height = "100%";
  fitPaperToViewport(!gestureState);
  committedDirty = true;
  clearLayer(activeLayer);
  queueRedraw();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
}

function clearLayer(layer) {
  const layerCtx = layer.getContext("2d");
  layerCtx.clearRect(0, 0, layer.width, layer.height);
}

function withPaperScale(targetCtx, fn) {
  targetCtx.save();
  const scale = getViewportScale();
  targetCtx.setTransform(scale, 0, 0, scale, view.offsetX, view.offsetY);
  fn(targetCtx);
  targetCtx.restore();
}

function invalidateStrokeCaches(stroke) {
  stroke.pathDirty = true;
  stroke.brushDirty = true;
}

function rebuildStrokePointsFromRaw(rawPoints, brush) {
  if (!rawPoints.length) {
    return { points: [], filtered: null };
  }

  let filtered = rawPoints[0];
  let point = filtered;
  if (brush.snapToGrid) {
    point = {
      x: Math.round(point.x / 5) * 5,
      y: Math.round(point.y / 5) * 5,
    };
  }
  const points = [point];

  for (let i = 1; i < rawPoints.length; i += 1) {
    filtered = lerp(filtered, rawPoints[i], clamp(1 - brush.streamline * 0.45, 0.015, 1));
    point = filtered;
    if (brush.snapToGrid) {
      point = {
        x: Math.round(point.x / 5) * 5,
        y: Math.round(point.y / 5) * 5,
      };
    }

    const last = points[points.length - 1];
    if (!last || dist(last, point) >= brush.minDistanceMM) {
      points.push(point);
    }
  }

  return { points, filtered };
}

function applyCurrentBrushToExistingStrokes() {
  const nextBrush = getBrushSnapshot();
  for (const stroke of strokes) {
    stroke.brush = { ...nextBrush };
    const rebuilt = rebuildStrokePointsFromRaw(stroke.rawPoints, stroke.brush);
    stroke.points = rebuilt.points;
    stroke.filtered = rebuilt.filtered || stroke.filtered;
    invalidateStrokeCaches(stroke);
  }
  clearLayer(activeLayer);
  committedDirty = true;
  queueRedraw();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
}

function createStroke(point) {
  const brush = getBrushSnapshot();
  return {
    id: makeStrokeId(),
    rawPoints: [point],
    points: [point],
    filtered: point,
    brush,
    pathCache: [],
    brushCache: [],
    pathDirty: true,
    brushDirty: true,
  };
}

function smoothPath(points, smoothing) {
  if (points.length < 3) return points.slice();
  if (smoothing <= 0.001) return points.slice();

  const passes = Math.max(1, Math.min(5, Math.round(1 + smoothing * 2)));
  const alpha = clamp(0.08 + smoothing * 0.12, 0.08, 0.28);
  let out = points.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i += 1) {
      const prev = out[i - 1];
      const cur = out[i];
      const after = out[i + 1];
      next.push({
        x: cur.x * (1 - alpha * 2) + (prev.x + after.x) * alpha,
        y: cur.y * (1 - alpha * 2) + (prev.y + after.y) * alpha,
      });
    }
    next.push(out[out.length - 1]);
    out = next;
  }

  return out;
}

function getStrokePathPoints(stroke) {
  if (!stroke.pathDirty) {
    return stroke.pathCache;
  }
  stroke.pathCache = smoothPath(stroke.points, stroke.brush.smoothing).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  stroke.pathDirty = false;
  return stroke.pathCache;
}

function pointOnFlatStamp(center, width, angleRad, xDir, yDir) {
  const halfWidth = width * 0.5;
  const thickness = Math.max(0.12, width * 0.18);
  return {
    x: center.x + xDir * Math.cos(angleRad) * halfWidth + yDir * -Math.sin(angleRad) * thickness * 0.5,
    y: center.y + xDir * Math.sin(angleRad) * halfWidth + yDir * Math.cos(angleRad) * thickness * 0.5,
  };
}

function buildFlatPolygon(center, width, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return [
    pointOnFlatStamp(center, width, angleRad, -1, -1),
    pointOnFlatStamp(center, width, angleRad, 1, -1),
    pointOnFlatStamp(center, width, angleRad, 1, 1),
    pointOnFlatStamp(center, width, angleRad, -1, 1),
  ];
}

function buildBrushStampCache(stroke) {
  if (!stroke.brushDirty) {
    return stroke.brushCache;
  }

  const brush = stroke.brush;
  const path = getStrokePathPoints(stroke);
  const step = getBrushStampStepMM(brush);
  const stamps = [];
  const pushStamp = (point) => {
    if (brush.type === "flat") {
      stamps.push({
        kind: "polygon",
        points: buildFlatPolygon(point, brush.flatWidthMM, brush.flatAngleDeg),
      });
    } else {
      stamps.push({
        kind: "circle",
        x: point.x,
        y: point.y,
        r: brush.roundSizeMM * 0.5,
      });
    }
  };

  if (path.length === 1) {
    pushStamp(path[0]);
  } else if (path.length > 1) {
    pushStamp(path[0]);
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      const length = dist(a, b);
      const steps = Math.max(1, Math.ceil(length / step));
      for (let j = 1; j <= steps; j += 1) {
        pushStamp(lerp(a, b, j / steps));
      }
    }
  }

  stroke.brushCache = stamps;
  stroke.brushDirty = false;
  return stroke.brushCache;
}

function drawStampGeometry(targetCtx, stamp) {
  if (stamp.kind === "circle") {
    targetCtx.beginPath();
    targetCtx.arc(stamp.x, stamp.y, stamp.r, 0, Math.PI * 2);
    targetCtx.fill();
    return;
  }

  const points = stamp.points || [];
  if (!points.length) return;
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    targetCtx.lineTo(points[i].x, points[i].y);
  }
  targetCtx.closePath();
  targetCtx.fill();
}

function drawStrokeToLayer(layer, stroke) {
  const layerCtx = layer.getContext("2d");
  const stamps = buildBrushStampCache(stroke);
  if (!stamps.length) return;
  withPaperScale(layerCtx, (scaledCtx) => {
    scaledCtx.fillStyle = "rgba(17, 17, 17, 0.92)";
    for (const stamp of stamps) {
      drawStampGeometry(scaledCtx, stamp);
    }
  });
}

function drawIncrementalStrokeSegment(layer, stroke, fromPoint, toPoint) {
  const layerCtx = layer.getContext("2d");
  const brush = stroke.brush;
  const step = getBrushStampStepMM(brush);
  withPaperScale(layerCtx, (scaledCtx) => {
    scaledCtx.fillStyle = "rgba(17, 17, 17, 0.92)";
    if (!fromPoint) {
      const firstStamp =
        brush.type === "flat"
          ? { kind: "polygon", points: buildFlatPolygon(toPoint, brush.flatWidthMM, brush.flatAngleDeg) }
          : { kind: "circle", x: toPoint.x, y: toPoint.y, r: brush.roundSizeMM * 0.5 };
      drawStampGeometry(scaledCtx, firstStamp);
      return;
    }

    const length = dist(fromPoint, toPoint);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let i = 1; i <= steps; i += 1) {
      const point = lerp(fromPoint, toPoint, i / steps);
      if (brush.type === "flat") {
        drawStampGeometry(scaledCtx, {
          kind: "polygon",
          points: buildFlatPolygon(point, brush.flatWidthMM, brush.flatAngleDeg),
        });
      } else {
        drawStampGeometry(scaledCtx, {
          kind: "circle",
          x: point.x,
          y: point.y,
          r: brush.roundSizeMM * 0.5,
        });
      }
    }
  });
}

function drawGridAndGuides(targetCtx) {
  targetCtx.fillStyle = "#0f1620";
  targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);

  withPaperScale(targetCtx, (scaledCtx) => {
    scaledCtx.fillStyle = "#ffffff";
    scaledCtx.fillRect(0, 0, P.canvasWMM, P.canvasHMM);

    if (showGrid.checked) {
      for (let x = 0; x <= P.canvasWMM; x += 5) {
        const major = x % 25 === 0;
        scaledCtx.beginPath();
        scaledCtx.moveTo(x, 0);
        scaledCtx.lineTo(x, P.canvasHMM);
        scaledCtx.strokeStyle = major ? "#cbd3e2" : "#e7ebf3";
        scaledCtx.lineWidth = major ? 1.1 / getViewportScale() : 0.7 / getViewportScale();
        scaledCtx.stroke();
      }

      for (let y = 0; y <= P.canvasHMM; y += 5) {
        const major = y % 25 === 0;
        scaledCtx.beginPath();
        scaledCtx.moveTo(0, y);
        scaledCtx.lineTo(P.canvasWMM, y);
        scaledCtx.strokeStyle = major ? "#cbd3e2" : "#e7ebf3";
        scaledCtx.lineWidth = major ? 1.1 / getViewportScale() : 0.7 / getViewportScale();
        scaledCtx.stroke();
      }
    }

    scaledCtx.strokeStyle = "#c6cfdf";
    scaledCtx.lineWidth = 1 / getViewportScale();
    scaledCtx.strokeRect(0, 0, P.canvasWMM, P.canvasHMM);

    if (P.showMargins) {
      const margin = clamp(P.marginMM, 0, Math.min(P.canvasWMM, P.canvasHMM) * 0.5);
      scaledCtx.save();
      scaledCtx.setLineDash([5 / getViewportScale(), 4 / getViewportScale()]);
      scaledCtx.strokeStyle = "#7e889f";
      scaledCtx.lineWidth = 1 / getViewportScale();
      scaledCtx.strokeRect(
        margin,
        margin,
        Math.max(0, P.canvasWMM - margin * 2),
        Math.max(0, P.canvasHMM - margin * 2),
      );
      scaledCtx.restore();
    }
  });
}

function rerenderCommittedLayer() {
  const layerCtx = committedLayer.getContext("2d");
  layerCtx.clearRect(0, 0, committedLayer.width, committedLayer.height);
  drawGridAndGuides(layerCtx);
  for (const stroke of strokes) {
    drawStrokeToLayer(committedLayer, stroke);
  }
  committedDirty = false;
}

function computeSelectionBounds() {
  const selected = strokes.filter((stroke) => selectedStrokeIds.has(stroke.id));
  if (!selected.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of selected) {
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function getTransformHandles(bounds) {
  const topLeft = mmToCanvasPx({ x: bounds.minX, y: bounds.minY });
  const topRight = mmToCanvasPx({ x: bounds.maxX, y: bounds.minY });
  const bottomLeft = mmToCanvasPx({ x: bounds.minX, y: bounds.maxY });
  const bottomRight = mmToCanvasPx({ x: bounds.maxX, y: bounds.maxY });
  const topCenter = mmToCanvasPx({ x: bounds.centerX, y: bounds.minY });
  return {
    tl: topLeft,
    tr: topRight,
    bl: bottomLeft,
    br: bottomRight,
    rotate: { x: topCenter.x, y: topCenter.y - 32 },
  };
}

function hitTestTransform(pointMm) {
  const bounds = computeSelectionBounds();
  if (!bounds) return null;

  const pointPx = mmToCanvasPx(pointMm);
  const handles = getTransformHandles(bounds);
  for (const [name, handle] of Object.entries(handles)) {
    if (Math.hypot(pointPx.x - handle.x, pointPx.y - handle.y) <= 12) {
      return { type: name === "rotate" ? "rotate" : "scale", handle: name, bounds };
    }
  }

  if (
    pointMm.x >= bounds.minX &&
    pointMm.x <= bounds.maxX &&
    pointMm.y >= bounds.minY &&
    pointMm.y <= bounds.maxY
  ) {
    return { type: "move", bounds };
  }

  return null;
}

function transformPoint(point, centerX, centerY, moveX, moveY, scaleX, scaleY, angle) {
  let x = point.x - centerX;
  let y = point.y - centerY;

  x *= scaleX;
  y *= scaleY;

  if (angle !== 0) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }

  return {
    x: clamp(centerX + x + moveX, 0, P.canvasWMM),
    y: clamp(centerY + y + moveY, 0, P.canvasHMM),
  };
}

function applyTransformFromState(pointMm) {
  if (!transformState) return;

  const bounds = transformState.bounds;
  const cx = bounds.centerX;
  const cy = bounds.centerY;
  let moveX = 0;
  let moveY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let angle = 0;

  if (transformState.type === "move") {
    moveX = pointMm.x - transformState.anchor.x;
    moveY = pointMm.y - transformState.anchor.y;
  } else if (transformState.type === "rotate") {
    const startAngle = Math.atan2(transformState.anchor.y - cy, transformState.anchor.x - cx);
    const nextAngle = Math.atan2(pointMm.y - cy, pointMm.x - cx);
    angle = nextAngle - startAngle;
  } else if (transformState.type === "scale") {
    const sx0 = transformState.anchor.x - cx;
    const sy0 = transformState.anchor.y - cy;
    const sx1 = pointMm.x - cx;
    const sy1 = pointMm.y - cy;
    scaleX = Math.abs(sx0) < 0.001 ? 1 : sx1 / sx0;
    scaleY = Math.abs(sy0) < 0.001 ? 1 : sy1 / sy0;
    scaleX = Math.sign(scaleX) * Math.max(0.05, Math.abs(scaleX));
    scaleY = Math.sign(scaleY) * Math.max(0.05, Math.abs(scaleY));
  }

  for (const stroke of strokes) {
    if (!selectedStrokeIds.has(stroke.id)) continue;
    const original = transformState.snapshot.get(stroke.id);
    stroke.rawPoints = original.rawPoints.map((point) =>
      transformPoint(point, cx, cy, moveX, moveY, scaleX, scaleY, angle),
    );
    stroke.points = original.points.map((point) =>
      transformPoint(point, cx, cy, moveX, moveY, scaleX, scaleY, angle),
    );
    stroke.filtered = stroke.points[stroke.points.length - 1] || stroke.filtered;
    invalidateStrokeCaches(stroke);
  }

  committedDirty = true;
}

function drawPolylineMM(targetCtx, points, color, widthPx) {
  if (points.length < 2) return;
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = widthPx / getViewportScale();
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    targetCtx.lineTo(points[i].x, points[i].y);
  }
  targetCtx.stroke();
  targetCtx.restore();
}

function drawSelectionOverlay() {
  const bounds = computeSelectionBounds();
  if (bounds) {
    withPaperScale(ctx, (scaledCtx) => {
      for (const stroke of strokes) {
        if (selectedStrokeIds.has(stroke.id)) {
          drawPolylineMM(scaledCtx, getStrokePathPoints(stroke), "rgba(45, 139, 131, 0.9)", 2);
        }
      }
    });

    const topLeft = mmToCanvasPx({ x: bounds.minX, y: bounds.minY });
    const bottomRight = mmToCanvasPx({ x: bounds.maxX, y: bounds.maxY });
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = "#2d8b83";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    ctx.restore();

    const handles = getTransformHandles(bounds);
    for (const [name, point] of Object.entries(handles)) {
      if (name === "rotate") {
        ctx.beginPath();
        ctx.moveTo((topLeft.x + bottomRight.x) * 0.5, topLeft.y);
        ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = "#2d8b83";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = name === "rotate" ? "#2d8b83" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#2d8b83";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (lassoPoints.length > 1) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "#2d8b83";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const firstPoint = mmToCanvasPx(lassoPoints[0]);
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (let i = 1; i < lassoPoints.length; i += 1) {
      const pointPx = mmToCanvasPx(lassoPoints[i]);
      ctx.lineTo(pointPx.x, pointPx.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function redraw() {
  frameTimer = null;
  if (committedDirty) {
    rerenderCommittedLayer();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(committedLayer, 0, 0);
  ctx.drawImage(activeLayer, 0, 0);
  drawSelectionOverlay();
}

function queueRedraw() {
  if (frameTimer !== null) return;
  frameTimer = requestAnimationFrame(redraw);
}

function buildPathSvgDocument() {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`,
  );
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round">`);
  for (const stroke of strokes) {
    const points = getStrokePathPoints(stroke);
    if (!points.length) continue;
    const d = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`)
      .join(" ");
    parts.push(`<path d="${d}"/>`);
  }
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

function polygonToPath(points) {
  if (!points || !points.length) return "";
  const commands = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length; i += 1) {
    commands.push(`L ${fmt(points[i].x)} ${fmt(points[i].y)}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function buildBrushSvgDocument() {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`,
  );
  parts.push(`<g fill="#000" stroke="none">`);
  for (const stroke of strokes) {
    const stamps = buildBrushStampCache(stroke);
    for (const stamp of stamps) {
      if (stamp.kind === "circle") {
        parts.push(`<circle cx="${fmt(stamp.x)}" cy="${fmt(stamp.y)}" r="${fmt(stamp.r)}"/>`);
      } else {
        const pathData = polygonToPath(stamp.points);
        if (pathData) {
          parts.push(`<path d="${pathData}"/>`);
        }
      }
    }
  }
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

function exportPathSvg() {
  ExportUtils.downloadText(buildPathSvgDocument(), "calligraphy-pad-paths.svg", "image/svg+xml");
}

function exportBrushSvg() {
  ExportUtils.downloadText(buildBrushSvgDocument(), "calligraphy-pad-brush.svg", "image/svg+xml");
}

function streamNow() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    status.textContent = "Socket not connected";
    return;
  }
  socket.send(JSON.stringify({ c: "incoming-svg", p: { svg: buildPathSvgDocument() } }));
  status.textContent = `Streamed at ${new Date().toLocaleTimeString()}`;
}

function queueAutoStream() {
  if (!autoStream.checked || streamTimer) return;
  streamTimer = setTimeout(() => {
    streamTimer = null;
    streamNow();
  }, 110);
}

function streamIfAutoEnabled() {
  if (autoStream.checked) {
    streamNow();
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${saxiHost}/chat`);

  socket.addEventListener("open", () => {
    connected = true;
    updateBadges();
    status.textContent = "Connected";
  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (
        msg.c === "plan-options" &&
        msg.p &&
        msg.p.paperSize &&
        Number.isFinite(msg.p.paperSize.x) &&
        Number.isFinite(msg.p.paperSize.y) &&
        Number.isFinite(msg.p.marginMm)
      ) {
        P.canvasWMM = Math.max(10, Number(msg.p.paperSize.x));
        P.canvasHMM = Math.max(10, Number(msg.p.paperSize.y));
        P.marginMM = Math.max(0, Number(msg.p.marginMm));
        PaperUtils.syncPresetFromSize(P);
        syncPaperControlsFromState();
        updateBadges();
        syncCanvasSize();
      }
    } catch (_error) {
      // Ignore non-json messages.
    }
  });

  socket.addEventListener("close", () => {
    connected = false;
    updateBadges();
    status.textContent = "Disconnected, retrying...";
    setTimeout(connect, 1000);
  });

  socket.addEventListener("error", () => {
    connected = false;
    updateBadges();
    status.textContent = "Socket error";
  });
}

function beginStroke(point) {
  current = createStroke(point);
  strokes.push(current);
  clearLayer(activeLayer);
  drawIncrementalStrokeSegment(activeLayer, current, null, point);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function finishLasso() {
  selectedStrokeIds.clear();
  if (lassoPoints.length >= 3) {
    for (const stroke of strokes) {
      if (stroke.points.some((point) => pointInPolygon(point, lassoPoints))) {
        selectedStrokeIds.add(stroke.id);
      }
    }
  }
  lassoPoints = [];
  if (selectedStrokeIds.size > 0) {
    tool = "transform";
    status.textContent = "Selection ready";
  } else {
    status.textContent = "Nothing selected";
  }
  updateToolButtons();
  queueRedraw();
}

function beginTransform(hit, pointMm) {
  transformState = {
    type: hit.type,
    handle: hit.handle || null,
    bounds: hit.bounds,
    anchor: pointMm,
    snapshot: new Map(
      strokes
        .filter((stroke) => selectedStrokeIds.has(stroke.id))
        .map((stroke) => [
          stroke.id,
          {
            rawPoints: stroke.rawPoints.map((point) => ({ ...point })),
            points: stroke.points.map((point) => ({ ...point })),
          },
        ]),
    ),
  };
}

function finalizeCurrentStroke() {
  if (!current) return;
  invalidateStrokeCaches(current);
  drawStrokeToLayer(committedLayer, current);
  clearLayer(activeLayer);
  current = null;
}

function handleDrawMove(point) {
  if (!current) return;

  current.rawPoints.push(point);
  let filtered = lerp(
    current.filtered,
    point,
    clamp(1 - current.brush.streamline * 0.45, 0.015, 1),
  );
  current.filtered = filtered;

  if (current.brush.snapToGrid) {
    filtered = {
      x: Math.round(filtered.x / 5) * 5,
      y: Math.round(filtered.y / 5) * 5,
    };
  }

  const last = current.points[current.points.length - 1];
  if (!last || dist(last, filtered) >= current.brush.minDistanceMM) {
    current.points.push(filtered);
    invalidateStrokeCaches(current);
    drawIncrementalStrokeSegment(activeLayer, current, last || null, filtered);
    queueRedraw();
  }

  queueAutoStream();
}

function handlePenPreview(event) {
  if (!isPenPointerEvent(event)) return;
  const point = pointFromPointer(event);
  if (!point) return;
  hoverPointer = { pointMm: point, event };
  updatePenMarkerFromPointer(point, getBrushSnapshot(), event);
}

function undoLast() {
  if (!strokes.length) return;
  const removed = strokes.pop();
  selectedStrokeIds.delete(removed.id);
  committedDirty = true;
  queueRedraw();
  streamIfAutoEnabled();
}

function clearAll() {
  strokes.length = 0;
  selectedStrokeIds.clear();
  lassoPoints = [];
  transformState = null;
  clearLayer(activeLayer);
  committedDirty = true;
  queueRedraw();
  streamIfAutoEnabled();
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  if (event.pointerType === "touch") {
    activeTouchPointers.set(event.pointerId, getEventCanvasPx(event));
    if (current && tool === "draw") {
      finalizeCurrentStroke();
      queueRedraw();
    }
    if (activeTouchPointers.size >= 2) {
      beginTouchGesture();
    }
    return;
  }

  const point = pointFromPointer(event);
  if (!point) return;

  if (isPenPointerEvent(event)) {
    handlePenPreview(event);
  }

  if (tool === "draw") {
    beginStroke(point);
  } else if (tool === "lasso") {
    lassoPoints = [point];
    status.textContent = "Tracing selection";
  } else if (tool === "transform") {
    const hit = hitTestTransform(point);
    if (hit) {
      beginTransform(hit, point);
      status.textContent =
        hit.type === "move"
          ? "Moving selection"
          : hit.type === "rotate"
            ? "Rotating selection"
            : "Scaling selection";
    } else {
      selectedStrokeIds.clear();
    }
  }

  queueRedraw();
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") {
    if (activeTouchPointers.has(event.pointerId)) {
      activeTouchPointers.set(event.pointerId, getEventCanvasPx(event));
      if (activeTouchPointers.size >= 2) {
        updateTouchGesture();
      }
    }
    return;
  }

  if (isPenPointerEvent(event)) {
    handlePenPreview(event);
  }

  const sourceEvents =
    current && tool === "draw" && typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [event];

  if (tool === "draw" && current) {
    for (const sourceEvent of sourceEvents) {
      const point = pointFromPointer(sourceEvent);
      if (!point) continue;
      handleDrawMove(point);
      if (isPenPointerEvent(sourceEvent)) {
        hoverPointer = { pointMm: point, event: sourceEvent };
      }
    }
    return;
  }

  const point = pointFromPointer(event);
  if (!point) return;

  if (tool === "lasso" && lassoPoints.length > 0) {
    const last = lassoPoints[lassoPoints.length - 1];
    if (!last || dist(last, point) >= 1) {
      lassoPoints.push(point);
      queueRedraw();
    }
    return;
  }

  if (tool === "transform" && transformState) {
    applyTransformFromState(point);
    queueRedraw();
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (activeTouchPointers.size >= 2) {
      beginTouchGesture();
    } else {
      gestureState = null;
    }
    return;
  }

  if (tool === "draw") {
    finalizeCurrentStroke();
    queueRedraw();
    streamIfAutoEnabled();
  } else if (tool === "lasso") {
    finishLasso();
  } else if (tool === "transform" && transformState) {
    transformState = null;
    queueRedraw();
    streamIfAutoEnabled();
  }
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (activeTouchPointers.size === 0) {
      gestureState = null;
    }
    return;
  }

  if (tool === "draw" && current) {
    finalizeCurrentStroke();
    queueRedraw();
  }
  hidePenMarker();
});

canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (activeTouchPointers.size === 0) {
      gestureState = null;
    }
    return;
  }

  if (tool === "draw" && current) {
    finalizeCurrentStroke();
    queueRedraw();
  }
  hidePenMarker();
});

canvas.addEventListener("pointerenter", (event) => {
  if (isPenPointerEvent(event)) {
    handlePenPreview(event);
  }
});

canvas.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const anchor = getEventCanvasPx(event);
      const zoomFactor = Math.exp(-event.deltaY * 0.0025);
      setManualZoom(view.zoom * zoomFactor, anchor);
      return;
    }

    if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
      event.preventDefault();
      panViewport(-event.deltaX, -event.deltaY);
    }
  },
  { passive: false },
);

undoBtn.addEventListener("click", undoLast);
floatingUndoBtn.addEventListener("click", undoLast);
clearBtn.addEventListener("click", clearAll);
streamBtn.addEventListener("click", streamNow);
floatingStreamBtn.addEventListener("click", streamNow);
pathSvgBtn.addEventListener("click", exportPathSvg);
brushSvgBtn.addEventListener("click", exportBrushSvg);
collapseBtn.addEventListener("click", () => setPanelCollapsed(true));
showPanelBtn.addEventListener("click", () => setPanelCollapsed(false));

window.addEventListener("resize", () => {
  syncCanvasSize();
  if (hoverPointer) {
    updatePenMarkerFromPointer(hoverPointer.pointMm, getBrushSnapshot(), hoverPointer.event);
  }
});

function init() {
  PaperUtils.applyPaperPreset(P, P.paperPreset);
  buildPane();
  syncPaperControlsFromState();
  updateControlLabels();
  updateToolButtons();
  syncCanvasSize();
  queueRedraw();
  updateBadges();
  connect();
}

init();
