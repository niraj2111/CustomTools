let pane;
let cnv;
let img = null;
let imgPixelsReady = false;
let layerStrokeBlades = [];
let palettePresetBlade = null;

const PALETTE_PRESETS = [
  {
    key: "custom",
    name: "Custom",
    colors: [],
  },
  {
    key: "graphite",
    name: "Graphite",
    colors: ["#1c1c1c", "#6a6a6a", "#b8b8b8"],
  },
  {
    key: "charcoal",
    name: "Charcoal",
    colors: ["#0f0f10", "#4d5258", "#c7ccd1"],
  },
  {
    key: "earth",
    name: "Earth Ink",
    colors: ["#2f2218", "#8b5e3c", "#d6bf95"],
  },
  {
    key: "terracotta",
    name: "Terracotta",
    colors: ["#40211a", "#9d5336", "#e0ae88"],
  },
  {
    key: "cyanotype",
    name: "Cyanotype",
    colors: ["#10253f", "#2e5b89", "#8fb7d8"],
  },
  {
    key: "marine",
    name: "Marine",
    colors: ["#0e2030", "#2e6a7d", "#b4d7d5"],
  },
  {
    key: "forest",
    name: "Forest Print",
    colors: ["#11261c", "#355d45", "#9bb697"],
  },
  {
    key: "olive",
    name: "Olive Grove",
    colors: ["#202315", "#68703d", "#c5bf8a"],
  },
  {
    key: "sunset",
    name: "Sunset Ink",
    colors: ["#41202c", "#b15c4a", "#f0ba92"],
  },
  {
    key: "orchid",
    name: "Orchid",
    colors: ["#2d1830", "#8b4d7a", "#ddb8ca"],
  },
  {
    key: "parrot",
    name: "Parrot",
    colors: ["#183153", "#d66a2d", "#f0d95c"],
  },
  {
    key: "lagoon",
    name: "Lagoon",
    colors: ["#1c2f52", "#1f8a8a", "#d9c45b"],
  },
  {
    key: "studio",
    name: "Studio",
    colors: ["#26233a", "#c05746", "#f0c96a"],
  },
  {
    key: "candy",
    name: "Candy Pop",
    colors: ["#5a2a57", "#1b8fa3", "#f08a5d"],
  },
  {
    key: "market",
    name: "Market Poster",
    colors: ["#1f3a5f", "#cf4f2e", "#88a84d"],
  },
  {
    key: "heatwave",
    name: "Heatwave",
    colors: ["#4b1f2a", "#e06c3c", "#f2b84b"],
  },
  {
    key: "festival",
    name: "Festival",
    colors: ["#223049", "#9c4dcc", "#f0a83a"],
  },
  {
    key: "signal",
    name: "Signal",
    colors: ["#203349", "#c94c41", "#4f9a8b"],
  },
];

const scene = {
  imageMapping: null,
  layers: [],
};

const P = {
  canvasWMM: 210,
  canvasHMM: 297,
  paperPreset: "A4 Portrait",
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 15,
  bg: "#eef2f6",
  paperColor: "#ffffff",
  showPaperBounds: true,
  multiplyMode: true,
  showImage: false,
  imageOpacity: 0.22,
  fitMode: "cover",
  imageGamma: 1,
  invertBrightness: false,
  sampleGridPx: 1,
  traceStepMM: 0.8,
  mode: "lineHatch",
  squiggleOrientation: "horizontal",
  squiggleFrequencyMM: 2,
  squiggleAmplitudeMM: 2.0,
  squigglePhaseDeg: 0,
  squiggleClampToSpacing: true,
  randomizeAnglesOnRebuild: false,
  useLengthCleanup: true,
  showImageBounds: false,
  palettePreset: "graphite",
  svgIncludeBackground: true,
  svgFilename: "Image-Processor.svg",
  layers: [
    makeLayer({
      label: "Dark",
      bMin: 0,
      bMax: 110,
      spacingMM: 1.5,
      stroke: "#1c1c1c",
      weightMM: 0.5,
      angleDeg: 60,
      arcCxN: 0.5,
      arcCyN: 1,
    }),
    makeLayer({
      label: "Mid",
      bMin: 85,
      bMax: 185,
      spacingMM: 2.0,
      stroke: "#6a6a6a",
      weightMM: 0.5,
      angleDeg: 0,
      arcCxN: 0,
      arcCyN: 1,
    }),
    makeLayer({
      label: "Light",
      bMin: 160,
      bMax: 256,
      spacingMM: 3.0,
      stroke: "#b8b8b8",
      weightMM: 0.5,
      angleDeg: -55,
      arcCxN: 1,
      arcCyN: 1,
    }),
  ],
};

const modeVisibilityBlades = {
  squiggle: [],
  lineHatch: [],
  arcHatch: [],
};

function makeLayer(overrides = {}) {
  return {
    enabled: true,
    label: "Layer",
    bMin: 0,
    bMax: 255,
    spacingMM: 4,
    stroke: "#000000",
    weightMM: 0.3,
    angleDeg: 45,
    minLenMM: 0,
    maxLenMM: 9999,
    arcCxN: 0.5,
    arcCyN: 0.5,
    angleStartDeg: 0,
    angleEndDeg: 360,
    ...overrides,
  };
}

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
  rebuildScene();
}

function draw() {
  background(P.bg);

  push();
  scale(PaperUtils.getPxPerMM(P));
  drawPaper();
  drawImagePreview();
  drawSceneLayers();
  pop();
}

function windowResized() {
  updateCanvasDisplaySize();
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Image Processor",
  });

  const documentFolder = pane.addFolder({ title: "Document" });
  documentFolder
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
      rebuildScene();
    });
  documentFolder
    .addInput(P, "canvasWMM", { min: 20, max: 2000, step: 1, label: "W mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      rebuildScene();
    });
  documentFolder
    .addInput(P, "canvasHMM", { min: 20, max: 2000, step: 1, label: "H mm" })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      pane.refresh();
      syncCanvasSize();
      rebuildScene();
    });
  documentFolder.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" }).on("change", () => {
    syncCanvasSize();
    redraw();
  });
  documentFolder
    .addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" })
    .on("change", updateCanvasDisplaySize);
  documentFolder.addInput(P, "fitToViewport", { label: "Fit View" }).on("change", updateCanvasDisplaySize);
  documentFolder
    .addInput(P, "marginMM", { min: 0, max: 80, step: 0.5, label: "Margin" })
    .on("change", rebuildScene);

  const imageFolder = pane.addFolder({ title: "Image" });
  imageFolder
    .addInput(P, "fitMode", {
      options: { contain: "contain", cover: "cover", stretch: "stretch" },
      label: "Fit",
    })
    .on("change", rebuildScene);
  imageFolder.addInput(P, "imageGamma", { min: 0.2, max: 3, step: 0.05, label: "Gamma" }).on("change", rebuildScene);
  imageFolder.addInput(P, "invertBrightness", { label: "Invert Bright" }).on("change", rebuildScene);
  imageFolder.addInput(P, "sampleGridPx", { min: 1, max: 32, step: 1, label: "Sample Grid" }).on("change", rebuildScene);
  imageFolder.addInput(P, "traceStepMM", { min: 0.2, max: 8, step: 0.1, label: "Trace Step" }).on("change", rebuildScene);
  imageFolder.addInput(P, "showImage", { label: "Show Image" }).on("change", redraw);
  imageFolder.addInput(P, "imageOpacity", { min: 0, max: 1, step: 0.01, label: "Image Opacity" }).on("change", redraw);
  imageFolder.addInput(P, "showImageBounds", { label: "Show Bounds" }).on("change", redraw);

  const paletteFolder = pane.addFolder({ title: "Palette" });
  palettePresetBlade = paletteFolder
    .addInput(P, "palettePreset", {
      options: PALETTE_PRESETS.reduce((acc, preset) => {
        acc[preset.name] = preset.key;
        return acc;
      }, {}),
      label: "Preset",
    })
    .on("change", (ev) => {
      applyPalettePreset(ev.value);
    });
  paletteFolder.addInput(P.layers[0], "stroke", { label: "Dark Tone" }).on("change", () => {
    handlePaletteToneChange(0);
  });
  paletteFolder.addInput(P.layers[1], "stroke", { label: "Mid Tone" }).on("change", () => {
    handlePaletteToneChange(1);
  });
  paletteFolder.addInput(P.layers[2], "stroke", { label: "Light Tone" }).on("change", () => {
    handlePaletteToneChange(2);
  });

  const modeFolder = pane.addFolder({ title: "Mode" });
  modeFolder
    .addInput(P, "mode", {
      options: {
        squiggle: "squiggle",
        lineHatch: "lineHatch",
        arcHatch: "arcHatch",
      },
      label: "Generator",
    })
    .on("change", () => {
      updateModeVisibility();
      rebuildScene();
    });

  modeVisibilityBlades.squiggle.push(
    modeFolder
      .addInput(P, "squiggleOrientation", {
        options: { horizontal: "horizontal", vertical: "vertical" },
        label: "Direction",
      })
      .on("change", rebuildScene)
  );
  modeVisibilityBlades.squiggle.push(
    modeFolder.addInput(P, "squiggleFrequencyMM", { min: 0.2, max: 40, step: 0.1, label: "Frequency" }).on("change", rebuildScene)
  );
  modeVisibilityBlades.squiggle.push(
    modeFolder.addInput(P, "squiggleAmplitudeMM", { min: 0, max: 20, step: 0.1, label: "Amplitude" }).on("change", rebuildScene)
  );
  modeVisibilityBlades.squiggle.push(
    modeFolder.addInput(P, "squigglePhaseDeg", { min: -180, max: 180, step: 1, label: "Phase" }).on("change", rebuildScene)
  );
  modeVisibilityBlades.squiggle.push(
    modeFolder.addInput(P, "squiggleClampToSpacing", { label: "Clamp Amp" }).on("change", rebuildScene)
  );

  modeVisibilityBlades.lineHatch.push(
    modeFolder.addInput(P, "useLengthCleanup", { label: "Cleanup" }).on("change", rebuildScene)
  );
  modeVisibilityBlades.lineHatch.push(
    modeFolder.addInput(P, "randomizeAnglesOnRebuild", { label: "Random Angles" }).on("change", () => {})
  );

  modeVisibilityBlades.arcHatch.push(
    modeFolder.addInput(P, "useLengthCleanup", { label: "Cleanup" }).on("change", rebuildScene)
  );

  const layersFolder = pane.addFolder({ title: "Layers" });
  layerStrokeBlades = [];
  P.layers.forEach((layer, index) => {
    const folder = layersFolder.addFolder({ title: `${index + 1}. ${layer.label}` });
    folder.addInput(layer, "enabled", { label: "Enabled" }).on("change", rebuildScene);
    folder.addInput(layer, "bMin", { min: 0, max: 255, step: 1, label: "Tone Min" }).on("change", rebuildScene);
    folder.addInput(layer, "bMax", { min: 1, max: 256, step: 1, label: "Tone Max" }).on("change", rebuildScene);
    folder.addInput(layer, "spacingMM", { min: 0.5, max: 30, step: 0.1, label: "Spacing" }).on("change", rebuildScene);
    const strokeBlade = folder.addInput(layer, "stroke", { label: "Stroke" }).on("change", () => {
      handlePaletteToneChange(index);
      rebuildScene();
    });
    layerStrokeBlades.push(strokeBlade);
    folder.addInput(layer, "weightMM", { min: 0.05, max: 3, step: 0.01, label: "Weight" }).on("change", rebuildScene);

    const lineBladeAngle = folder.addInput(layer, "angleDeg", { min: -180, max: 180, step: 1, label: "Angle" }).on("change", rebuildScene);
    const lineBladeMin = folder.addInput(layer, "minLenMM", { min: 0, max: 300, step: 0.5, label: "Min Len" }).on("change", rebuildScene);
    modeVisibilityBlades.lineHatch.push(lineBladeAngle, lineBladeMin);

    const arcBladeCx = folder.addInput(layer, "arcCxN", { min: 0, max: 1, step: 0.01, label: "Center X" }).on("change", rebuildScene);
    const arcBladeCy = folder.addInput(layer, "arcCyN", { min: 0, max: 1, step: 0.01, label: "Center Y" }).on("change", rebuildScene);
    const arcBladeStart = folder.addInput(layer, "angleStartDeg", { min: -360, max: 360, step: 1, label: "Start" }).on("change", rebuildScene);
    const arcBladeEnd = folder.addInput(layer, "angleEndDeg", { min: -360, max: 360, step: 1, label: "End" }).on("change", rebuildScene);
    const arcBladeMin = folder.addInput(layer, "minLenMM", { min: 0, max: 300, step: 0.5, label: "Min Len" }).on("change", rebuildScene);
    modeVisibilityBlades.arcHatch.push(arcBladeCx, arcBladeCy, arcBladeStart, arcBladeEnd, arcBladeMin);
  });

  const styleFolder = pane.addFolder({ title: "Style" });
  styleFolder.addInput(P, "bg", { label: "BG" }).on("change", redraw);
  styleFolder.addInput(P, "paperColor", { label: "Paper" }).on("change", redraw);
  styleFolder.addInput(P, "showPaperBounds", { label: "Paper Bounds" }).on("change", redraw);
  styleFolder.addInput(P, "multiplyMode", { label: "Multiply Layers" }).on("change", redraw);

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addInput(P, "svgIncludeBackground", { label: "SVG BG" });
  exportFolder.addInput(P, "svgFilename", { label: "Filename" });
  exportFolder.addButton({ title: "Reset Zoom" }).on("click", () => {
    P.previewScale = 1;
    P.fitToViewport = true;
    pane.refresh();
    updateCanvasDisplaySize();
  });

  updateModeVisibility();
}

function hookUI() {
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("clearBtn").addEventListener("click", () => {
    img = null;
    imgPixelsReady = false;
    rebuildScene();
  });
  document.getElementById("regenBtn").addEventListener("click", () => {
    if (P.mode === "lineHatch" && P.randomizeAnglesOnRebuild) {
      for (const layer of P.layers) {
        layer.angleDeg = Math.round(random(-90, 90));
      }
      pane.refresh();
    }
    rebuildScene();
  });
  document.getElementById("pngBtn").addEventListener("click", () => {
    saveCanvas("image-processor-preview", "png");
  });
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
  document.getElementById("fileInput").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      loadImageFromFile(file);
    }
    event.target.value = "";
  });

  cnv.drop((file) => {
    if (file && file.type === "image") {
      loadImage(file.data, handleLoadedImage);
    }
  });

  window.addEventListener("resize", updateCanvasDisplaySize);
}

function applyPalettePreset(key) {
  const preset = PALETTE_PRESETS.find((entry) => entry.key === key);
  if (!preset || preset.key === "custom") {
    return;
  }

  P.palettePreset = preset.key;
  for (let i = 0; i < 3 && i < P.layers.length; i += 1) {
    P.layers[i].stroke = preset.colors[i];
    if (layerStrokeBlades[i]) {
      layerStrokeBlades[i].refresh();
    }
  }
  syncPaletteBlade();
  rebuildScene();
}

function detectCurrentPaletteKey() {
  const current = P.layers.slice(0, 3).map((layer) => normalizeHex(layer.stroke));
  const match = PALETTE_PRESETS.find((preset) =>
    preset.colors.length === 3 &&
    preset.colors.every((color, index) => normalizeHex(color) === current[index])
  );
  return match ? match.key : "custom";
}

function handlePaletteToneChange(index) {
  if (index < 3) {
    P.palettePreset = detectCurrentPaletteKey();
    syncPaletteBlade();
  }
  if (layerStrokeBlades[index]) {
    layerStrokeBlades[index].refresh();
  }
}

function syncPaletteBlade() {
  if (palettePresetBlade) {
    palettePresetBlade.refresh();
  }
}

function normalizeHex(value) {
  const hex = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) {
    return hex;
  }
  return "#000000";
}

function updateModeVisibility() {
  const currentMode = P.mode;
  for (const [modeName, blades] of Object.entries(modeVisibilityBlades)) {
    const show = modeName === currentMode;
    for (const blade of blades) {
      blade.hidden = !show;
    }
  }
}

function loadImageFromFile(file) {
  const url = URL.createObjectURL(file);
  loadImage(
    url,
    (loaded) => {
      URL.revokeObjectURL(url);
      handleLoadedImage(loaded);
    },
    () => {
      URL.revokeObjectURL(url);
    }
  );
}

function handleLoadedImage(loaded) {
  img = loaded;
  img.loadPixels();
  imgPixelsReady = true;
  rebuildScene();
}

function rebuildScene() {
  scene.imageMapping = computeImageMapping();
  scene.layers = buildSceneLayers();
  redraw();
}

function buildSceneLayers() {
  if (!img || !imgPixelsReady || !scene.imageMapping) {
    return [];
  }

  const out = [];
  for (const layer of P.layers) {
    if (!layer.enabled) {
      continue;
    }

    let paths = [];
    if (P.mode === "squiggle") {
      paths = buildSquigglePaths(layer, scene.imageMapping);
    } else if (P.mode === "lineHatch") {
      paths = buildLineHatchPaths(layer, scene.imageMapping);
    } else if (P.mode === "arcHatch") {
      paths = buildArcHatchPaths(layer, scene.imageMapping);
    }

    out.push({
      stroke: layer.stroke,
      weightMM: layer.weightMM,
      paths,
    });
  }

  return out;
}

function drawPaper() {
  noStroke();
  fill(P.paperColor);
  rect(0, 0, P.canvasWMM, P.canvasHMM);

  if (P.showPaperBounds) {
    noFill();
    stroke("#d7dde5");
    strokeWeight(0.2);
    rect(P.marginMM, P.marginMM, P.canvasWMM - P.marginMM * 2, P.canvasHMM - P.marginMM * 2);
  }
}

function drawImagePreview() {
  if (!P.showImage || !img || !imgPixelsReady || !scene.imageMapping) {
    if (P.showImageBounds && scene.imageMapping) {
      drawImageBounds();
    }
    return;
  }

  const m = scene.imageMapping;
  push();
  tint(255, P.imageOpacity * 255);
  image(img, m.dest.x, m.dest.y, m.dest.w, m.dest.h, m.src.x, m.src.y, m.src.w, m.src.h);
  pop();

  if (P.showImageBounds) {
    drawImageBounds();
  }
}

function drawImageBounds() {
  const b = scene.imageMapping?.dest;
  if (!b) {
    return;
  }

  noFill();
  stroke("#86a4c8");
  strokeWeight(0.25);
  rect(b.x, b.y, b.w, b.h);
}

function drawSceneLayers() {
  const ctx = drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = P.multiplyMode ? "multiply" : "source-over";

  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  for (const layer of scene.layers) {
    stroke(layer.stroke);
    strokeWeight(layer.weightMM);
    for (const path of layer.paths) {
      if (!path || path.length < 2) {
        continue;
      }
      beginShape();
      for (const point of path) {
        vertex(point.x, point.y);
      }
      endShape();
    }
  }

  ctx.restore();
}

function exportSVG() {
  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(
      P.canvasHMM
    )}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`
  );

  if (P.svgIncludeBackground) {
    svg.push(
      `<rect x="0" y="0" width="${ExportUtils.fmt(P.canvasWMM)}" height="${ExportUtils.fmt(
        P.canvasHMM
      )}" fill="${ExportUtils.escapeXML(P.paperColor)}"/>`
    );
  }

  svg.push(`<g style="isolation:isolate">`);

  for (const layer of scene.layers) {
    svg.push(
      `<g fill="none" stroke="${ExportUtils.escapeXML(layer.stroke)}" stroke-width="${ExportUtils.fmt(
        Math.max(0.0001, layer.weightMM)
      )}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:multiply">`
    );

    for (const path of layer.paths) {
      if (!path || path.length < 2) {
        continue;
      }
      svg.push(`<path d="${buildPathD(path)}"/>`);
    }

    svg.push("</g>");
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

function buildSquigglePaths(layer, imageMapping) {
  const bounds = imageMapping.dest;
  const paths = [];
  const phase = radians(P.squigglePhaseDeg);
  const spacing = Math.max(0.5, layer.spacingMM);
  const freq = Math.max(0.1, P.squiggleFrequencyMM);
  const step = Math.max(0.2, P.traceStepMM);
  const ampBase = Math.max(0, P.squiggleAmplitudeMM);
  const maxAmp = P.squiggleClampToSpacing ? spacing * 0.49 : ampBase;
  const ampCap = P.squiggleClampToSpacing ? Math.min(ampBase, maxAmp) : ampBase;
  const horizontal = P.squiggleOrientation === "horizontal";
  const bandCount = Math.max(
    1,
    floor((horizontal ? bounds.h : bounds.w) / spacing) + 1
  );
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const baseOffset = bandIndex * spacing;
    const pieces = [];
    let current = [];
    const distanceMax = horizontal ? bounds.w : bounds.h;
    const samples = Math.max(2, ceil(distanceMax / step));

    for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
      const t = sampleIndex / samples;
      const run = distanceMax * t;
      const xBase = horizontal ? bounds.x + run : bounds.x + baseOffset;
      const yBase = horizontal ? bounds.y + baseOffset : bounds.y + run;
      if (!pointInRect(xBase, yBase, bounds)) {
        continue;
      }

      const brightness = sampleBrightnessAtMM(xBase, yBase, imageMapping);
      const amount = getSquiggleToneAmount(layer, brightness);
      const inTone = amount > 0;

      if (inTone) {
        const wave = Math.sin((TWO_PI * run) / freq + phase) * ampCap * amount;
        current.push(horizontal ? { x: xBase, y: yBase + wave } : { x: xBase + wave, y: yBase });
      } else if (current.length >= 2) {
        pieces.push(current);
        current = [];
      } else {
        current = [];
      }
    }

    if (current.length >= 2) {
      pieces.push(current);
    }

    for (const piece of pieces) {
      if (piece.length >= 2) {
        paths.push(piece);
      }
    }
  }

  return paths;
}

function getSquiggleToneAmount(layer, brightness) {
  if (brightness < layer.bMin || brightness >= layer.bMax) {
    return 0;
  }

  const minTone = constrain(layer.bMin, 0, 255);
  const maxTone = constrain(layer.bMax, minTone + 0.0001, 256);
  const normalized = constrain((brightness - minTone) / Math.max(0.0001, maxTone - minTone), 0, 1);
  const bandMid = (minTone + maxTone) * 0.5;

  if (bandMid <= 96) {
    return 1 - normalized;
  }

  if (bandMid >= 160) {
    return normalized;
  }

  return 1 - Math.abs(normalized * 2 - 1);
}

function buildLineHatchPaths(layer, imageMapping) {
  const bounds = imageMapping.dest;
  const paths = [];
  const spacing = Math.max(0.5, layer.spacingMM);
  const step = Math.max(0.2, P.traceStepMM);
  const angle = radians(layer.angleDeg);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const center = { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.5 };
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];

  let minOffset = Infinity;
  let maxOffset = -Infinity;
  let maxRun = 0;

  for (const corner of corners) {
    const relX = corner.x - center.x;
    const relY = corner.y - center.y;
    const offset = relX * normal.x + relY * normal.y;
    const run = Math.abs(relX * dir.x + relY * dir.y);
    minOffset = Math.min(minOffset, offset);
    maxOffset = Math.max(maxOffset, offset);
    maxRun = Math.max(maxRun, run);
  }

  for (let offset = minOffset - spacing; offset <= maxOffset + spacing; offset += spacing) {
    const pieces = [];
    let current = [];
    const start = -maxRun - spacing;
    const end = maxRun + spacing;
    const samples = Math.max(2, ceil((end - start) / step));

    for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
      const t = sampleIndex / samples;
      const run = lerp(start, end, t);
      const x = center.x + normal.x * offset + dir.x * run;
      const y = center.y + normal.y * offset + dir.y * run;
      const inBounds = pointInRect(x, y, bounds);
      const brightness = inBounds ? sampleBrightnessAtMM(x, y, imageMapping) : 255;
      const inTone = inBounds && brightness >= layer.bMin && brightness < layer.bMax;

      if (inTone) {
        current.push({ x, y });
      } else if (current.length >= 2) {
        pieces.push(current);
        current = [];
      } else {
        current = [];
      }
    }

    if (current.length >= 2) {
      pieces.push(current);
    }

    for (const piece of pieces) {
      const finalPieces = P.useLengthCleanup ? cleanPolylineLength(piece, layer.minLenMM, layer.maxLenMM) : [piece];
      for (const finalPiece of finalPieces) {
        if (finalPiece.length >= 2) {
          paths.push(finalPiece);
        }
      }
    }
  }

  return paths;
}

function buildArcHatchPaths(layer, imageMapping) {
  const bounds = imageMapping.dest;
  const paths = [];
  const cx = lerp(bounds.x, bounds.x + bounds.w, constrain(layer.arcCxN, 0, 1));
  const cy = lerp(bounds.y, bounds.y + bounds.h, constrain(layer.arcCyN, 0, 1));
  const spacing = Math.max(0.5, layer.spacingMM);
  const step = Math.max(0.2, P.traceStepMM);
  const a0 = radians(layer.angleStartDeg);
  const a1 = radians(layer.angleEndDeg);
  const radiusMax = max(
    dist(cx, cy, bounds.x, bounds.y),
    dist(cx, cy, bounds.x + bounds.w, bounds.y),
    dist(cx, cy, bounds.x + bounds.w, bounds.y + bounds.h),
    dist(cx, cy, bounds.x, bounds.y + bounds.h)
  );

  for (let radius = 0; radius <= radiusMax; radius += spacing) {
    const arcLength = Math.abs(a1 - a0) * radius;
    const steps = Math.max(8, ceil(arcLength / step));
    const pieces = [];
    let current = [];

    for (let sampleIndex = 0; sampleIndex <= steps; sampleIndex += 1) {
      const t = sampleIndex / steps;
      const angle = lerp(a0, a1, t);
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const inBounds = pointInRect(x, y, bounds);
      const brightness = inBounds ? sampleBrightnessAtMM(x, y, imageMapping) : 255;
      const inTone = inBounds && brightness >= layer.bMin && brightness < layer.bMax;

      if (inTone) {
        current.push({ x, y });
      } else if (current.length >= 2) {
        pieces.push(current);
        current = [];
      } else {
        current = [];
      }
    }

    if (current.length >= 2) {
      pieces.push(current);
    }

    for (const piece of pieces) {
      const finalPieces = P.useLengthCleanup ? cleanPolylineLength(piece, layer.minLenMM, layer.maxLenMM) : [piece];
      for (const finalPiece of finalPieces) {
        if (finalPiece.length >= 2) {
          paths.push(finalPiece);
        }
      }
    }
  }

  return paths;
}

function cleanPolylineLength(polyline, minLenMM, maxLenMM) {
  const minLen = Math.max(0, Number(minLenMM || 0));
  const maxLen = Math.max(0.1, Number(maxLenMM || 1e9));
  const total = polylineLength(polyline);

  if (total < minLen || polyline.length < 2) {
    return [];
  }

  if (total <= maxLen) {
    return [polyline];
  }

  const out = [];
  let current = [polyline[0]];
  let currentLen = 0;

  for (let i = 1; i < polyline.length; i += 1) {
    const previous = polyline[i - 1];
    const point = polyline[i];
    const segmentLen = dist(previous.x, previous.y, point.x, point.y);

    if (currentLen + segmentLen <= maxLen || current.length < 2) {
      current.push(point);
      currentLen += segmentLen;
      continue;
    }

    if (polylineLength(current) >= minLen) {
      out.push(current);
    }

    current = [previous, point];
    currentLen = segmentLen;
  }

  if (polylineLength(current) >= minLen) {
    out.push(current);
  }

  return out;
}

function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return length;
}

function computeImageMapping() {
  const innerX = P.marginMM;
  const innerY = P.marginMM;
  const innerW = Math.max(1, P.canvasWMM - P.marginMM * 2);
  const innerH = Math.max(1, P.canvasHMM - P.marginMM * 2);
  const dest = { x: innerX, y: innerY, w: innerW, h: innerH };

  if (!img || !img.width || !img.height) {
    return {
      dest,
      src: { x: 0, y: 0, w: 1, h: 1 },
    };
  }

  if (P.fitMode === "stretch") {
    return {
      dest,
      src: { x: 0, y: 0, w: img.width, h: img.height },
    };
  }

  const imgAspect = img.width / img.height;
  const boxAspect = innerW / innerH;
  if (P.fitMode === "cover") {
    let srcW = img.width;
    let srcH = img.height;

    if (imgAspect > boxAspect) {
      srcW = img.height * boxAspect;
    } else {
      srcH = img.width / boxAspect;
    }

    return {
      dest,
      src: {
        x: (img.width - srcW) * 0.5,
        y: (img.height - srcH) * 0.5,
        w: srcW,
        h: srcH,
      },
    };
  }

  let drawW = innerW;
  let drawH = innerH;
  if (imgAspect > boxAspect) {
    drawH = drawW / imgAspect;
  } else {
    drawW = drawH * imgAspect;
  }

  return {
    dest: {
      x: innerX + (innerW - drawW) * 0.5,
      y: innerY + (innerH - drawH) * 0.5,
      w: drawW,
      h: drawH,
    },
    src: { x: 0, y: 0, w: img.width, h: img.height },
  };
}

function sampleBrightnessAtMM(xMM, yMM, imageMapping) {
  if (!img || !imgPixelsReady) {
    return 255;
  }

  const bounds = imageMapping.dest;
  const nx = constrain((xMM - bounds.x) / Math.max(0.0001, bounds.w), 0, 0.999999);
  const ny = constrain((yMM - bounds.y) / Math.max(0.0001, bounds.h), 0, 0.999999);
  let px = floor(imageMapping.src.x + nx * imageMapping.src.w);
  let py = floor(imageMapping.src.y + ny * imageMapping.src.h);
  const grid = Math.max(1, floor(P.sampleGridPx));
  px = constrain(floor(px / grid) * grid, 0, img.width - 1);
  py = constrain(floor(py / grid) * grid, 0, img.height - 1);
  const idx = 4 * (py * img.width + px);

  const r = img.pixels[idx] ?? 255;
  const g = img.pixels[idx + 1] ?? 255;
  const b = img.pixels[idx + 2] ?? 255;
  let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const safeGamma = Math.max(0.0001, Number(P.imageGamma || 1));
  brightness = Math.pow(constrain(brightness, 0, 1), safeGamma);
  if (P.invertBrightness) {
    brightness = 1 - brightness;
  }
  return brightness * 255;
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function syncCanvasSize() {
  PaperUtils.syncCanvasSize(cnv, P, resizeCanvas, "wrap", 28);
}

function updateCanvasDisplaySize() {
  PaperUtils.updateCanvasDisplaySize(cnv, P, "wrap", 28);
}
