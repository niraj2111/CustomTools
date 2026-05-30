const MAX_CELLS = 220;
const MAX_POINTS_PER_SPIRAL = 1600;
const MAX_SITE_ATTEMPTS = 12000;
const MAX_ROUND_ITERATIONS = 6;
const MAX_SMOOTH_ITERATIONS = 3;

const SITE_PRESET_OPTIONS = {
  Random: "Random",
  "Grid jitter": "Grid jitter",
  "Flow field": "Flow field",
  Spiral: "Spiral",
  Rings: "Rings",
  "Center dense": "Center dense",
  "Edge dense": "Edge dense",
  "Diagonal band": "Diagonal band",
  "Vertical bands": "Vertical bands",
};

let pane;
let cnv;
let redrawTimer = null;
let regenerateTimer = null;
let rebuildTimer = null;

const scene = {
  sites: [],
  cells: [],
  painted: new Set(),
};

const P = {
  canvasWMM: 210,
  canvasHMM: 297,
  paperPreset: "A4 Portrait",
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 12,
  bg: "#ffffff",
  paperColor: "#ffffff",
  strokeColor: "#111111",
  siteColor: "#111111",
  baseCellColor: "#111111",
  organicCellColor: "#df4a38",
  strokeWeightMM: 0.35,
  debugView: false,
  showSites: true,
  showBaseCells: true,
  showOrganicCells: true,
  seed: 1,
  targetCells: 72,
  sitePreset: "Diagonal band",
  minSiteDistance: 16,
  siteJitter: 0.55,
  siteNoiseAmount: 12,
  siteNoiseScale: 0.09,
  bandStrength: 0.45,
  cellPadding: 2.5,
  roundIterations: 2,
  roundRatio: 0.25,
  boundaryWobble: 0.8,
  boundaryWobbleScale: 0.18,
  spiralGap: 1.1,
  pointSpacing: 0.9,
  minTurns: 1.25,
  maxTurns: 18,
  spiralFreq: 1,
  spiralMargin: 0.94,
  localNoiseScale: 4,
  minNoiseMM: 0.6,
  noiseRelative: 0.2,
  noiseBalance: 0.65,
  spiralSmoothIterations: 1,
  svgIncludeBackground: true,
  svgFilename: "Voronoi-Organic-Spiral-Cells.svg",
  pngFilename: "Voronoi-Organic-Spiral-Cells",
};

function setup() {
  const size = PaperUtils.getCanvasPixelSize(P);
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  cnv.style("display", "block");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  PaperUtils.applyPaperPreset(P, P.paperPreset);
  syncCanvasSize();
  regenerate();
}

function draw() {
  background(P.bg);

  push();
  scale(PaperUtils.getPxPerMM(P));
  drawPaper();
  drawPaintedCells();
  if (P.debugView) {
    drawDebugOverlay();
  }
  pop();
}

function windowResized() {
  updateCanvasDisplaySize();
}

function mousePressed() {
  revealCellAtPointer();
}

function mouseDragged() {
  revealCellAtPointer();
}

function keyPressed() {
  if (key === "d" || key === "D") {
    P.debugView = !P.debugView;
    pane.refresh();
    redrawScene();
    return;
  }

  if (key === "r" || key === "R") {
    regenerate();
    return;
  }

  if (key === "c" || key === "C") {
    clearPaint();
    return;
  }

  if (key === "a" || key === "A") {
    paintAll();
    return;
  }

  if (key === "s" || key === "S") {
    exportPNG();
  }
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Voronoi Spiral Cells",
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
      requestRegenerate();
    });
  canvasFolder
    .addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      requestRegenerate();
    });
  canvasFolder
    .addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      requestRegenerate();
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
    .on("change", requestRegenerate);

  const cellFolder = pane.addFolder({ title: "Sites / Cells" });
  cellFolder
    .addInput(P, "sitePreset", { options: SITE_PRESET_OPTIONS, label: "Preset" })
    .on("change", requestRegenerate);
  cellFolder.addInput(P, "targetCells", { min: 8, max: MAX_CELLS, step: 1, label: "Cells" }).on("change", requestRegenerate);
  cellFolder
    .addInput(P, "seed", { min: 1, max: 999999, step: 1, label: "Seed" })
    .on("change", requestRegenerate);
  cellFolder
    .addInput(P, "minSiteDistance", { min: 1, max: 80, step: 0.5, label: "Min Dist" })
    .on("change", requestRegenerate);
  cellFolder
    .addInput(P, "siteJitter", { min: 0, max: 1.5, step: 0.01, label: "Jitter" })
    .on("change", requestRegenerate);
  cellFolder
    .addInput(P, "siteNoiseAmount", { min: 0, max: 50, step: 0.25, label: "Noise Amt" })
    .on("change", requestRegenerate);
  cellFolder
    .addInput(P, "siteNoiseScale", { min: 0.001, max: 0.4, step: 0.001, label: "Noise Scale" })
    .on("change", requestRegenerate);
  cellFolder
    .addInput(P, "bandStrength", { min: 0, max: 1, step: 0.01, label: "Band Bias" })
    .on("change", requestRegenerate);
  cellFolder
    .addButton({ title: "Randomize Seed" })
    .on("click", () => {
      P.seed = Math.floor(random(1, 1000000));
      pane.refresh();
      regenerate();
    });

  const boundaryFolder = pane.addFolder({ title: "Boundary" });
  boundaryFolder
    .addInput(P, "cellPadding", { min: 0, max: 24, step: 0.25, label: "Padding" })
    .on("change", requestRebuild);
  boundaryFolder
    .addInput(P, "roundIterations", {
      min: 0,
      max: MAX_ROUND_ITERATIONS,
      step: 1,
      label: "Round Iter",
    })
    .on("change", requestRebuild);
  boundaryFolder
    .addInput(P, "roundRatio", { min: 0.05, max: 0.45, step: 0.01, label: "Round Ratio" })
    .on("change", requestRebuild);
  boundaryFolder
    .addInput(P, "boundaryWobble", { min: 0, max: 8, step: 0.05, label: "Wobble" })
    .on("change", requestRebuild);
  boundaryFolder
    .addInput(P, "boundaryWobbleScale", {
      min: 0.01,
      max: 0.8,
      step: 0.005,
      label: "Wobble S",
    })
    .on("change", requestRebuild);

  const spiralFolder = pane.addFolder({ title: "Spiral" });
  spiralFolder
    .addInput(P, "spiralGap", { min: 0.1, max: 12, step: 0.01, label: "Line Gap" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "pointSpacing", { min: 0.25, max: 6, step: 0.05, label: "Point Gap" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "minTurns", { min: 0.25, max: 8, step: 0.05, label: "Min Turns" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "maxTurns", { min: 1, max: 60, step: 0.25, label: "Max Turns" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "spiralFreq", { min: 0.5, max: 24, step: 0.05, label: "Frequency" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "spiralMargin", { min: 0.2, max: 1.08, step: 0.01, label: "Margin" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "localNoiseScale", { min: 0.5, max: 12, step: 0.1, label: "Noise Scale" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "minNoiseMM", { min: 0, max: 8, step: 0.05, label: "Min Noise" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "noiseRelative", { min: 0, max: 0.9, step: 0.01, label: "Noise Rel" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "noiseBalance", { min: 0, max: 1, step: 0.01, label: "Noise Mix" })
    .on("change", requestRebuild);
  spiralFolder
    .addInput(P, "spiralSmoothIterations", {
      min: 0,
      max: MAX_SMOOTH_ITERATIONS,
      step: 1,
      label: "Smooth",
    })
    .on("change", requestRebuild);

  const styleFolder = pane.addFolder({ title: "Style / Debug" });
  styleFolder.addInput(P, "bg", { label: "BG" }).on("change", redrawScene);
  styleFolder.addInput(P, "paperColor", { label: "Paper" }).on("change", redrawScene);
  styleFolder.addInput(P, "strokeColor", { label: "Stroke" }).on("change", redrawScene);
  styleFolder.addInput(P, "siteColor", { label: "Sites" }).on("change", redrawScene);
  styleFolder.addInput(P, "baseCellColor", { label: "Base Cell" }).on("change", redrawScene);
  styleFolder.addInput(P, "organicCellColor", { label: "Organic" }).on("change", redrawScene);
  styleFolder
    .addInput(P, "strokeWeightMM", { min: 0.05, max: 4, step: 0.01, label: "Stroke mm" })
    .on("change", redrawScene);
  styleFolder.addInput(P, "debugView", { label: "Debug" }).on("change", redrawScene);
  styleFolder.addInput(P, "showSites", { label: "Show Sites" }).on("change", redrawScene);
  styleFolder.addInput(P, "showBaseCells", { label: "Show Base" }).on("change", redrawScene);
  styleFolder.addInput(P, "showOrganicCells", { label: "Show Organic" }).on("change", redrawScene);

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgIncludeBackground", { label: "SVG BG" });
  exportFolder.addInput(P, "svgFilename", { label: "SVG Name" });
  exportFolder.addInput(P, "pngFilename", { label: "PNG Name" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });
}

function hookUI() {
  document.getElementById("regenBtn").addEventListener("click", regenerate);
  document.getElementById("clearBtn").addEventListener("click", clearPaint);
  document.getElementById("paintBtn").addEventListener("click", paintAll);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  document.getElementById("pngBtn").addEventListener("click", exportPNG);
  window.addEventListener("resize", updateCanvasDisplaySize);
}

function syncCanvasSize() {
  PaperUtils.syncCanvasSize(cnv, P, resizeCanvas, "wrap", 28);
}

function updateCanvasDisplaySize() {
  PaperUtils.updateCanvasDisplaySize(cnv, P, "wrap", 28);
}

function requestRedraw() {
  if (redrawTimer) {
    clearTimeout(redrawTimer);
  }

  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    redrawScene();
  }, 30);
}

function requestRebuild() {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildRenderableGeometry();
    redrawScene();
  }, 40);
}

function requestRegenerate() {
  if (regenerateTimer) {
    clearTimeout(regenerateTimer);
  }

  regenerateTimer = setTimeout(() => {
    regenerateTimer = null;
    regenerate();
  }, 90);
}

function redrawScene() {
  redraw();
}

function clearPaint() {
  scene.painted.clear();
  redrawScene();
}

function paintAll() {
  scene.painted = new Set(scene.cells.map((_, index) => index));
  redrawScene();
}

function regenerate() {
  normalizeParams();
  randomSeed(P.seed);
  noiseSeed(P.seed);

  scene.painted.clear();
  scene.sites = [];
  scene.cells = [];

  generateSites();
  generateVoronoi();
  rebuildRenderableGeometry();
  redrawScene();
}

function rebuildRenderableGeometry() {
  normalizeParams();
  for (let i = 0; i < scene.cells.length; i += 1) {
    const cell = scene.cells[i];
    cell.organicPoly = getOrganicCellPoly(cell.poly, i);
    cell.centroid = centroid(cell.organicPoly);
    cell.radius = averageRadiusFromCentroid(cell.centroid, cell.organicPoly);
    cell.spiralPts = buildOrganicCellSpiral(cell.organicPoly, i, cell.centroid, cell.radius);
  }
}

function drawPaper() {
  noStroke();
  fill(P.paperColor);
  rect(0, 0, P.canvasWMM, P.canvasHMM);
}

function drawPaintedCells() {
  noFill();
  stroke(P.strokeColor);
  strokeWeight(P.strokeWeightMM);
  strokeCap(ROUND);
  strokeJoin(ROUND);

  for (const cellIndex of scene.painted) {
    const cell = scene.cells[cellIndex];
    if (!cell || !cell.spiralPts || cell.spiralPts.length < 2) {
      continue;
    }
    drawPolyline(cell.spiralPts);
  }
}

function drawDebugOverlay() {
  if (P.showBaseCells) {
    noFill();
    stroke(P.baseCellColor);
    strokeWeight(0.12);
    for (const cell of scene.cells) {
      if (!cell.poly || cell.poly.length < 3) {
        continue;
      }
      drawClosedPolyline(cell.poly);
    }
  }

  if (P.showOrganicCells) {
    noFill();
    stroke(P.organicCellColor);
    strokeWeight(0.18);
    for (const cell of scene.cells) {
      if (!cell.organicPoly || cell.organicPoly.length < 3) {
        continue;
      }
      drawClosedPolyline(cell.organicPoly);
    }
  }

  if (P.showSites) {
    noStroke();
    fill(P.siteColor);
    for (const site of scene.sites) {
      circle(site.x, site.y, 1.4);
    }
  }
}

function drawPolyline(points) {
  beginShape();
  for (const point of points) {
    vertex(point.x, point.y);
  }
  endShape();
}

function drawClosedPolyline(points) {
  beginShape();
  for (const point of points) {
    vertex(point.x, point.y);
  }
  endShape(CLOSE);
}

function revealCellAtPointer() {
  const point = getMousePointMM();
  if (!point || !insideBounds(point)) {
    return;
  }

  for (let i = 0; i < scene.cells.length; i += 1) {
    if (scene.painted.has(i)) {
      continue;
    }

    const hitPoly = scene.cells[i].organicPoly || scene.cells[i].poly;
    if (pointInPolygon(point, hitPoly)) {
      scene.painted.add(i);
      requestRedraw();
      return;
    }
  }
}

function getMousePointMM() {
  const pxPerMM = PaperUtils.getPxPerMM(P);
  if (pxPerMM <= 0) {
    return null;
  }

  return {
    x: mouseX / pxPerMM,
    y: mouseY / pxPerMM,
  };
}

function getBounds() {
  return {
    x: P.marginMM,
    y: P.marginMM,
    w: Math.max(1, P.canvasWMM - P.marginMM * 2),
    h: Math.max(1, P.canvasHMM - P.marginMM * 2),
  };
}

function insideBounds(point) {
  const bounds = getBounds();
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.w &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.h
  );
}

function generateSites() {
  const count = constrain(Math.floor(P.targetCells), 3, MAX_CELLS);
  const preset = P.sitePreset;

  if (preset === "Random") {
    generateRandomSites(count);
  } else if (preset === "Grid jitter") {
    generateGridJitterSites(count);
  } else if (preset === "Flow field") {
    generateFlowFieldSites(count);
  } else if (preset === "Spiral") {
    generateSpiralSites(count);
  } else if (preset === "Rings") {
    generateRingSites(count);
  } else if (preset === "Center dense") {
    generateCenterDenseSites(count);
  } else if (preset === "Edge dense") {
    generateEdgeDenseSites(count);
  } else if (preset === "Diagonal band") {
    generateDiagonalBandSites(count);
  } else if (preset === "Vertical bands") {
    generateVerticalBandSites(count);
  } else {
    generateRandomSites(count);
  }

  if (scene.sites.length < count) {
    fillSitesFallback(count);
  }
}

function addSiteIfFarEnough(x, y, minDistance) {
  const bounds = getBounds();
  const px = constrain(x, bounds.x, bounds.x + bounds.w);
  const py = constrain(y, bounds.y, bounds.y + bounds.h);
  const minDistSq = minDistance * minDistance;

  for (const site of scene.sites) {
    if (distSq(px, py, site.x, site.y) < minDistSq) {
      return false;
    }
  }

  scene.sites.push({ x: px, y: py });
  return true;
}

function generateRandomSites(count) {
  const bounds = getBounds();
  let attempts = 0;

  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    addSiteIfFarEnough(
      random(bounds.x, bounds.x + bounds.w),
      random(bounds.y, bounds.y + bounds.h),
      P.minSiteDistance
    );
  }
}

function generateGridJitterSites(count) {
  const bounds = getBounds();
  const aspect = bounds.w / bounds.h;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = bounds.w / cols;
  const cellH = bounds.h / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (scene.sites.length >= count) {
        return;
      }

      const x = bounds.x + cellW * (col + 0.5) + random(-cellW, cellW) * 0.5 * P.siteJitter;
      const y = bounds.y + cellH * (row + 0.5) + random(-cellH, cellH) * 0.5 * P.siteJitter;
      addSiteIfFarEnough(x, y, P.minSiteDistance);
    }
  }

  fillSitesFallback(count);
}

function generateFlowFieldSites(count) {
  const bounds = getBounds();
  const tempSites = [];
  const aspect = bounds.w / bounds.h;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = bounds.w / cols;
  const cellH = bounds.h / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (tempSites.length >= count) {
        break;
      }

      const x = bounds.x + cellW * (col + 0.5) + random(-cellW, cellW) * 0.5 * P.siteJitter;
      const y = bounds.y + cellH * (row + 0.5) + random(-cellH, cellH) * 0.5 * P.siteJitter;
      tempSites.push({ x, y });
    }
  }

  for (const site of tempSites) {
    const angle = noise(site.x * P.siteNoiseScale, site.y * P.siteNoiseScale, P.seed * 0.01) * TWO_PI * 2;
    const x = site.x + cos(angle) * P.siteNoiseAmount;
    const y = site.y + sin(angle) * P.siteNoiseAmount;
    addSiteIfFarEnough(x, y, P.minSiteDistance);
  }

  fillSitesFallback(count);
}

function generateSpiralSites(count) {
  const bounds = getBounds();
  const centerX = bounds.x + bounds.w * 0.5;
  const centerY = bounds.y + bounds.h * 0.5;
  const maxRadius = Math.min(bounds.w, bounds.h) * 0.43;
  const turns = 4 + P.bandStrength * 7;
  const jitter = P.siteJitter * maxRadius * 0.12;

  let attempts = 0;
  let i = 0;
  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const t = i / Math.max(1, count - 1);
    const angle = t * TWO_PI * turns;
    const radius = Math.sqrt(t) * maxRadius;
    const x = centerX + cos(angle) * radius + random(-jitter, jitter);
    const y = centerY + sin(angle) * radius + random(-jitter, jitter);
    addSiteIfFarEnough(x, y, P.minSiteDistance);
    i += 1;
    if (i >= count) {
      i = 0;
    }
  }
}

function generateRingSites(count) {
  const bounds = getBounds();
  const centerX = bounds.x + bounds.w * 0.5;
  const centerY = bounds.y + bounds.h * 0.5;
  const ringCount = 3 + Math.floor(P.bandStrength * 5);
  const jitter = P.siteJitter * Math.min(bounds.w, bounds.h) * 0.1;
  const maxRadius = Math.min(bounds.w, bounds.h) * 0.42;

  let attempts = 0;
  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const ringIndex = Math.floor(random(ringCount));
    const ringT = (ringIndex + 1) / ringCount;
    const radius = ringT * maxRadius;
    const angle = random(TWO_PI);
    addSiteIfFarEnough(
      centerX + cos(angle) * radius + random(-jitter, jitter),
      centerY + sin(angle) * radius + random(-jitter, jitter),
      P.minSiteDistance
    );
  }
}

function generateCenterDenseSites(count) {
  const bounds = getBounds();
  const centerX = bounds.x + bounds.w * 0.5;
  const centerY = bounds.y + bounds.h * 0.5;
  const maxRadius = Math.min(bounds.w, bounds.h) * 0.46;

  let attempts = 0;
  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const angle = random(TWO_PI);
    const radius = Math.pow(random(), 1.9) * maxRadius;
    addSiteIfFarEnough(
      centerX + cos(angle) * radius,
      centerY + sin(angle) * radius,
      P.minSiteDistance
    );
  }
}

function generateEdgeDenseSites(count) {
  const bounds = getBounds();
  const centerX = bounds.x + bounds.w * 0.5;
  const centerY = bounds.y + bounds.h * 0.5;
  const maxRadius = Math.min(bounds.w, bounds.h) * 0.47;

  let attempts = 0;
  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const angle = random(TWO_PI);
    const radius = Math.pow(random(), 0.45) * maxRadius;
    addSiteIfFarEnough(
      centerX + cos(angle) * radius,
      centerY + sin(angle) * radius,
      P.minSiteDistance
    );
  }
}

function generateDiagonalBandSites(count) {
  const bounds = getBounds();
  let attempts = 0;

  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const t = random();
    const baseX = lerp(bounds.x, bounds.x + bounds.w, t);
    const baseY = lerp(bounds.y, bounds.y + bounds.h, t);
    const spread = lerp(Math.min(bounds.w, bounds.h) * 0.35, Math.min(bounds.w, bounds.h) * 0.05, P.bandStrength);
    const x = baseX + randomGaussian() * spread * P.siteJitter;
    const y = baseY + randomGaussian() * spread * P.siteJitter;
    addSiteIfFarEnough(x, y, P.minSiteDistance);
  }
}

function generateVerticalBandSites(count) {
  const bounds = getBounds();
  const bandCount = 2 + Math.floor(P.bandStrength * 5);
  const bandGap = bounds.w / bandCount;
  let attempts = 0;

  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    const bandIndex = Math.floor(random(bandCount));
    const xBase = map(bandIndex + 0.5, 0, bandCount, bounds.x, bounds.x + bounds.w);
    const x = xBase + randomGaussian() * bandGap * 0.18 * P.siteJitter;
    const y = random(bounds.y, bounds.y + bounds.h);
    addSiteIfFarEnough(x, y, P.minSiteDistance);
  }
}

function fillSitesFallback(count) {
  const bounds = getBounds();
  let attempts = 0;

  while (scene.sites.length < count && attempts < MAX_SITE_ATTEMPTS) {
    attempts += 1;
    addSiteIfFarEnough(
      random(bounds.x, bounds.x + bounds.w),
      random(bounds.y, bounds.y + bounds.h),
      P.minSiteDistance
    );
  }
}

function generateVoronoi() {
  const bounds = getBounds();
  const bbox = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];

  scene.cells = [];

  for (let i = 0; i < scene.sites.length; i += 1) {
    let poly = bbox.map((point) => ({ x: point.x, y: point.y }));
    const siteA = scene.sites[i];

    for (let j = 0; j < scene.sites.length; j += 1) {
      if (i === j) {
        continue;
      }

      const siteB = scene.sites[j];
      const dx = siteB.x - siteA.x;
      const dy = siteB.y - siteA.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < 0.000001) {
        continue;
      }

      const mid = {
        x: (siteA.x + siteB.x) * 0.5,
        y: (siteA.y + siteB.y) * 0.5,
      };

      const a = dx;
      const b = dy;
      const c = -(a * mid.x + b * mid.y);
      const keepPositive = a * siteA.x + b * siteA.y + c >= 0;
      poly = clipPolyWithHalfPlane(poly, a, b, c, keepPositive);

      if (!poly || poly.length < 3) {
        break;
      }
    }

    if (poly && poly.length >= 3) {
      scene.cells.push({
        site: siteA,
        poly,
        organicPoly: poly,
        spiralPts: [],
      });
    }
  }
}

function getOrganicCellPoly(basePoly, cellIndex) {
  if (!basePoly || basePoly.length < 3) {
    return [];
  }

  let poly = insetPolygon(basePoly, P.cellPadding);
  const iterations = constrain(Math.floor(P.roundIterations), 0, MAX_ROUND_ITERATIONS);

  for (let i = 0; i < iterations; i += 1) {
    poly = chaikinClosed(poly, P.roundRatio);
  }

  if (P.boundaryWobble > 0) {
    poly = wobblePolygon(poly, P.boundaryWobble, P.boundaryWobbleScale, cellIndex);
  }

  return poly;
}

function buildOrganicCellSpiral(poly, cellIndex, center, cellRadius) {
  if (!poly || poly.length < 3 || cellRadius <= 0) {
    return [];
  }

  let turns = cellRadius / Math.max(0.0001, P.spiralGap);
  turns = constrain(turns, P.minTurns, P.maxTurns);

  const approxLength = TWO_PI * cellRadius * turns;
  let pointCount = Math.ceil(approxLength / Math.max(0.0001, P.pointSpacing));
  pointCount = constrain(pointCount, 24, MAX_POINTS_PER_SPIRAL);

  const noiseStrength = Math.max(cellRadius * P.noiseRelative, P.minNoiseMM);
  const pts = [];

  for (let k = 0; k < pointCount; k += 1) {
    const t = k / Math.max(1, pointCount - 1);
    const theta = t * TWO_PI * turns;
    const angle = theta * P.spiralFreq;
    const dir = { x: cos(angle), y: sin(angle) };
    const maxRadius = rayPolygonDistance(center, dir, poly);

    if (maxRadius <= 0) {
      continue;
    }

    const baseRadius = t * maxRadius * P.spiralMargin;
    let x = center.x + dir.x * baseRadius;
    let y = center.y + dir.y * baseRadius;

    const localX = (x - center.x) / cellRadius;
    const localY = (y - center.y) / cellRadius;

    const nx = map(
      noise(localX * P.localNoiseScale + cellIndex * 13.17, localY * P.localNoiseScale + 1.31, P.seed * 0.017),
      0,
      1,
      -1,
      1
    );
    const ny = map(
      noise(localX * P.localNoiseScale + 91.7, localY * P.localNoiseScale + cellIndex * 17.23, P.seed * 0.021),
      0,
      1,
      -1,
      1
    );

    const radialX = dir.x * nx;
    const radialY = dir.y * nx;
    const mixedX = lerp(radialX, nx, P.noiseBalance);
    const mixedY = lerp(radialY, ny, P.noiseBalance);

    x += mixedX * noiseStrength;
    y += mixedY * noiseStrength;

    pts.push(clampPointToPolygonFromCentroid({ x, y }, center, poly, P.spiralMargin));
  }

  return smoothOpenPolyline(pts, P.spiralSmoothIterations);
}

function smoothOpenPolyline(points, iterations) {
  let out = points.slice();
  const count = constrain(Math.floor(iterations), 0, MAX_SMOOTH_ITERATIONS);

  for (let i = 0; i < count; i += 1) {
    out = chaikinOpen(out);
  }

  return out;
}

function chaikinClosed(poly, ratio = 0.25) {
  if (!poly || poly.length < 3) {
    return poly;
  }

  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    out.push({ x: lerp(a.x, b.x, ratio), y: lerp(a.y, b.y, ratio) });
    out.push({ x: lerp(a.x, b.x, 1 - ratio), y: lerp(a.y, b.y, 1 - ratio) });
  }

  return out;
}

function chaikinOpen(points, ratio = 0.25) {
  if (!points || points.length < 3) {
    return points || [];
  }

  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    out.push({ x: lerp(a.x, b.x, ratio), y: lerp(a.y, b.y, ratio) });
    out.push({ x: lerp(a.x, b.x, 1 - ratio), y: lerp(a.y, b.y, 1 - ratio) });
  }
  out.push(points[points.length - 1]);
  return removeDuplicatePoints(out);
}

function wobblePolygon(poly, amount, scale, cellIndex) {
  const center = centroid(poly);

  return poly.map((point, index) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const n = map(
      noise(point.x * scale + cellIndex * 3.7, point.y * scale + index * 0.13, P.seed * 0.01),
      0,
      1,
      -1,
      1
    );

    return {
      x: point.x + nx * n * amount,
      y: point.y + ny * n * amount,
    };
  });
}

function clipPolyWithHalfPlane(poly, a, b, c, keepPositive) {
  const out = [];
  if (!poly || poly.length === 0) {
    return out;
  }

  const side = (point) => a * point.x + b * point.y + c;
  const isInside = (s) => (keepPositive ? s >= -1e-9 : s <= 1e-9);

  for (let i = 0; i < poly.length; i += 1) {
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const sc = side(curr);
    const sn = side(next);
    const currIn = isInside(sc);
    const nextIn = isInside(sn);

    if (currIn && nextIn) {
      out.push(next);
    } else if (currIn && !nextIn) {
      out.push(intersectLineSegWithLine(curr, next, a, b, c));
    } else if (!currIn && nextIn) {
      out.push(intersectLineSegWithLine(curr, next, a, b, c));
      out.push(next);
    }
  }

  return removeDuplicatePoints(out);
}

function intersectLineSegWithLine(p, q, a, b, c) {
  const sideP = a * p.x + b * p.y + c;
  const sideQ = a * q.x + b * q.y + c;
  const denom = sideP - sideQ;
  const t = Math.abs(denom) < 1e-9 ? 0.5 : sideP / denom;

  return {
    x: p.x + t * (q.x - p.x),
    y: p.y + t * (q.y - p.y),
  };
}

function rayPolygonDistance(origin, dir, poly) {
  let closest = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const hit = raySegmentIntersection(origin, dir, a, b);

    if (hit && hit.t > 0 && hit.t < closest) {
      closest = hit.t;
    }
  }

  return closest === Infinity ? 0 : closest;
}

function raySegmentIntersection(origin, dir, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = a.x - origin.x;
  const wy = a.y - origin.y;
  const denom = cross(dir.x, dir.y, vx, vy);

  if (Math.abs(denom) < 1e-9) {
    return null;
  }

  const t = cross(wx, wy, vx, vy) / denom;
  const u = cross(wx, wy, dir.x, dir.y) / denom;

  if (t >= 0 && u >= 0 && u <= 1) {
    return { t, u };
  }

  return null;
}

function clampPointToPolygonFromCentroid(point, center, poly, margin = 0.95) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) {
    return { x: center.x, y: center.y };
  }

  const dir = { x: dx / len, y: dy / len };
  const maxRadius = rayPolygonDistance(center, dir, poly);
  if (maxRadius <= 0) {
    return { x: center.x, y: center.y };
  }

  const safeRadius = Math.min(len, maxRadius * margin);
  return {
    x: center.x + dir.x * safeRadius,
    y: center.y + dir.y * safeRadius,
  };
}

function pointInPolygon(point, poly) {
  if (!poly || poly.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function insetPolygon(poly, amount) {
  if (!poly || poly.length < 3) {
    return [];
  }

  const center = centroid(poly);
  return poly.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) {
      return { x: point.x, y: point.y };
    }

    const scale = Math.max(0, (len - amount) / len);
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale,
    };
  });
}

function centroid(poly) {
  if (!poly || poly.length === 0) {
    return { x: P.canvasWMM * 0.5, y: P.canvasHMM * 0.5 };
  }

  let x = 0;
  let y = 0;
  for (const point of poly) {
    x += point.x;
    y += point.y;
  }

  return {
    x: x / poly.length,
    y: y / poly.length,
  };
}

function averageRadiusFromCentroid(center, poly) {
  if (!poly || poly.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const point of poly) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    sum += Math.sqrt(dx * dx + dy * dy);
  }

  return sum / poly.length;
}

function removeDuplicatePoints(poly) {
  if (!poly || poly.length < 2) {
    return poly || [];
  }

  const out = [];
  const eps = 0.0001;

  for (const point of poly) {
    if (out.length === 0) {
      out.push(point);
      continue;
    }

    const last = out[out.length - 1];
    if (distSq(point.x, point.y, last.x, last.y) > eps) {
      out.push(point);
    }
  }

  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (distSq(first.x, first.y, last.x, last.y) <= eps) {
      out.pop();
    }
  }

  return out;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function distSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function normalizeParams() {
  if (P.maxTurns < P.minTurns) {
    P.maxTurns = P.minTurns;
    pane.refresh();
  }
}

function exportPNG() {
  saveCanvas(P.pngFilename, "png");
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

  if (P.svgIncludeBackground) {
    svg.push(
      `<rect x="0" y="0" width="${ExportUtils.fmt(P.canvasWMM)}" height="${ExportUtils.fmt(
        P.canvasHMM
      )}" fill="${ExportUtils.escapeXML(P.paperColor)}"/>`
    );
  }

  svg.push(
    `<g fill="none" stroke="${ExportUtils.escapeXML(P.strokeColor)}" stroke-width="${ExportUtils.fmt(
      Math.max(0.0001, P.strokeWeightMM)
    )}" stroke-linecap="round" stroke-linejoin="round">`
  );

  for (const cellIndex of scene.painted) {
    const cell = scene.cells[cellIndex];
    if (!cell || !cell.spiralPts || cell.spiralPts.length < 2) {
      continue;
    }

    svg.push(`<path d="${buildPathD(cell.spiralPts)}"/>`);
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
