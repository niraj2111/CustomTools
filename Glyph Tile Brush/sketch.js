const GLYPH_SETS = [
  { label: "Glyph Set 1", folder: "data1" },
  { label: "Glyph Set 2", folder: "data2" },
  { label: "Glyph Set 3", folder: "data3" },
  { label: "Glyph Set 4", folder: "data6" },
];

const GLYPH_COUNT = 16;
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
let grid = [];
let cols = 0;
let rows = 0;
let dragValue = true;
let dragging = false;
let visitedDuringDrag = new Set();

function preload() {
  GLYPH_SETS.forEach((set, setIndex) => {
    for (let glyph = 1; glyph <= GLYPH_COUNT; glyph += 1) {
      const path = `${set.folder}/${glyph}.svg`;
      glyphImages[setIndex][glyph] = loadImage(path);
      glyphSources[setIndex][glyph] = loadStrings(path);
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

  push();
  scale(pxPerMM);

  imageMode(CENTER);
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      if (!grid[col]?.[row]) continue;
      const glyph = glyphForCell(col, row);
      const img = glyphImages[setIndex][glyph];
      if (!img) continue;
      const size = P.cellSizeMM * P.glyphScale;
      const x = inner.x + col * P.cellSizeMM + P.cellSizeMM * 0.5;
      const y = inner.y + row * P.cellSizeMM + P.cellSizeMM * 0.5;
      image(img, x, y, size, size);
    }
  }

  if (P.showGrid) drawGrid(inner);
  pop();
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
  grid = Array.from({ length: cols }, (_, col) =>
    Array.from({ length: rows }, (_, row) =>
      preserve && col < previousCols && row < previousRows ? Boolean(previous[col]?.[row]) : false
    )
  );
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
  return col >= 0 && col < cols && row >= 0 && row < rows && Boolean(grid[col]?.[row]);
}

function glyphForCell(col, row) {
  const top = isCellActive(col, row - 1);
  const right = isCellActive(col + 1, row);
  const bottom = isCellActive(col, row + 1);
  const left = isCellActive(col - 1, row);
  const mask = (top ? 8 : 0) | (right ? 4 : 0) | (bottom ? 2 : 0) | (left ? 1 : 0);
  const glyphByMask = [14, 2, 1, 10, 4, 15, 9, 5, 3, 11, 16, 8, 12, 7, 6, 13];
  return glyphByMask[mask];
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
  const cell = cellAtCanvasPosition(x, y);
  if (!cell) return false;
  dragging = true;
  visitedDuringDrag = new Set();
  if (forceErase || P.brushMode === "Erase") dragValue = false;
  else if (P.brushMode === "Paint") dragValue = true;
  else dragValue = !grid[cell.col][cell.row];
  paintCell(cell);
  return false;
}

function paintCell(cell) {
  if (!cell) return;
  const key = `${cell.col}:${cell.row}`;
  if (visitedDuringDrag.has(key)) return;
  visitedDuringDrag.add(key);
  grid[cell.col][cell.row] = dragValue;
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
  grid.forEach((column) => column.fill(false));
  updateStatus("Cleared");
  redraw();
}

function randomFill() {
  const density = Math.max(0, Math.min(1, Number(P.randomDensity)));
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      grid[col][row] = Math.random() < density;
    }
  }
  updateStatus("Random fill generated");
  redraw();
}

function activeCellCount() {
  let count = 0;
  grid.forEach((column) => column.forEach((active) => { if (active) count += 1; }));
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
      const source = (setSources[glyph] || []).join("\n");
      const documentNode = parser.parseFromString(source, "image/svg+xml");
      const svg = documentNode.documentElement;
      const viewBox = svg.getAttribute("viewBox") || `0 0 ${svg.getAttribute("width") || 300} ${svg.getAttribute("height") || 300}`;
      const presentationAttributes = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "color", "style"]
        .filter((name) => svg.hasAttribute(name))
        .map((name) => `${name}="${ExportUtils.escapeXML(svg.getAttribute(name))}"`)
        .join(" ");
      const content = Array.from(svg.childNodes)
        .filter((node) => node.nodeType !== Node.ELEMENT_NODE || node.nodeName.toLowerCase() !== "title")
        .map((node) => serializer.serializeToString(node))
        .join("");
      glyphDefinitions[setIndex][glyph] = { viewBox, content, presentationAttributes };
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
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(P.canvasHMM)}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`,
    "<defs>",
  ];

  for (let glyph = 1; glyph <= GLYPH_COUNT; glyph += 1) {
    const definition = glyphDefinitions[setIndex][glyph];
    if (!definition) continue;
    svg.push(`<symbol id="glyph-${setNumber}-${glyph}" viewBox="${ExportUtils.escapeXML(definition.viewBox)}"${definition.presentationAttributes ? ` ${definition.presentationAttributes}` : ""}>${definition.content}</symbol>`);
  }
  svg.push(`<clipPath id="artwork-clip"><rect x="${ExportUtils.fmt(inner.x)}" y="${ExportUtils.fmt(inner.y)}" width="${ExportUtils.fmt(inner.w)}" height="${ExportUtils.fmt(inner.h)}"/></clipPath>`);
  svg.push("</defs>");

  if (P.svgIncludeBackground) {
    svg.push(`<rect width="${ExportUtils.fmt(P.canvasWMM)}" height="${ExportUtils.fmt(P.canvasHMM)}" fill="${ExportUtils.escapeXML(P.paperColor)}"/>`);
  }

  svg.push(`<g id="glyph-tiles" clip-path="url(#artwork-clip)">`);
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      if (!grid[col]?.[row]) continue;
      const glyph = glyphForCell(col, row);
      const x = inner.x + col * P.cellSizeMM + P.cellSizeMM * 0.5 - size * 0.5;
      const y = inner.y + row * P.cellSizeMM + P.cellSizeMM * 0.5 - size * 0.5;
      svg.push(`<use href="#glyph-${setNumber}-${glyph}" xlink:href="#glyph-${setNumber}-${glyph}" x="${ExportUtils.fmt(x)}" y="${ExportUtils.fmt(y)}" width="${ExportUtils.fmt(size)}" height="${ExportUtils.fmt(size)}"/>`);
    }
  }
  svg.push("</g>", "</svg>");
  return svg.join("\n");
}

function exportSVG() {
  const rawName = String(P.svgFilename || "Glyph-Tile-Brush.svg").trim();
  const filename = rawName.toLowerCase().endsWith(".svg") ? rawName : `${rawName}.svg`;
  ExportUtils.downloadText(buildSvgDocument(), filename, "image/svg+xml");
  updateStatus("SVG exported");
}

const DIAL_PATHS = {
  "brush.glyphSet": "glyphSet",
  "brush.cellSizeMM": "cellSizeMM",
  "brush.glyphScale": "glyphScale",
  "brush.brushMode": "brushMode",
  "brush.randomDensity": "randomDensity",
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

function hookUI() {
  document.getElementById("clearBtn").addEventListener("click", clearGrid);
  document.getElementById("randomBtn").addEventListener("click", randomFill);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  window.addEventListener("resize", updateCanvasDisplaySize);
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
