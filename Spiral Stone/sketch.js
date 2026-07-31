const MAX_POINTS = 24000;

const MODE_OPTIONS = {
  "Norm Spiral": "norm",
  "Split Spiral": "split",
};

const SHAPE_OPTIONS = {
  Rectangle: "rectangle",
  Circle: "circle",
};

let pane;
let cnv;
let redrawTimer = null;

const scene = {
  points: [],
  seedOffsets: { rand1: 0, rand2: 0 },
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
  strokeWeightMM: 0.35,
  seed: 12,
  mode: "norm",
  shape: "rectangle",
  clipToShape: true,
  showGuide: false,
  shapeInsetMM: 10,
  spiralTurns: 6,
  thetaStepDeg: 0.04,
  frequency: 1,
  widthScale: 0.06,
  heightScale: 0.1,
  noiseStrengthXMM: 18,
  noiseStrengthYMM: 18,
  noiseScaleX: 0.015,
  noiseScaleY: 0.015,
  radialFlow: 1,
  angularFlow: 14,
  noiseOctaves: 4,
  noiseFalloff: 0.4,
  outerEdgeTightness: 0.35,
  splitFrequency: 5,
  splitThetaStepDeg: 0.05,
  splitWidthScale: 0.07,
  splitHeightScale: 0.09,
  splitCutMM: 60,
  splitTopMultiplier: 1,
  splitMidMultiplier: 0.85,
  splitBottomMultiplier: 1,
  splitTopBias: -0.2,
  splitBottomBias: 0.2,
  splitUseRandomBias: true,
  smoothIterations: 0,
  svgIncludeBackground: true,
  svgFilename: "Spiral-Stone.svg",
  pngFilename: "Spiral-Stone",
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
  drawSpiralStone();
  pop();
}

function windowResized() {
  updateCanvasDisplaySize();
}

function keyPressed() {
  if (key === "r" || key === "R") {
    regenerate();
    return;
  }

  if (key === "s" || key === "S") {
    exportPNG();
  }
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Spiral Stone",
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
      regenerate();
    });
  canvasFolder
    .addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      regenerate();
    });
  canvasFolder
    .addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      regenerate();
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
    .on("change", regenerate);

  const stoneFolder = pane.addFolder({ title: "Stone" });
  stoneFolder.addInput(P, "mode", { options: MODE_OPTIONS, label: "Mode" }).on("change", regenerate);
  stoneFolder.addInput(P, "shape", { options: SHAPE_OPTIONS, label: "Shape" }).on("change", regenerate);
  stoneFolder.addInput(P, "clipToShape", { label: "Clip" }).on("change", regenerate);
  stoneFolder.addInput(P, "showGuide", { label: "Guide" }).on("change", redrawScene);
  stoneFolder
    .addInput(P, "shapeInsetMM", { min: 0, max: 80, step: 0.5, label: "Inset" })
    .on("change", regenerate);
  stoneFolder
    .addInput(P, "seed", { min: 1, max: 999999, step: 1, label: "Seed" })
    .on("change", regenerate);

  const normFolder = pane.addFolder({ title: "Norm Spiral" });
  normFolder
    .addInput(P, "spiralTurns", { min: 0.5, max: 16, step: 0.25, label: "Turns" })
    .on("change", regenerate);
  normFolder
    .addInput(P, "thetaStepDeg", { min: 0.01, max: 1, step: 0.01, label: "Theta Step" })
    .on("change", regenerate);
  normFolder
    .addInput(P, "frequency", { min: 1, max: 40, step: 0.25, label: "Frequency" })
    .on("change", regenerate);
  normFolder
    .addInput(P, "widthScale", { min: 0.005, max: 0.2, step: 0.001, label: "Width W" })
    .on("change", regenerate);
  normFolder
    .addInput(P, "heightScale", { min: 0.005, max: 0.2, step: 0.001, label: "Height H" })
    .on("change", regenerate);

  const noiseFolder = pane.addFolder({ title: "Noise" });
  noiseFolder
    .addInput(P, "noiseStrengthXMM", { min: 0, max: 120, step: 0.5, label: "Strength X" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "noiseStrengthYMM", { min: 0, max: 120, step: 0.5, label: "Strength Y" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "noiseScaleX", { min: 0.001, max: 0.08, step: 0.001, label: "Scale X" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "noiseScaleY", { min: 0.001, max: 0.08, step: 0.001, label: "Scale Y" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "radialFlow", { min: 0.2, max: 3, step: 0.05, label: "Radial Flow" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "angularFlow", { min: 1, max: 40, step: 0.5, label: "Angular Flow" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "noiseOctaves", { min: 1, max: 8, step: 1, label: "Octaves" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "noiseFalloff", { min: 0, max: 0.95, step: 0.01, label: "Falloff" })
    .on("change", regenerate);
  noiseFolder
    .addInput(P, "outerEdgeTightness", { min: 0, max: 1, step: 0.01, label: "Outer Tight" })
    .on("change", regenerate);

  const splitFolder = pane.addFolder({ title: "Split Spiral" });
  splitFolder
    .addInput(P, "splitFrequency", { min: 1, max: 30, step: 0.25, label: "Frequency" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitThetaStepDeg", { min: 0.01, max: 1, step: 0.01, label: "Theta Step" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitWidthScale", { min: 0.005, max: 0.2, step: 0.001, label: "Width W" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitHeightScale", { min: 0.005, max: 0.2, step: 0.001, label: "Height H" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitCutMM", { min: 0, max: 160, step: 1, label: "Cut" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitTopMultiplier", { min: 0, max: 2, step: 0.05, label: "Top Mult" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitMidMultiplier", { min: 0, max: 2, step: 0.05, label: "Mid Mult" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitBottomMultiplier", { min: 0, max: 2, step: 0.05, label: "Bot Mult" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitTopBias", { min: -1.5, max: 1.5, step: 0.01, label: "Top Bias" })
    .on("change", regenerate);
  splitFolder
    .addInput(P, "splitBottomBias", { min: -1.5, max: 1.5, step: 0.01, label: "Bot Bias" })
    .on("change", regenerate);
  splitFolder.addInput(P, "splitUseRandomBias", { label: "Rnd Bias" }).on("change", regenerate);

  const styleFolder = pane.addFolder({ title: "Style / Export" });
  styleFolder.addInput(P, "bg", { label: "BG" }).on("change", redrawScene);
  styleFolder.addInput(P, "paperColor", { label: "Paper" }).on("change", redrawScene);
  styleFolder.addInput(P, "strokeColor", { label: "Stroke" }).on("change", redrawScene);
  styleFolder
    .addInput(P, "strokeWeightMM", { min: 0.05, max: 4, step: 0.01, label: "Stroke mm" })
    .on("change", redrawScene);
  styleFolder
    .addInput(P, "smoothIterations", { min: 0, max: 4, step: 1, label: "Smooth" })
    .on("change", regenerate);
  styleFolder.addInput(P, "svgIncludeBackground", { label: "SVG BG" });
  styleFolder.addInput(P, "svgFilename", { label: "SVG Name" });
  styleFolder.addInput(P, "pngFilename", { label: "PNG Name" });
}

function hookUI() {
  document.getElementById("regenBtn").addEventListener("click", randomizeSeed);
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
  }, 20);
}

function redrawScene() {
  redraw();
}

function randomizeSeed() {
  P.seed = Math.floor(random(1, 1000000));
  pane.refresh();
  regenerate();
}

function regenerate() {
  normalizeParams();
  randomSeed(P.seed);
  noiseSeed(P.seed);
  scene.seedOffsets = {
    rand1: random(-0.5, 0.5),
    rand2: random(-0.5, 0.5),
  };
  scene.points = P.mode === "split" ? buildSplitSpiralPoints() : buildNormSpiralPoints();
  redrawScene();
}

function drawPaper() {
  noStroke();
  fill(P.paperColor);
  rect(0, 0, P.canvasWMM, P.canvasHMM);
}

function drawSpiralStone() {
  const center = getCenterPoint();

  if (P.showGuide) {
    drawShapeGuide(center);
  }

  if (!scene.points || scene.points.length < 2) {
    return;
  }

  noFill();
  stroke(P.strokeColor);
  strokeWeight(P.strokeWeightMM);
  strokeCap(ROUND);
  strokeJoin(ROUND);

  beginShape();
  if (P.mode === "split") {
    for (const point of scene.points) {
      vertex(point.x, point.y);
    }
  } else {
    const first = scene.points[0];
    const last = scene.points[scene.points.length - 1];
    curveVertex(first.x, first.y);
    for (const point of scene.points) {
      curveVertex(point.x, point.y);
    }
    curveVertex(last.x, last.y);
  }
  endShape();
}

function buildNormSpiralPoints() {
  noiseDetail(P.noiseOctaves, P.noiseFalloff);
  const points = [];
  const center = getCenterPoint();
  const thetaMax = 360 * P.spiralTurns;

  for (let theta = 0; theta < thetaMax && points.length < MAX_POINTS; theta += P.thetaStepDeg) {
    const x = P.widthScale * theta * cos(theta * P.frequency);
    const y = P.heightScale * theta * sin(theta * P.frequency);
    const offset = sampleNormOffset(x, y);
    points.push(
      applyShapeConstraint(
        {
          x: center.x + x + offset.x,
          y: center.y + y + offset.y,
        },
        center
      )
    );
  }

  return smoothPoints(removeDuplicatePoints(points), P.smoothIterations);
}

function buildSplitSpiralPoints() {
  noiseDetail(P.noiseOctaves, P.noiseFalloff);
  const points = [];
  const center = getCenterPoint();
  const thetaMax = 360 * P.spiralTurns;
  const rand1 = P.splitUseRandomBias ? scene.seedOffsets.rand1 : 0;
  const rand2 = P.splitUseRandomBias ? scene.seedOffsets.rand2 : 0;

  for (let theta = 0; theta < thetaMax && points.length < MAX_POINTS; theta += P.splitThetaStepDeg) {
    const x = P.splitWidthScale * theta * cos(theta * P.splitFrequency);
    const y = P.splitHeightScale * theta * sin(theta * P.splitFrequency);
    const offset = sampleSplitOffset(x, y, rand1, rand2);
    points.push(
      applyShapeConstraint(
        {
          x: center.x + x + offset.x,
          y: center.y + y + offset.y,
        },
        center
      )
    );
  }

  return smoothPoints(removeDuplicatePoints(points), P.smoothIterations);
}

function getCenterPoint() {
  return {
    x: P.canvasWMM * 0.5,
    y: P.canvasHMM * 0.5,
  };
}

function getShapeBounds() {
  return {
    halfW: Math.max(1, (P.canvasWMM - P.marginMM * 2 - P.shapeInsetMM * 2) * 0.5),
    halfH: Math.max(1, (P.canvasHMM - P.marginMM * 2 - P.shapeInsetMM * 2) * 0.5),
  };
}

function applyShapeConstraint(point, center) {
  if (!P.clipToShape) {
    return point;
  }

  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const bounds = getShapeBounds();

  if (P.shape === "circle") {
    const radius = Math.min(bounds.halfW, bounds.halfH);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= radius || len === 0) {
      return point;
    }
    const scale = radius / len;
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale,
    };
  }

  return {
    x: constrain(point.x, center.x - bounds.halfW, center.x + bounds.halfW),
    y: constrain(point.y, center.y - bounds.halfH, center.y + bounds.halfH),
  };
}

function sampleNormOffset(localX, localY) {
  const xScale1 = P.noiseScaleX * Math.max(0.5, P.radialFlow);
  const yScale1 = P.noiseScaleY * Math.max(0.5, P.radialFlow);
  const xScale2 = P.noiseScaleX * 2;
  const yScale2 = P.noiseScaleY * Math.max(2, P.angularFlow / 5);

  return {
    x: P.noiseStrengthXMM * noise(localX * xScale1, localY * yScale1 + 1),
    y: P.noiseStrengthYMM * noise(localX * xScale2, localY * yScale2 + 2),
  };
}

function sampleSplitOffset(localX, localY, rand1, rand2) {
  const topScaleX = P.noiseScaleX;
  const topScaleY = P.noiseScaleY;
  const midScaleX = P.noiseScaleX * 2;
  const midScaleY = P.noiseScaleY * 2;
  const midScaleX2 = P.noiseScaleX * 3;
  const midScaleY2 = P.noiseScaleY * 3;
  const bottomScaleX = P.noiseScaleX;
  const bottomScaleY = P.noiseScaleY * 1.5;

  if (localY < -P.splitCutMM) {
    return {
      x: P.noiseStrengthXMM * P.splitTopMultiplier * map(noise(localX * topScaleX, localY * topScaleY) + rand2 + P.splitTopBias, 0, 1, 0, 1),
      y: P.noiseStrengthYMM * P.splitTopMultiplier * map(noise(localX * topScaleX, localY * topScaleY + 1000), 0, 1, 0, 1),
    };
  }

  if (localY < P.splitCutMM) {
    return {
      x: P.noiseStrengthXMM * P.splitMidMultiplier * map(noise(localX * midScaleX, localY * midScaleY), 0, 1, 0, 1),
      y: P.noiseStrengthYMM * P.splitMidMultiplier * map(noise(localX * midScaleX2, localY * midScaleY2 + 1000), 0, 1, 0, 1),
    };
  }

  return {
    x: P.noiseStrengthXMM * P.splitBottomMultiplier * map(noise(localX * bottomScaleX, localY * bottomScaleY) + rand1 + P.splitBottomBias, 0, 1, 0, 1),
    y: P.noiseStrengthYMM * P.splitBottomMultiplier * map(noise(localX * bottomScaleX, localY * bottomScaleY + 1000), 0, 1, 0, 1),
  };
}

function drawShapeGuide(center) {
  const bounds = getShapeBounds();
  noFill();
  stroke("#7aa2ff");
  strokeWeight(0.18);

  if (P.shape === "circle") {
    const radius = Math.min(bounds.halfW, bounds.halfH);
    circle(center.x, center.y, radius * 2);
    return;
  }

  rectMode(CENTER);
  rect(center.x, center.y, bounds.halfW * 2, bounds.halfH * 2);
  rectMode(CORNER);
}

function smoothPoints(points, iterations) {
  let out = points.slice();
  const count = constrain(Math.floor(iterations), 0, 4);

  for (let i = 0; i < count; i += 1) {
    out = chaikinOpen(out);
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

function removeDuplicatePoints(points) {
  if (!points || points.length < 2) {
    return points || [];
  }

  const out = [];
  const eps = 0.0001;

  for (const point of points) {
    if (out.length === 0) {
      out.push(point);
      continue;
    }

    const last = out[out.length - 1];
    if (distSq(point.x, point.y, last.x, last.y) > eps) {
      out.push(point);
    }
  }

  return out;
}

function distSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function smoothstep(edge0, edge1, x) {
  const t = constrain((x - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeParams() {
  P.spiralTurns = constrain(P.spiralTurns, 0.5, 16);
  P.thetaStepDeg = constrain(P.thetaStepDeg, 0.01, 1);
  P.frequency = constrain(P.frequency, 1, 40);
  P.widthScale = constrain(P.widthScale, 0.005, 0.2);
  P.heightScale = constrain(P.heightScale, 0.005, 0.2);
  P.noiseStrengthXMM = constrain(P.noiseStrengthXMM, 0, 120);
  P.noiseStrengthYMM = constrain(P.noiseStrengthYMM, 0, 120);
  P.noiseScaleX = constrain(P.noiseScaleX, 0.001, 0.08);
  P.noiseScaleY = constrain(P.noiseScaleY, 0.001, 0.08);
  P.radialFlow = constrain(P.radialFlow, 0.2, 3);
  P.angularFlow = constrain(P.angularFlow, 1, 40);
  P.noiseOctaves = constrain(Math.floor(P.noiseOctaves), 1, 8);
  P.noiseFalloff = constrain(P.noiseFalloff, 0, 0.95);
  P.outerEdgeTightness = constrain(P.outerEdgeTightness, 0, 1);
  P.splitFrequency = constrain(P.splitFrequency, 1, 30);
  P.splitThetaStepDeg = constrain(P.splitThetaStepDeg, 0.01, 1);
  P.splitWidthScale = constrain(P.splitWidthScale, 0.005, 0.2);
  P.splitHeightScale = constrain(P.splitHeightScale, 0.005, 0.2);
  P.splitCutMM = constrain(P.splitCutMM, 0, 160);
  P.splitTopMultiplier = constrain(P.splitTopMultiplier, 0, 2);
  P.splitMidMultiplier = constrain(P.splitMidMultiplier, 0, 2);
  P.splitBottomMultiplier = constrain(P.splitBottomMultiplier, 0, 2);
  P.smoothIterations = constrain(Math.floor(P.smoothIterations), 0, 4);
  pane.refresh();
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

  if (scene.points.length >= 2) {
    svg.push(
      `<path d="${buildPathD(scene.points)}" fill="none" stroke="${ExportUtils.escapeXML(
        P.strokeColor
      )}" stroke-width="${ExportUtils.fmt(Math.max(0.0001, P.strokeWeightMM))}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

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
