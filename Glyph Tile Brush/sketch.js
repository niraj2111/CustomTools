const GLYPH_SETS = [
  { label: "Glyph Set 1", folder: "data1" },
  { label: "Glyph Set 2", folder: "data2" },
  { label: "Glyph Set 3", folder: "data3" },
  { label: "Glyph Set 4", folder: "data6" },
];

const GLYPH_COUNT = 16;
const LIVE_CELL_LIMIT = 20000;
const SPRITE_CACHE_MAX_PX = 512;
const glyphImages = GLYPH_SETS.map(() => new Array(GLYPH_COUNT + 1));
const glyphSources = GLYPH_SETS.map(() => new Array(GLYPH_COUNT + 1));
const glyphDefinitions = GLYPH_SETS.map(() => new Array(GLYPH_COUNT + 1));

const P = {
  paperPreset: "A4 Portrait",
  canvasWMM: 210,
  canvasHMM: 297,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 10,
  glyphSet: "Glyph Set 1",
  cellSizeMM: 10,
  glyphScale: 3,
  brushMode: "Paint",
  randomDensity: 0.22,
  mediaMapping: "Threshold",
  mediaFit: "Cover",
  mediaThreshold: 128,
  mediaToneBias: 0,
  mediaDitherStrength: 100,
  mediaSerpentine: true,
  mediaInvert: false,
  mediaMirrorWebcam: true,
  mediaFPS: 12,
  paperColor: "#ffffff",
  showGrid: false,
  gridColor: "#e14848",
  gridWeightMM: 0.15,
  svgIncludeBackground: true,
  svgFilename: "Glyph-Tile-Brush.svg",
};

let cnv;
let dialRoot;
let dialController;
let dialSyncing = false;
let grid = new Uint8Array(0);
let glyphIds = new Uint8Array(0);
let mediaGrid = new Uint8Array(0);
let mediaDitherWork = new Float32Array(0);
let cols = 0;
let rows = 0;
let dragValue = true;
let dragging = false;
let visitedDuringDrag = new Set();
let glyphIdsDirty = true;
let spriteCache = { key: "", sprites: [] };
let mediaRemapTimer = 0;
let lastLiveStatusAt = 0;
let webcamRequestId = 0;

const mediaState = {
  type: "none",
  label: "",
  element: null,
  objectUrl: "",
  stream: null,
  playing: false,
  callbackId: 0,
  callbackType: "",
  generation: 0,
  lastProcessedAt: 0,
  averageCostMs: 0,
  sampleCanvas: null,
  sampleContext: null,
};

function preload() {
  GLYPH_SETS.forEach((set, setIndex) => {
    for (let glyph = 1; glyph <= GLYPH_COUNT; glyph += 1) {
      const source = globalThis.GLYPH_ASSET_DATA?.[set.folder]?.[glyph];
      if (!source) throw new Error(`Missing bundled glyph: ${set.folder}/${glyph}.svg`);
      glyphSources[setIndex][glyph] = source;
      glyphImages[setIndex][glyph] = loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
    }
  });
}

function setup() {
  compileGlyphDefinitions();
  const size = PaperUtils.getCanvasPixelSize(P);
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  cnv.elt.setAttribute("aria-label", "Editable glyph tile canvas");
  cnv.elt.addEventListener("contextmenu", (event) => event.preventDefault());
  pixelDensity(1);
  noLoop();

  rebuildGrid(false);
  buildDialKit();
  initializeMediaPipeline();
  hookUI();
  syncCanvasSize();
  updateStatus();
  redraw();
}

function draw() {
  // Reset the native context so SVG image paints cannot leak transforms or clips
  // into the next noLoop redraw.
  if (typeof drawingContext.reset === "function") drawingContext.reset();
  else {
    drawingContext.setTransform(1, 0, 0, 1, 0, 0);
    drawingContext.clearRect(0, 0, width, height);
  }
  drawingContext.fillStyle = P.paperColor;
  drawingContext.fillRect(0, 0, width, height);
  const pxPerMM = PaperUtils.getPxPerMM(P);
  const inner = getInnerBounds();
  const setIndex = getGlyphSetIndex();
  ensureGlyphIds();
  const sprites = ensureGlyphSprites(setIndex, pxPerMM);
  const sizePx = P.cellSizeMM * P.glyphScale * pxPerMM;
  const halfCellMM = P.cellSizeMM * 0.5;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const glyph = glyphIds[row * cols + col];
      const sprite = sprites[glyph];
      if (!glyph || !sprite) continue;
      const centerX = (inner.x + col * P.cellSizeMM + halfCellMM) * pxPerMM;
      const centerY = (inner.y + row * P.cellSizeMM + halfCellMM) * pxPerMM;
      drawingContext.drawImage(sprite, centerX - sizePx * 0.5, centerY - sizePx * 0.5, sizePx, sizePx);
    }
  }

  if (P.showGrid) {
    push();
    scale(pxPerMM);
    drawGrid(inner);
    pop();
  }
}

function ensureGlyphSprites(setIndex, pxPerMM) {
  const actualSize = Math.max(1, Math.round(P.cellSizeMM * P.glyphScale * pxPerMM));
  const cacheSize = Math.min(SPRITE_CACHE_MAX_PX, actualSize);
  const key = `${setIndex}:${cacheSize}`;
  if (spriteCache.key === key) return spriteCache.sprites;

  const sprites = new Array(GLYPH_COUNT + 1);
  for (let glyph = 1; glyph <= GLYPH_COUNT; glyph += 1) {
    const img = glyphImages[setIndex][glyph];
    const source = img?.canvas || img?.elt;
    if (!source) continue;
    const sprite = document.createElement("canvas");
    sprite.width = cacheSize;
    sprite.height = cacheSize;
    const context = sprite.getContext("2d");
    context.drawImage(source, 0, 0, cacheSize, cacheSize);
    sprites[glyph] = sprite;
  }
  spriteCache = { key, sprites };
  return sprites;
}

function getInnerBounds() {
  const margin = Math.max(0, Math.min(P.marginMM, Math.min(P.canvasWMM, P.canvasHMM) * 0.49));
  return {
    x: margin,
    y: margin,
    w: Math.max(0, P.canvasWMM - margin * 2),
    h: Math.max(0, P.canvasHMM - margin * 2),
  };
}

function getGridDimensions() {
  const inner = getInnerBounds();
  const size = Math.max(1, P.cellSizeMM);
  return {
    cols: Math.max(1, Math.floor(inner.w / size)),
    rows: Math.max(1, Math.floor(inner.h / size)),
  };
}

function rebuildGrid(preserve = true) {
  const previous = grid;
  const previousCols = cols;
  const previousRows = rows;
  const dimensions = getGridDimensions();
  cols = dimensions.cols;
  rows = dimensions.rows;
  grid = new Uint8Array(cols * rows);
  glyphIds = new Uint8Array(cols * rows);
  mediaGrid = new Uint8Array(cols * rows);
  mediaDitherWork = new Float32Array(cols * rows);
  if (preserve) {
    const copyCols = Math.min(cols, previousCols);
    const copyRows = Math.min(rows, previousRows);
    for (let row = 0; row < copyRows; row += 1) {
      for (let col = 0; col < copyCols; col += 1) {
        grid[row * cols + col] = previous[row * previousCols + col];
      }
    }
  }
  glyphIdsDirty = true;
  updateStatus();
}

function drawGrid(inner) {
  noFill();
  stroke(P.gridColor);
  strokeWeight(Math.max(0.02, P.gridWeightMM));
  for (let col = 0; col <= cols; col += 1) {
    const x = inner.x + col * P.cellSizeMM;
    line(x, inner.y, x, inner.y + rows * P.cellSizeMM);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = inner.y + row * P.cellSizeMM;
    line(inner.x, y, inner.x + cols * P.cellSizeMM, y);
  }
}

function isCellActive(col, row) {
  return MediaSourceUtils.isCellActive(grid, cols, rows, col, row);
}

function glyphForCell(col, row) {
  return MediaSourceUtils.glyphForCell(grid, cols, rows, col, row);
}

function ensureGlyphIds() {
  if (!glyphIdsDirty) return;
  glyphIds = MediaSourceUtils.buildGlyphIds(grid, cols, rows, glyphIds);
  glyphIdsDirty = false;
}

function cellAtCanvasPosition(xPx, yPx) {
  const pxPerMM = PaperUtils.getPxPerMM(P);
  const xMM = xPx / pxPerMM;
  const yMM = yPx / pxPerMM;
  const inner = getInnerBounds();
  const col = Math.floor((xMM - inner.x) / P.cellSizeMM);
  const row = Math.floor((yMM - inner.y) / P.cellSizeMM);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  return { col, row };
}

function beginBrush(x, y, forceErase = false) {
  if (mediaState.playing) {
    updateStatus("Pause or capture live media before painting");
    return false;
  }
  const cell = cellAtCanvasPosition(x, y);
  if (!cell) return false;
  dragging = true;
  visitedDuringDrag = new Set();
  if (forceErase || P.brushMode === "Erase") dragValue = false;
  else if (P.brushMode === "Paint") dragValue = true;
  else dragValue = !grid[cell.row * cols + cell.col];
  paintCell(cell);
  return false;
}

function paintCell(cell) {
  if (!cell) return;
  const key = `${cell.col}:${cell.row}`;
  if (visitedDuringDrag.has(key)) return;
  visitedDuringDrag.add(key);
  grid[cell.row * cols + cell.col] = dragValue ? 1 : 0;
  glyphIdsDirty = true;
  updateStatus();
  redraw();
}

function mousePressed() {
  if (mouseX < 0 || mouseY < 0 || mouseX >= width || mouseY >= height) return;
  return beginBrush(mouseX, mouseY, mouseButton === RIGHT);
}

function mouseDragged() {
  if (!dragging) return;
  paintCell(cellAtCanvasPosition(mouseX, mouseY));
  return false;
}

function mouseReleased() {
  dragging = false;
  visitedDuringDrag.clear();
}

function touchStarted() {
  if (!touches.length) return;
  return beginBrush(touches[0].x, touches[0].y, false);
}

function touchMoved() {
  if (!dragging || !touches.length) return;
  paintCell(cellAtCanvasPosition(touches[0].x, touches[0].y));
  return false;
}

function touchEnded() {
  mouseReleased();
  return false;
}

function clearGrid() {
  if (mediaState.playing) pauseLiveMedia();
  grid.fill(0);
  glyphIdsDirty = true;
  updateStatus("Cleared");
  redraw();
}

function randomFill() {
  if (mediaState.playing) pauseLiveMedia();
  const density = Math.max(0, Math.min(1, Number(P.randomDensity)));
  for (let index = 0; index < grid.length; index += 1) {
    grid[index] = Math.random() < density ? 1 : 0;
  }
  glyphIdsDirty = true;
  updateStatus("Random fill generated");
  redraw();
}

function activeCellCount() {
  let count = 0;
  for (let index = 0; index < grid.length; index += 1) count += grid[index];
  return count;
}

function updateStatus(message = "") {
  const status = document.getElementById("status");
  if (!status) return;
  const count = activeCellCount();
  status.textContent = `${message ? `${message} · ` : ""}${count} active ${count === 1 ? "tile" : "tiles"} · ${cols} × ${rows} grid`;
}

function compileGlyphDefinitions() {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  glyphSources.forEach((setSources, setIndex) => {
    for (let glyph = 1; glyph <= GLYPH_COUNT; glyph += 1) {
      const source = setSources[glyph] || "";
      const documentNode = parser.parseFromString(source, "image/svg+xml");
      const svg = documentNode.documentElement;
      const viewBox = svg.getAttribute("viewBox") || `0 0 ${svg.getAttribute("width") || 300} ${svg.getAttribute("height") || 300}`;
      const viewBoxValues = viewBox.trim().split(/[\s,]+/).map(Number);
      const [minX, minY, viewWidth, viewHeight] = viewBoxValues.length === 4 && viewBoxValues.every(Number.isFinite)
        ? viewBoxValues
        : [0, 0, 300, 300];
      const presentationAttributes = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "color", "style"]
        .filter((name) => svg.hasAttribute(name))
        .map((name) => `${name}="${ExportUtils.escapeXML(svg.getAttribute(name))}"`)
        .join(" ");
      const content = Array.from(svg.childNodes)
        .filter((node) => node.nodeType !== Node.ELEMENT_NODE || node.nodeName.toLowerCase() !== "title")
        .map((node) => serializer.serializeToString(node))
        .join("");
      glyphDefinitions[setIndex][glyph] = {
        viewBox,
        minX,
        minY,
        viewWidth: Math.max(0.001, viewWidth),
        viewHeight: Math.max(0.001, viewHeight),
        content,
        presentationAttributes,
      };
    }
  });
}

function getGlyphSetIndex() {
  const index = GLYPH_SETS.findIndex((set) => set.label === P.glyphSet);
  return index >= 0 ? index : 0;
}

function buildSvgDocument() {
  const inner = getInnerBounds();
  const setIndex = getGlyphSetIndex();
  const setNumber = setIndex + 1;
  const size = P.cellSizeMM * P.glyphScale;
  ensureGlyphIds();
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(P.canvasHMM)}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`,
  ];

  if (P.svgIncludeBackground) {
    svg.push(`<rect width="${ExportUtils.fmt(P.canvasWMM)}" height="${ExportUtils.fmt(P.canvasHMM)}" fill="${ExportUtils.escapeXML(P.paperColor)}"/>`);
  }

  svg.push(`<g id="glyph-tiles" data-glyph-set="${setNumber}">`);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const glyph = glyphIds[row * cols + col];
      if (!glyph) continue;
      const definition = glyphDefinitions[setIndex][glyph];
      if (!definition) continue;
      const x = inner.x + col * P.cellSizeMM + P.cellSizeMM * 0.5 - size * 0.5;
      const y = inner.y + row * P.cellSizeMM + P.cellSizeMM * 0.5 - size * 0.5;
      const scaleX = size / definition.viewWidth;
      const scaleY = size / definition.viewHeight;
      const transform = [
        `translate(${ExportUtils.fmt(x)} ${ExportUtils.fmt(y)})`,
        `scale(${ExportUtils.fmt(scaleX)} ${ExportUtils.fmt(scaleY)})`,
        `translate(${ExportUtils.fmt(-definition.minX)} ${ExportUtils.fmt(-definition.minY)})`,
      ].join(" ");
      svg.push(`<g data-glyph="${glyph}" transform="${transform}"${definition.presentationAttributes ? ` ${definition.presentationAttributes}` : ""}>${definition.content}</g>`);
    }
  }
  svg.push("</g>", "</svg>");
  return svg.join("\n");
}

function exportSVG() {
  const wasLive = mediaState.playing;
  if (wasLive) pauseLiveMedia("");
  const rawName = String(P.svgFilename || "Glyph-Tile-Brush.svg").trim();
  const filename = rawName.toLowerCase().endsWith(".svg") ? rawName : `${rawName}.svg`;
  ExportUtils.downloadText(buildSvgDocument(), filename, "image/svg+xml");
  updateStatus(wasLive ? "SVG exported; live media paused" : "Portable SVG exported");
}

const DIAL_PATHS = {
  "brush.glyphSet": "glyphSet",
  "brush.cellSizeMM": "cellSizeMM",
  "brush.glyphScale": "glyphScale",
  "brush.brushMode": "brushMode",
  "brush.randomDensity": "randomDensity",
  "mediaSource.mapping": "mediaMapping",
  "mediaSource.fit": "mediaFit",
  "mediaSource.threshold": "mediaThreshold",
  "mediaSource.toneBias": "mediaToneBias",
  "mediaSource.ditherStrength": "mediaDitherStrength",
  "mediaSource.serpentine": "mediaSerpentine",
  "mediaSource.invert": "mediaInvert",
  "mediaSource.mirrorWebcam": "mediaMirrorWebcam",
  "mediaSource.liveFPS": "mediaFPS",
  "paper.paperPreset": "paperPreset",
  "paper.widthMM": "canvasWMM",
  "paper.heightMM": "canvasHMM",
  "paper.marginMM": "marginMM",
  "paper.dpi": "dpi",
  "paper.previewScale": "previewScale",
  "paper.fitToViewport": "fitToViewport",
  "appearance.paperColor": "paperColor",
  "appearance.showGrid": "showGrid",
  "appearance.gridColor": "gridColor",
  "appearance.gridWeightMM": "gridWeightMM",
  "exportOptions.includeBackground": "svgIncludeBackground",
  "exportOptions.filename": "svgFilename",
};

function buildDialConfig() {
  return {
    brush: {
      _collapsed: false,
      glyphSet: { type: "select", options: GLYPH_SETS.map((set) => set.label), default: P.glyphSet },
      cellSizeMM: [P.cellSizeMM, 3, 40, 0.5],
      glyphScale: [P.glyphScale, 0.5, 5, 0.1],
      brushMode: { type: "select", options: ["Paint", "Erase", "Toggle"], default: P.brushMode },
      randomDensity: [P.randomDensity, 0, 1, 0.01],
    },
    mediaSource: {
      _collapsed: false,
      mapping: {
        type: "select",
        options: ["Threshold", "Bayer 2×2", "Bayer 4×4", "Bayer 8×8", "Floyd–Steinberg", "Atkinson"],
        default: P.mediaMapping,
      },
      fit: { type: "select", options: ["Cover", "Contain"], default: P.mediaFit },
      threshold: [P.mediaThreshold, 0, 255, 1],
      toneBias: [P.mediaToneBias, -100, 100, 1],
      ditherStrength: [P.mediaDitherStrength, 0, 100, 1],
      serpentine: P.mediaSerpentine,
      invert: P.mediaInvert,
      mirrorWebcam: P.mediaMirrorWebcam,
      liveFPS: [P.mediaFPS, 1, 24, 1],
    },
    paper: {
      _collapsed: false,
      paperPreset: { type: "select", options: Object.keys(PaperUtils.PAPER_PRESETS_MM), default: P.paperPreset },
      widthMM: [P.canvasWMM, 30, 1000, 1],
      heightMM: [P.canvasHMM, 30, 1000, 1],
      marginMM: [P.marginMM, 0, 100, 1],
      dpi: [P.dpi, 36, 300, 1],
      previewScale: [P.previewScale, 0.1, 4, 0.1],
      fitToViewport: P.fitToViewport,
    },
    appearance: {
      _collapsed: true,
      paperColor: { type: "color", default: P.paperColor },
      showGrid: P.showGrid,
      gridColor: { type: "color", default: P.gridColor },
      gridWeightMM: [P.gridWeightMM, 0.02, 1, 0.01],
    },
    exportOptions: {
      _collapsed: true,
      includeBackground: P.svgIncludeBackground,
      filename: { type: "text", default: P.svgFilename },
      exportSVG: { type: "action", label: "Export SVG" },
    },
  };
}

function buildDialValues() {
  return {
    brush: {
      glyphSet: P.glyphSet,
      cellSizeMM: P.cellSizeMM,
      glyphScale: P.glyphScale,
      brushMode: P.brushMode,
      randomDensity: P.randomDensity,
    },
    mediaSource: {
      mapping: P.mediaMapping,
      fit: P.mediaFit,
      threshold: P.mediaThreshold,
      toneBias: P.mediaToneBias,
      ditherStrength: P.mediaDitherStrength,
      serpentine: P.mediaSerpentine,
      invert: P.mediaInvert,
      mirrorWebcam: P.mediaMirrorWebcam,
      liveFPS: P.mediaFPS,
    },
    paper: {
      paperPreset: P.paperPreset,
      widthMM: P.canvasWMM,
      heightMM: P.canvasHMM,
      marginMM: P.marginMM,
      dpi: P.dpi,
      previewScale: P.previewScale,
      fitToViewport: P.fitToViewport,
    },
    appearance: {
      paperColor: P.paperColor,
      showGrid: P.showGrid,
      gridColor: P.gridColor,
      gridWeightMM: P.gridWeightMM,
    },
    exportOptions: {
      includeBackground: P.svgIncludeBackground,
      filename: P.svgFilename,
    },
  };
}

function flattenValues(source, prefix = "", result = {}) {
  Object.entries(source || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flattenValues(value, path, result);
    else result[path] = value;
  });
  return result;
}

function refreshDial() {
  if (!dialController) return;
  dialSyncing = true;
  dialController.setValues(buildDialValues());
  dialSyncing = false;
}

function applyDialValues(values) {
  if (dialSyncing) return;
  const flat = flattenValues(values);
  const changed = [];
  Object.entries(DIAL_PATHS).forEach(([path, key]) => {
    if (!(path in flat) || Object.is(P[key], flat[path])) return;
    P[key] = flat[path];
    changed.push(key);
  });
  if (!changed.length) return;

  if (changed.includes("paperPreset")) PaperUtils.applyPaperPreset(P, P.paperPreset);
  else if (changed.includes("canvasWMM") || changed.includes("canvasHMM")) PaperUtils.syncPresetFromSize(P);

  const gridChanged = changed.some((key) => ["canvasWMM", "canvasHMM", "marginMM", "cellSizeMM", "paperPreset"].includes(key));
  const canvasChanged = changed.some((key) => ["canvasWMM", "canvasHMM", "dpi", "paperPreset"].includes(key));
  if (gridChanged) rebuildGrid(true);
  if (canvasChanged) syncCanvasSize();
  else if (changed.includes("previewScale") || changed.includes("fitToViewport")) updateCanvasDisplaySize();

  if (changed.some((key) => ["glyphSet", "cellSizeMM", "glyphScale", "dpi"].includes(key))) {
    spriteCache.key = "";
  }
  if (changed.some((key) => [
    "mediaMapping", "mediaFit", "mediaThreshold", "mediaToneBias", "mediaDitherStrength", "mediaSerpentine",
    "mediaInvert", "mediaMirrorWebcam",
  ].includes(key))) {
    updateMediaPreviewClasses();
    scheduleMediaRemap();
  } else if (gridChanged && mediaState.type !== "none") {
    scheduleMediaRemap();
  }

  refreshDial();
  redraw();
}

function buildDialKit() {
  if (!globalThis.DialKit) throw new Error("DialKit failed to load");
  dialRoot = DialKit.createDialRoot({
    target: document.getElementById("pane"),
    mode: "inline",
    theme: "dark",
    defaultOpen: true,
    productionEnabled: true,
  });
  dialController = DialKit.createDialKit("Glyph Tile Brush", buildDialConfig(), {
    id: "glyph-tile-brush",
    defaultCollapsed: false,
    onAction: (action) => {
      if (action === "exportOptions.exportSVG") exportSVG();
    },
  });
  dialController.subscribe(applyDialValues, false);
  refreshDial();
}

function syncCanvasSize() {
  PaperUtils.syncCanvasSize(cnv, P, resizeCanvas, "wrap", 32);
}

function updateCanvasDisplaySize() {
  PaperUtils.updateCanvasDisplaySize(cnv, P, "wrap", 32);
}

function setGlyphSet(index) {
  const set = GLYPH_SETS[index];
  if (!set) return;
  P.glyphSet = set.label;
  refreshDial();
  updateStatus(set.label);
  redraw();
}

function initializeMediaPipeline() {
  mediaState.sampleCanvas = document.createElement("canvas");
  mediaState.sampleContext = mediaState.sampleCanvas.getContext("2d", { willReadFrequently: true });
  updateMediaControls();
  updateMediaPreviewClasses();
}

function isMovingMedia() {
  return mediaState.type === "video" || mediaState.type === "webcam";
}

function mediaSourceDimensions() {
  if (mediaState.type === "image") {
    return {
      width: mediaState.element?.naturalWidth || 0,
      height: mediaState.element?.naturalHeight || 0,
    };
  }
  return {
    width: mediaState.element?.videoWidth || 0,
    height: mediaState.element?.videoHeight || 0,
  };
}

function updateMediaPreviewClasses() {
  const image = document.getElementById("sourceImage");
  const video = document.getElementById("sourceVideo");
  if (!image || !video) return;
  image.classList.toggle("contain", P.mediaFit === "Contain");
  video.classList.toggle("contain", P.mediaFit === "Contain");
  video.classList.toggle("mirrored", mediaState.type === "webcam" && P.mediaMirrorWebcam);
}

function showMediaPreview(type) {
  const image = document.getElementById("sourceImage");
  const video = document.getElementById("sourceVideo");
  const placeholder = document.getElementById("mediaPlaceholder");
  image.hidden = type !== "image";
  video.hidden = type !== "video" && type !== "webcam";
  placeholder.hidden = type !== "none";
  updateMediaPreviewClasses();
}

function updateMediaControls() {
  const moving = isMovingMedia();
  const hasSource = mediaState.type !== "none";
  const playPause = document.getElementById("playPauseBtn");
  const capture = document.getElementById("captureFrameBtn");
  const clear = document.getElementById("clearSourceBtn");
  const state = document.getElementById("sourceState");
  const meta = document.getElementById("sourceMeta");
  if (!playPause || !capture || !clear || !state || !meta) return;

  playPause.disabled = !moving;
  playPause.textContent = mediaState.playing ? "Pause" : "Play";
  capture.disabled = !hasSource;
  clear.disabled = !hasSource;
  state.textContent = !hasSource ? "Manual" : mediaState.playing ? "Live" : mediaState.type === "image" ? "Image" : "Frozen";
  meta.textContent = hasSource ? mediaState.label : "Drop a photo or video here";
}

function cancelMediaCallback() {
  if (!mediaState.callbackId) return;
  if (mediaState.callbackType === "video" && mediaState.element?.cancelVideoFrameCallback) {
    mediaState.element.cancelVideoFrameCallback(mediaState.callbackId);
  } else {
    cancelAnimationFrame(mediaState.callbackId);
  }
  mediaState.callbackId = 0;
  mediaState.callbackType = "";
}

function releaseMediaSource() {
  mediaState.generation += 1;
  webcamRequestId += 1;
  mediaState.playing = false;
  cancelMediaCallback();
  clearTimeout(mediaRemapTimer);

  if (mediaState.stream) {
    mediaState.stream.getTracks().forEach((track) => track.stop());
  }
  const video = document.getElementById("sourceVideo");
  const image = document.getElementById("sourceImage");
  if (video) {
    video.pause();
    video.onloadeddata = null;
    video.onerror = null;
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  }
  if (image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  }
  if (mediaState.objectUrl) URL.revokeObjectURL(mediaState.objectUrl);

  mediaState.type = "none";
  mediaState.label = "";
  mediaState.element = null;
  mediaState.objectUrl = "";
  mediaState.stream = null;
  mediaState.lastProcessedAt = 0;
  mediaState.averageCostMs = 0;
  showMediaPreview("none");
  updateMediaControls();
}

function clearMediaSource() {
  releaseMediaSource();
  updateStatus("Source cleared; captured glyphs retained");
}

function loadMediaFile(file) {
  if (!file) return;
  if (file.type.startsWith("image/")) loadImageFile(file);
  else if (file.type.startsWith("video/")) loadVideoFile(file);
  else updateStatus("Unsupported file; choose an image or video");
}

function loadImageFile(file) {
  releaseMediaSource();
  const image = document.getElementById("sourceImage");
  const objectUrl = URL.createObjectURL(file);
  const generation = mediaState.generation;
  mediaState.type = "image";
  mediaState.label = file.name || "Imported image";
  mediaState.element = image;
  mediaState.objectUrl = objectUrl;
  image.onload = () => {
    if (generation !== mediaState.generation) return;
    showMediaPreview("image");
    updateMediaControls();
    processMediaFrame(true);
  };
  image.onerror = () => {
    if (generation !== mediaState.generation) return;
    releaseMediaSource();
    updateStatus("The image could not be decoded");
  };
  image.src = objectUrl;
  showMediaPreview("image");
  updateMediaControls();
  updateStatus("Loading image");
}

function loadVideoFile(file) {
  releaseMediaSource();
  const video = document.getElementById("sourceVideo");
  const objectUrl = URL.createObjectURL(file);
  const generation = mediaState.generation;
  mediaState.type = "video";
  mediaState.label = file.name || "Imported video";
  mediaState.element = video;
  mediaState.objectUrl = objectUrl;
  video.onloadeddata = () => {
    if (generation !== mediaState.generation) return;
    showMediaPreview("video");
    updateMediaControls();
    startLiveMedia();
  };
  video.onerror = () => {
    if (generation !== mediaState.generation) return;
    releaseMediaSource();
    updateStatus("The video format is not supported by this browser");
  };
  video.src = objectUrl;
  video.load();
  showMediaPreview("video");
  updateMediaControls();
  updateStatus("Loading video");
}

async function useWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    updateStatus("Webcam access requires HTTPS or localhost");
    return;
  }
  updateStatus("Requesting webcam permission");
  const requestId = ++webcamRequestId;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    if (requestId !== webcamRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    releaseMediaSource();
    const video = document.getElementById("sourceVideo");
    mediaState.type = "webcam";
    mediaState.label = "Webcam";
    mediaState.element = video;
    mediaState.stream = stream;
    video.srcObject = stream;
    showMediaPreview("webcam");
    updateMediaControls();
    await startLiveMedia();
  } catch (error) {
    const reason = error?.name === "NotAllowedError" ? "Webcam permission was denied" : "Webcam is unavailable";
    updateStatus(reason);
  }
}

function pauseLiveMedia(message = "Media paused; painting enabled") {
  if (!isMovingMedia()) return;
  mediaState.playing = false;
  cancelMediaCallback();
  mediaState.element?.pause();
  updateMediaControls();
  if (message) updateStatus(message);
}

async function startLiveMedia() {
  if (!isMovingMedia() || !mediaState.element) return;
  if (grid.length > LIVE_CELL_LIMIT) {
    pauseLiveMedia("");
    updateStatus(`Large grid (${grid.length.toLocaleString()} cells); use Capture Frame`);
    return;
  }
  try {
    await mediaState.element.play();
    mediaState.playing = true;
    mediaState.lastProcessedAt = 0;
    updateMediaControls();
    scheduleNextMediaFrame();
    updateStatus("Live media started");
  } catch (error) {
    mediaState.playing = false;
    updateMediaControls();
    updateStatus("Playback was blocked; press Play to retry");
  }
}

function toggleLiveMedia() {
  if (!isMovingMedia()) return;
  if (mediaState.playing) pauseLiveMedia();
  else startLiveMedia();
}

function captureMediaFrame() {
  if (mediaState.type === "none") return;
  if (isMovingMedia()) pauseLiveMedia("");
  processMediaFrame(true, "Frame captured; painting enabled");
}

function scheduleNextMediaFrame() {
  if (!mediaState.playing || mediaState.callbackId || document.hidden || !mediaState.element) return;
  if (typeof mediaState.element.requestVideoFrameCallback === "function") {
    mediaState.callbackType = "video";
    mediaState.callbackId = mediaState.element.requestVideoFrameCallback((now) => {
      mediaState.callbackId = 0;
      mediaState.callbackType = "";
      handleScheduledMediaFrame(now);
    });
  } else {
    mediaState.callbackType = "animation";
    mediaState.callbackId = requestAnimationFrame((now) => {
      mediaState.callbackId = 0;
      mediaState.callbackType = "";
      handleScheduledMediaFrame(now);
    });
  }
}

function handleScheduledMediaFrame(now) {
  if (!mediaState.playing) return;
  const requestedInterval = 1000 / Math.max(1, Number(P.mediaFPS));
  const costInterval = mediaState.averageCostMs > 0 ? mediaState.averageCostMs * 2 : 0;
  const effectiveInterval = Math.max(requestedInterval, costInterval);
  if (now - mediaState.lastProcessedAt >= effectiveInterval) {
    processMediaFrame(false);
    mediaState.lastProcessedAt = now;
  }
  scheduleNextMediaFrame();
}

function scheduleMediaRemap() {
  if (mediaState.type === "none" || mediaState.playing) return;
  if (isMovingMedia() && grid.length > LIVE_CELL_LIMIT) {
    updateStatus(`Large grid (${grid.length.toLocaleString()} cells); use Capture Frame`);
    return;
  }
  clearTimeout(mediaRemapTimer);
  mediaRemapTimer = setTimeout(() => processMediaFrame(true), 100);
}

function processMediaFrame(force = false, message = "") {
  if (mediaState.type === "none" || !mediaState.element || !mediaState.sampleContext) return false;
  if (!force && isMovingMedia() && grid.length > LIVE_CELL_LIMIT) {
    pauseLiveMedia("");
    updateStatus(`Large grid (${grid.length.toLocaleString()} cells); use Capture Frame`);
    return false;
  }

  const dimensions = mediaSourceDimensions();
  if (!dimensions.width || !dimensions.height || !cols || !rows) return false;
  const startedAt = performance.now();
  const canvas = mediaState.sampleCanvas;
  const context = mediaState.sampleContext;
  if (canvas.width !== cols || canvas.height !== rows) {
    canvas.width = cols;
    canvas.height = rows;
  }

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, cols, rows);
  if (mediaState.type === "webcam" && P.mediaMirrorWebcam) {
    context.translate(cols, 0);
    context.scale(-1, 1);
  }
  const mapping = MediaSourceUtils.computeSourceDraw(
    dimensions.width,
    dimensions.height,
    cols,
    rows,
    P.mediaFit
  );
  context.drawImage(
    mediaState.element,
    mapping.sx,
    mapping.sy,
    mapping.sw,
    mapping.sh,
    mapping.dx,
    mapping.dy,
    mapping.dw,
    mapping.dh
  );
  context.restore();

  const pixels = context.getImageData(0, 0, cols, rows).data;
  mediaGrid = MediaSourceUtils.mapPixelsToGrid(pixels, cols, rows, {
    mode: P.mediaMapping,
    threshold: P.mediaThreshold,
    toneBias: P.mediaToneBias,
    invert: P.mediaInvert,
    ditherStrength: P.mediaDitherStrength,
    serpentine: P.mediaSerpentine,
  }, mediaGrid, mediaDitherWork);

  let changed = false;
  for (let index = 0; index < grid.length; index += 1) {
    if (grid[index] !== mediaGrid[index]) {
      changed = true;
      break;
    }
  }
  if (changed) {
    grid.set(mediaGrid);
    glyphIdsDirty = true;
    redraw();
  }

  const cost = performance.now() - startedAt;
  mediaState.averageCostMs = mediaState.averageCostMs
    ? mediaState.averageCostMs * 0.8 + cost * 0.2
    : cost;

  const now = performance.now();
  if (message) updateStatus(message);
  else if (!mediaState.playing || now - lastLiveStatusAt >= 500) {
    const effectiveFPS = Math.min(Number(P.mediaFPS), 1000 / Math.max(1, mediaState.averageCostMs * 2));
    updateStatus(mediaState.playing ? `Live · ${effectiveFPS.toFixed(1)} fps` : "Source remapped");
    lastLiveStatusAt = now;
  }
  return changed;
}

function hookUI() {
  const fileInput = document.getElementById("mediaFileInput");
  const dropZone = document.getElementById("mediaDropZone");
  document.getElementById("importMediaBtn").addEventListener("click", () => fileInput.click());
  document.getElementById("webcamBtn").addEventListener("click", useWebcam);
  document.getElementById("playPauseBtn").addEventListener("click", toggleLiveMedia);
  document.getElementById("captureFrameBtn").addEventListener("click", captureMediaFrame);
  document.getElementById("clearSourceBtn").addEventListener("click", clearMediaSource);
  fileInput.addEventListener("change", (event) => {
    loadMediaFile(event.target.files?.[0]);
    event.target.value = "";
  });
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  }
  dropZone.addEventListener("drop", (event) => loadMediaFile(event.dataTransfer?.files?.[0]));

  document.getElementById("clearBtn").addEventListener("click", clearGrid);
  document.getElementById("randomBtn").addEventListener("click", randomFill);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  window.addEventListener("resize", updateCanvasDisplaySize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelMediaCallback();
    else if (mediaState.playing) scheduleNextMediaFrame();
  });
  window.addEventListener("beforeunload", releaseMediaSource);
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (/^[1-4]$/.test(event.key)) setGlyphSet(Number(event.key) - 1);
    if (event.key.toLowerCase() === "g") {
      P.showGrid = !P.showGrid;
      refreshDial();
      redraw();
    }
    if (event.key.toLowerCase() === "c") clearGrid();
    if (event.key.toLowerCase() === "r") randomFill();
    if (event.key.toLowerCase() === "s") exportSVG();
  });
}
