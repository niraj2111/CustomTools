const MM_PER_INCH = 25.4;

let pane;
let cnv;

const P = {
  canvasWMM: 270,
  canvasHMM: 400,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 10,
  cellWMM: 50,
  gutterMM: 2,
  colsMode: "auto",
  colsFixed: 5,
  numRows: 80,
  usableMin: 0.5,
  usableMax: 1.0,
  seed: 4,
  noiseDetailOct: 2,
  noiseDetailFalloff: 0.1,
  weightNoiseX: 0.1,
  weightNoiseY: 0.1,
  bg: "#ffffff",
  palette0: "#009688",
  palette1: "#4CAF50",
  palette2: "#EC5110",
  colorMode: "fixed",
  fixedPaletteIndex: 0,
  bands: 2,
  strokeWeightMM: 1,
  lineCap: "round",
  multiply: true,
  svgIncludeBackground: true,
  svgFilename: "Axi-DynamicColumnGrid.svg",
};

let columns = [];
let t = 0;

function setup() {
  const size = getCanvasPixelSize();
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  regenerate();
  syncCanvasSize();
  redraw();
}

function draw() {
  background(P.bg);
  noiseDetail(P.noiseDetailOct, P.noiseDetailFalloff);
  t = 0;

  push();
  scale(getPxPerMM());
  translate(P.marginMM, P.marginMM);

  if (P.multiply) {
    blendMode(MULTIPLY);
  } else {
    blendMode(BLEND);
  }

  strokeWeight(P.strokeWeightMM);
  strokeCap(capToP5(P.lineCap));
  noFill();

  for (const column of columns) {
    column.display();
  }

  pop();
  blendMode(BLEND);
}

function windowResized() {
  updateCanvasDisplaySize();
}

class Column {
  constructor(xOffsetMM, index, numRows, usableHeightMM) {
    this.xOffsetMM = xOffsetMM;
    this.index = index;
    this.numRows = numRows;
    this.usableHeightMM = usableHeightMM;
  }

  display() {
    const weights = new Array(this.numRows);
    for (let j = 0; j < this.numRows; j += 1) {
      const n = noise(this.index * P.weightNoiseX + t, j * P.weightNoiseY + t, t);
      weights[j] = n + 0.01;
    }

    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    const cellHeights = weights.map((weight) => (weight / weightSum) * this.usableHeightMM);

    const drawableHMM = getInnerHeightMM();
    let yOffsetMM = (drawableHMM - this.usableHeightMM) / 2;

    for (let j = 0; j < this.numRows; j += 1) {
      const hMM = cellHeights[j];
      stroke(pickColor(this.index, j));

      push();
      translate(this.xOffsetMM, yOffsetMM);
      drawBandSnakeCell(0, 0, P.cellWMM, hMM, P.bands);
      pop();

      yOffsetMM += hMM;
    }
  }
}

function drawBandSnakeCell(xMM, yMM, wMM, hMM, bands) {
  const localWMM = Math.max(0, wMM - P.gutterMM);
  const lines = Math.max(1, Math.floor(bands));
  const gapMM = hMM / lines;

  push();
  translate(xMM, yMM);

  beginShape();
  for (let i = 0; i < lines; i += 2) {
    const y0 = Math.min(i * gapMM, hMM);
    const y1 = Math.min((i + 1) * gapMM, hMM);
    const y2 = Math.min((i + 2) * gapMM, hMM);

    vertex(0, y0);
    vertex(localWMM, y0);
    vertex(localWMM, y1);
    vertex(0, y1);
    vertex(0, y2);
  }
  endShape();

  pop();
}

function paletteArray() {
  return [P.palette0, P.palette1, P.palette2];
}

function pickColor(colIndex, rowIndex) {
  const pal = paletteArray();
  if (P.colorMode === "fixed") {
    const idx = clampInt(P.fixedPaletteIndex, 0, pal.length - 1);
    return pal[idx];
  }

  const nv = noise(colIndex * 0.1 + t, rowIndex * 0.1 + t);
  const idx = clampInt(Math.floor(map(nv, 0, 1, 0, pal.length)), 0, pal.length - 1);
  return pal[idx];
}

function regenerate() {
  columns = [];
  randomSeed(P.seed);
  noiseSeed(P.seed);

  const innerWMM = getInnerWidthMM();
  const innerHMM = getInnerHeightMM();
  if (innerWMM <= 0 || innerHMM <= 0) {
    return;
  }

  const cols = computeCols(innerWMM);
  const numRows = Math.max(1, Math.floor(P.numRows));
  const usableMinMM = innerHMM * clamp01(P.usableMin);
  const usableMaxMM = innerHMM * clamp01(P.usableMax);

  for (let i = 0; i < cols; i += 1) {
    const colXMM = i * P.cellWMM;
    const usableHeightMM = random(
      Math.min(usableMinMM, usableMaxMM),
      Math.max(usableMinMM, usableMaxMM)
    );

    columns.push(new Column(colXMM, i, numRows, usableHeightMM));
  }
}

function computeCols(innerWMM) {
  const maxCols = getMaxColumns(innerWMM);
  if (P.colsMode === "fixed") {
    return Math.min(Math.max(1, Math.floor(P.colsFixed)), maxCols);
  }
  return maxCols;
}

function exportSVG() {
  regenerate();

  const wMM = P.canvasWMM;
  const hMM = P.canvasHMM;
  const innerWMM = getInnerWidthMM();
  const innerHMM = getInnerHeightMM();
  const pal = paletteArray();
  const cap = P.lineCap === "square" || P.lineCap === "butt" ? P.lineCap : "round";
  const swMM = Math.max(0.0001, P.strokeWeightMM);

  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(wMM)}mm" height="${fmt(
      hMM
    )}mm" viewBox="0 0 ${fmt(wMM)} ${fmt(hMM)}">`
  );

  if (P.svgIncludeBackground) {
    svg.push(
      `<rect x="0" y="0" width="${fmt(wMM)}" height="${fmt(hMM)}" fill="${escapeXML(P.bg)}"/>`
    );
  }

  svg.push(P.multiply ? '<g style="mix-blend-mode:multiply">' : "<g>");

  const cols = computeCols(innerWMM);
  const numRows = Math.max(1, Math.floor(P.numRows));
  const usableMinMM = innerHMM * clamp01(P.usableMin);
  const usableMaxMM = innerHMM * clamp01(P.usableMax);

  randomSeed(P.seed);
  noiseSeed(P.seed);
  noiseDetail(P.noiseDetailOct, P.noiseDetailFalloff);

  for (let i = 0; i < cols; i += 1) {
    const usableHeightMM = random(
      Math.min(usableMinMM, usableMaxMM),
      Math.max(usableMinMM, usableMaxMM)
    );

    const weights = new Array(numRows);
    for (let j = 0; j < numRows; j += 1) {
      const n = noise(i * P.weightNoiseX, j * P.weightNoiseY, 0);
      weights[j] = n + 0.01;
    }

    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    const cellHeightsMM = weights.map((weight) => (weight / weightSum) * usableHeightMM);
    let yOffsetMM = (innerHMM - usableHeightMM) / 2;

    for (let j = 0; j < numRows; j += 1) {
      const cellHeightMM = cellHeightsMM[j];
      const strokeColor =
        P.colorMode === "fixed"
          ? pal[clampInt(P.fixedPaletteIndex, 0, pal.length - 1)]
          : pal[
              clampInt(
                Math.floor(map(noise(i * 0.1, j * 0.1), 0, 1, 0, pal.length)),
                0,
                pal.length - 1
              )
            ];

      const x0MM = P.marginMM + i * P.cellWMM;
      const y0MM = P.marginMM + yOffsetMM;
      const d = snakePathD(x0MM, y0MM, P.cellWMM, cellHeightMM, P.bands, P.gutterMM);

      svg.push(
        `<path d="${d}" fill="none" stroke="${escapeXML(
          strokeColor
        )}" stroke-width="${fmt(swMM)}" stroke-linecap="${cap}"/>`
      );

      yOffsetMM += cellHeightMM;
    }
  }

  svg.push("</g>");
  svg.push("</svg>");

  downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function snakePathD(xMM, yMM, wMM, hMM, bands, gutterMM) {
  const localWMM = Math.max(0, wMM - gutterMM);
  const lines = Math.max(1, Math.floor(bands));
  const gapMM = hMM / lines;
  const points = [];

  for (let i = 0; i < lines; i += 2) {
    const y0 = Math.min(i * gapMM, hMM);
    const y1 = Math.min((i + 1) * gapMM, hMM);
    const y2 = Math.min((i + 2) * gapMM, hMM);

    points.push([xMM, yMM + y0]);
    points.push([xMM + localWMM, yMM + y0]);
    points.push([xMM + localWMM, yMM + y1]);
    points.push([xMM, yMM + y1]);
    points.push([xMM, yMM + y2]);
  }

  if (points.length === 0) {
    return "";
  }

  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
  }
  return d;
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Dynamic Column Grid",
  });

  const fCanvas = pane.addFolder({ title: "Canvas (mm)" });
  fCanvas.addInput(P, "canvasWMM", { min: 10, max: 2000, step: 1, label: "W mm" });
  fCanvas.addInput(P, "canvasHMM", { min: 10, max: 2000, step: 1, label: "H mm" });
  fCanvas.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" });
  fCanvas.addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" });
  fCanvas.addInput(P, "fitToViewport", { label: "Fit View" });
  fCanvas.addInput(P, "marginMM", { min: 0, max: 200, step: 0.5, label: "Margin" });

  const fGrid = pane.addFolder({ title: "Columns (mm)" });
  fGrid.addInput(P, "cellWMM", { min: 1, max: 400, step: 0.5, label: "Cell W" });
  fGrid.addInput(P, "gutterMM", { min: 0, max: 50, step: 0.1, label: "Gutter" });
  fGrid.addInput(P, "colsMode", {
    options: { auto: "auto", fixed: "fixed" },
    label: "Cols Mode",
  });
  fGrid.addInput(P, "colsFixed", { min: 1, max: 200, step: 1, label: "Cols" });

  const fRows = pane.addFolder({ title: "Rows / Heights" });
  fRows.addInput(P, "numRows", { min: 1, max: 300, step: 1, label: "Num Rows" });
  fRows.addInput(P, "usableMin", { min: 0.05, max: 1.0, step: 0.01, label: "Usable Min" });
  fRows.addInput(P, "usableMax", { min: 0.05, max: 1.0, step: 0.01, label: "Usable Max" });

  const fPattern = pane.addFolder({ title: "Cell Pattern" });
  fPattern.addInput(P, "bands", { min: 1, max: 40, step: 1, label: "Bands" });
  fPattern.addInput(P, "strokeWeightMM", {
    min: 0.05,
    max: 10,
    step: 0.05,
    label: "Stroke",
  });
  fPattern.addInput(P, "lineCap", {
    options: { round: "round", square: "square", butt: "butt" },
    label: "Cap",
  });

  const fNoise = pane.addFolder({ title: "Noise" });
  fNoise.addInput(P, "seed", { min: 0, max: 9999, step: 1, label: "Seed" });
  fNoise.addInput(P, "noiseDetailOct", { min: 1, max: 8, step: 1, label: "Octaves" });
  fNoise.addInput(P, "noiseDetailFalloff", {
    min: 0.01,
    max: 0.99,
    step: 0.01,
    label: "Falloff",
  });
  fNoise.addInput(P, "weightNoiseX", { min: 0.01, max: 1.0, step: 0.01, label: "Weight X" });
  fNoise.addInput(P, "weightNoiseY", { min: 0.01, max: 1.0, step: 0.01, label: "Weight Y" });

  const fColor = pane.addFolder({ title: "Color / Blend" });
  fColor.addInput(P, "bg", { label: "BG" });
  fColor.addInput(P, "palette0", { label: "P0" });
  fColor.addInput(P, "palette1", { label: "P1" });
  fColor.addInput(P, "palette2", { label: "P2" });
  fColor.addInput(P, "colorMode", {
    options: { fixed: "fixed", noise: "noise" },
    label: "Mode",
  });
  fColor.addInput(P, "fixedPaletteIndex", { min: 0, max: 2, step: 1, label: "Fixed Idx" });
  fColor.addInput(P, "multiply", { label: "Multiply" });

  const fExport = pane.addFolder({ title: "Export" });
  fExport.addInput(P, "svgIncludeBackground", { label: "SVG BG" });
  fExport.addInput(P, "svgFilename", { label: "Filename" });
  fExport.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });

  pane.on("change", () => {
    if (P.usableMin > P.usableMax) {
      P.usableMax = P.usableMin;
    }
    regenerate();
    syncCanvasSize();
    redraw();
  });
}

function hookUI() {
  document.getElementById("regenBtn").addEventListener("click", () => {
    regenerate();
    redraw();
  });

  document.getElementById("svgBtn").addEventListener("click", () => {
    exportSVG();
  });

  window.addEventListener("resize", updateCanvasDisplaySize);
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
  const displayW = Math.max(1, Math.round(pxSize.width * scale));
  const displayH = Math.max(1, Math.round(pxSize.height * scale));

  cnv.style("width", `${displayW}px`);
  cnv.style("height", `${displayH}px`);
}

function getPxPerMM() {
  return P.dpi / MM_PER_INCH;
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

function getInnerWidthMM() {
  return P.canvasWMM - 2 * P.marginMM;
}

function getInnerHeightMM() {
  return P.canvasHMM - 2 * P.marginMM;
}

function getMaxColumns(innerWMM) {
  const safeCellWidth = Math.max(0.0001, P.cellWMM);
  return Math.max(1, Math.floor(innerWMM / safeCellWidth));
}

function capToP5(v) {
  if (v === "square") {
    return PROJECT;
  }
  if (v === "butt") {
    return SQUARE;
  }
  return ROUND;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function clampInt(v, min, max) {
  const intValue = Math.floor(v);
  return Math.max(min, Math.min(max, intValue));
}

function fmt(n) {
  return Number(n).toFixed(3).replace(/\.?0+$/, "");
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
