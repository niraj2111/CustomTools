const MM_PER_INCH = 25.4;
const TWO_PI_VALUE = Math.PI * 2;

let pane;
let cnv;

const P = {
  canvasWMM: 148,
  canvasHMM: 210,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  marginMM: 12,
  rows: 60,
  cols: 700,
  amplitudeFactor: 0.48,
  minFrequency: 1,
  maxFrequency: 50,
  mode: "rowSine",
  rowDivisor: 5,
  rowPhaseOffset: 0,
  colCosPeriod: 175,
  noiseScaleRow: 90,
  noiseScaleCol: 500,
  noiseMix: 0.35,
  dutyCycleDepth: 0.65,
  bitCrushHold: 8,
  phaseDriftRate: 0.12,
  amplitudeMinScale: 0.2,
  amplitudeNoiseMix: 0.75,
  domainWarpAmount: 36,
  domainWarpSineAmount: 12,
  interferenceScale: 1.8,
  interferenceMix: 0.65,
  cellRows: 8,
  cellCols: 70,
  glitchBandProbability: 0.18,
  glitchFreqMultiplier: 3,
  glitchPhaseJump: Math.PI * 0.5,
  hysteresisWidth: 0.22,
  pulseWidth: 0.12,
  topographyAmount: 0.75,
  seed: 1,
  noiseDetailOct: 3,
  noiseDetailFalloff: 0.8,
  strokeColor: "#111111",
  bg: "#ffffff",
  strokeWeightMM: 0.35,
  lineJoin: "round",
  showFrame: true,
  svgIncludeBackground: true,
  svgFilename: "Axi-Sinusoids.svg",
};

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
  randomSeed(P.seed);
  noiseSeed(P.seed);
  noiseDetail(P.noiseDetailOct, P.noiseDetailFalloff);
  const innerWMM = getInnerWidthMM();
  const innerHMM = getInnerHeightMM();

  push();
  scale(getPxPerMM());
  noFill();
  stroke(P.strokeColor);
  strokeWeight(P.strokeWeightMM);
  strokeJoin(joinToP5(P.lineJoin));

  drawWaveRows();

  if (P.showFrame && innerWMM > 0 && innerHMM > 0) {
    rect(P.marginMM, P.marginMM, innerWMM, innerHMM);
  }

  pop();
}

function drawWaveRows() {
  const innerWMM = getInnerWidthMM();
  const innerHMM = getInnerHeightMM();
  if (innerWMM <= 0 || innerHMM <= 0) {
    return;
  }

  const rows = Math.max(1, Math.floor(P.rows));
  const cols = Math.max(2, Math.floor(P.cols));
  const cellWidthMM = innerWMM / cols;
  const cellHeightMM = innerHMM / rows;

  for (let row = 0; row < rows; row += 1) {
    const samples = buildRowSamples(row, rows, cols, cellWidthMM, cellHeightMM);
    beginShape();
    for (const sample of samples) {
      vertex(sample.xMM, sample.yMM);
    }
    endShape();
  }
}

function buildRowSamples(row, rows, cols, cellWidthMM, cellHeightMM) {
  const centerYMM = P.marginMM + row * cellHeightMM + cellHeightMM * 0.5;
  const samples = [];
  let previousSquareWave = 1;

  for (let col = 0; col < cols; col += 1) {
    const xMM = P.marginMM + col * cellWidthMM;
    const wave = getWaveState(row, col, rows, cols, cellHeightMM, previousSquareWave);
    previousSquareWave = wave.squareWave;
    samples.push({
      xMM,
      yMM: centerYMM + wave.squareWave * wave.amplitudeMM,
    });
  }

  return samples;
}

function getWaveState(row, col, rows, cols, cellHeightMM, previousSquareWave) {
  const amplitudeBaseMM = cellHeightMM * clamp(P.amplitudeFactor, 0, 0.5);
  let amplitudeScale = 1;
  let evalCol = col;
  let phase = P.rowPhaseOffset;
  let threshold = 0;
  let frequency = getFrequencyFor(row, col, rows, cols);

  if (P.mode === "dutyCycle") {
    const dutySignal =
      0.6 * Math.sin(row / Math.max(0.0001, P.rowDivisor)) +
      0.4 * noise(row / Math.max(1, P.noiseScaleRow), col / Math.max(1, P.noiseScaleCol));
    threshold = clamp(dutySignal * clamp(P.dutyCycleDepth, 0, 1), -0.95, 0.95);
  }

  if (P.mode === "bitCrush") {
    const hold = Math.max(1, Math.floor(P.bitCrushHold));
    evalCol = Math.floor(col / hold) * hold;
  }

  if (P.mode === "phaseDrift") {
    phase += row * P.phaseDriftRate;
  }

  if (P.mode === "amplitudeBreath") {
    const breathNoise = noise(
      row / Math.max(1, P.noiseScaleRow),
      col / Math.max(1, P.noiseScaleCol)
    );
    const breathSine = 0.5 + 0.5 * Math.sin(row / Math.max(0.0001, P.rowDivisor));
    const breathBlend = lerp(breathSine, breathNoise, clamp(P.amplitudeNoiseMix, 0, 1));
    amplitudeScale = lerp(clamp(P.amplitudeMinScale, 0, 1), 1, breathBlend);
  }

  if (P.mode === "domainWarp") {
    const warpNoise =
      map(
        noise(row / Math.max(1, P.noiseScaleRow), col / Math.max(1, P.noiseScaleCol)),
        0,
        1,
        -1,
        1
      ) * P.domainWarpAmount;
    const warpSine = Math.sin(row / Math.max(0.0001, P.rowDivisor)) * P.domainWarpSineAmount;
    evalCol = col + warpNoise + warpSine;
  }

  if (P.mode === "cellular") {
    const rowBucket = Math.floor(row / Math.max(1, P.cellRows));
    const colBucket = Math.floor(col / Math.max(1, P.cellCols));
    const cellNoise = noise(rowBucket * 0.73 + 11.2, colBucket * 0.61 + 7.4);
    frequency = map(cellNoise, 0, 1, Math.min(P.minFrequency, P.maxFrequency), Math.max(P.minFrequency, P.maxFrequency));
  }

  if (P.mode === "glitchBands") {
    const glitchSignal = noise(row * 0.12 + 99, 0.37);
    if (glitchSignal < clamp(P.glitchBandProbability, 0, 1)) {
      frequency *= Math.max(0.1, P.glitchFreqMultiplier);
      phase += P.glitchPhaseJump;
      threshold = Math.sin(col * 0.15) * 0.3;
    }
  }

  const primarySignal = Math.sin(((TWO_PI_VALUE * frequency * evalCol) / cols) + phase);
  let comparisonSignal = primarySignal;

  if (P.mode === "interference") {
    const secondarySignal = Math.sin(
      ((TWO_PI_VALUE * frequency * Math.max(0.1, P.interferenceScale) * evalCol) / cols) -
        phase * 0.5
    );
    comparisonSignal = lerp(primarySignal, primarySignal + secondarySignal, clamp(P.interferenceMix, 0, 1));
  }

  if (P.mode === "scanlineTopography") {
    const topoNoise = noise(
      row / Math.max(1, P.noiseScaleRow * 0.5),
      col / Math.max(1, P.noiseScaleCol * 0.5)
    );
    threshold = lerp(threshold, map(topoNoise, 0, 1, -1, 1), clamp(P.topographyAmount, 0, 1));
  }

  let squareWave = comparisonSignal >= threshold ? 1 : -1;

  if (P.mode === "hysteresis") {
    const halfWidth = clamp(P.hysteresisWidth, 0, 1) * 0.5;
    const upper = threshold + halfWidth;
    const lower = threshold - halfWidth;
    if (comparisonSignal > upper) {
      squareWave = 1;
    } else if (comparisonSignal < lower) {
      squareWave = -1;
    } else {
      squareWave = previousSquareWave;
    }
  }

  if (P.mode === "pulseTrain") {
    const pulseThreshold = 1 - clamp(P.pulseWidth, 0.01, 1) * 2;
    squareWave = comparisonSignal > pulseThreshold ? 1 : -1;
  }

  return {
    squareWave,
    amplitudeMM: amplitudeBaseMM * amplitudeScale,
  };
}

function getFrequencyFor(row, col, rows, cols) {
  const minFrequency = Math.min(P.minFrequency, P.maxFrequency);
  const maxFrequency = Math.max(P.minFrequency, P.maxFrequency);
  const safeDivisor = Math.max(0.0001, P.rowDivisor);
  const rowSine = map(Math.sin(row / safeDivisor), -1, 1, minFrequency, maxFrequency);

  if (P.mode === "rowCosMix") {
    const safePeriod = Math.max(1, P.colCosPeriod);
    const mixed = Math.sin(row / safeDivisor) + Math.cos(col / safePeriod);
    return map(mixed, -2, 2, minFrequency, maxFrequency);
  }

  if (P.mode === "noiseBlend") {
    const rowScale = Math.max(0.0001, P.noiseScaleRow);
    const colScale = Math.max(0.0001, P.noiseScaleCol);
    const noiseFrequency = map(noise(row / rowScale, col / colScale), 0, 1, minFrequency, maxFrequency);
    return lerp(rowSine, noiseFrequency, clamp(P.noiseMix, 0, 1));
  }

  if (P.mode === "rowRamp") {
    return map(row, 0, Math.max(1, rows - 1), minFrequency, maxFrequency);
  }

  if (P.mode === "colRamp") {
    return map(col, 0, Math.max(1, cols - 1), minFrequency, maxFrequency);
  }

  return rowSine;
}

function exportSVG() {
  const rows = Math.max(1, Math.floor(P.rows));
  const cols = Math.max(2, Math.floor(P.cols));
  const innerWMM = getInnerWidthMM();
  const innerHMM = getInnerHeightMM();
  if (innerWMM <= 0 || innerHMM <= 0) {
    return;
  }

  randomSeed(P.seed);
  noiseSeed(P.seed);
  noiseDetail(P.noiseDetailOct, P.noiseDetailFalloff);

  const cellWidthMM = innerWMM / cols;
  const cellHeightMM = innerHMM / rows;

  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(
      P.canvasHMM
    )}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`
  );

  if (P.svgIncludeBackground) {
    svg.push(
      `<rect x="0" y="0" width="${fmt(P.canvasWMM)}" height="${fmt(P.canvasHMM)}" fill="${escapeXML(
        P.bg
      )}"/>`
    );
  }

  svg.push(
    `<g fill="none" stroke="${escapeXML(P.strokeColor)}" stroke-width="${fmt(
      Math.max(0.0001, P.strokeWeightMM)
    )}" stroke-linejoin="${escapeXML(P.lineJoin)}">`
  );

  for (let row = 0; row < rows; row += 1) {
    const samples = buildRowSamples(row, rows, cols, cellWidthMM, cellHeightMM);
    let d = "";

    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      d += i === 0 ? `M ${fmt(sample.xMM)} ${fmt(sample.yMM)}` : ` L ${fmt(sample.xMM)} ${fmt(sample.yMM)}`;
    }

    svg.push(`<path d="${d}"/>`);
  }

  if (P.showFrame) {
    svg.push(
      `<rect x="${fmt(P.marginMM)}" y="${fmt(P.marginMM)}" width="${fmt(
        innerWMM
      )}" height="${fmt(innerHMM)}"/>`
    );
  }

  svg.push("</g>");
  svg.push("</svg>");
  downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function buildPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "Axi Sinusoids",
  });

  const fCanvas = pane.addFolder({ title: "Canvas (mm)" });
  fCanvas.addInput(P, "canvasWMM", { min: 10, max: 1200, step: 1, label: "W mm" });
  fCanvas.addInput(P, "canvasHMM", { min: 10, max: 1200, step: 1, label: "H mm" });
  fCanvas.addInput(P, "dpi", { min: 36, max: 600, step: 1, label: "DPI" });
  fCanvas.addInput(P, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" });
  fCanvas.addInput(P, "fitToViewport", { label: "Fit View" });
  fCanvas.addInput(P, "marginMM", { min: 0, max: 200, step: 0.5, label: "Margin" });

  const fGrid = pane.addFolder({ title: "Wave Grid" });
  fGrid.addInput(P, "rows", { min: 1, max: 400, step: 1, label: "Rows" });
  fGrid.addInput(P, "cols", { min: 2, max: 2000, step: 1, label: "Cols" });
  fGrid.addInput(P, "amplitudeFactor", { min: 0, max: 0.5, step: 0.01, label: "Amplitude" });

  const fFreq = pane.addFolder({ title: "Frequency" });
  fFreq.addInput(P, "mode", {
    options: {
      rowSine: "rowSine",
      rowCosMix: "rowCosMix",
      noiseBlend: "noiseBlend",
      rowRamp: "rowRamp",
      colRamp: "colRamp",
      dutyCycle: "dutyCycle",
      bitCrush: "bitCrush",
      phaseDrift: "phaseDrift",
      amplitudeBreath: "amplitudeBreath",
      domainWarp: "domainWarp",
      interference: "interference",
      cellular: "cellular",
      glitchBands: "glitchBands",
      hysteresis: "hysteresis",
      pulseTrain: "pulseTrain",
      scanlineTopography: "scanlineTopography",
    },
    label: "Mode",
  });
  fFreq.addInput(P, "minFrequency", { min: 0, max: 300, step: 0.1, label: "Min Freq" });
  fFreq.addInput(P, "maxFrequency", { min: 0, max: 300, step: 0.1, label: "Max Freq" });
  fFreq.addInput(P, "rowDivisor", { min: 0.1, max: 100, step: 0.1, label: "Row Div" });
  fFreq.addInput(P, "rowPhaseOffset", {
    min: -Math.PI,
    max: Math.PI,
    step: 0.01,
    label: "Phase",
  });
  fFreq.addInput(P, "colCosPeriod", { min: 1, max: 2000, step: 1, label: "Cos Period" });

  const fNoise = pane.addFolder({ title: "Noise" });
  fNoise.addInput(P, "seed", { min: 0, max: 9999, step: 1, label: "Seed" });
  fNoise.addInput(P, "noiseScaleRow", { min: 1, max: 1000, step: 1, label: "Row Scale" });
  fNoise.addInput(P, "noiseScaleCol", { min: 1, max: 2000, step: 1, label: "Col Scale" });
  fNoise.addInput(P, "noiseMix", { min: 0, max: 1, step: 0.01, label: "Noise Mix" });
  fNoise.addInput(P, "noiseDetailOct", { min: 1, max: 8, step: 1, label: "Octaves" });
  fNoise.addInput(P, "noiseDetailFalloff", {
    min: 0.01,
    max: 0.99,
    step: 0.01,
    label: "Falloff",
  });

  const fModes = pane.addFolder({ title: "Mode Shaping" });
  fModes.addInput(P, "dutyCycleDepth", { min: 0, max: 1, step: 0.01, label: "Duty Depth" });
  fModes.addInput(P, "bitCrushHold", { min: 1, max: 120, step: 1, label: "Bit Hold" });
  fModes.addInput(P, "phaseDriftRate", { min: -1, max: 1, step: 0.01, label: "Phase Drift" });
  fModes.addInput(P, "amplitudeMinScale", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Amp Min",
  });
  fModes.addInput(P, "amplitudeNoiseMix", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Amp Mix",
  });
  fModes.addInput(P, "domainWarpAmount", {
    min: 0,
    max: 200,
    step: 1,
    label: "Warp Noise",
  });
  fModes.addInput(P, "domainWarpSineAmount", {
    min: 0,
    max: 200,
    step: 1,
    label: "Warp Sine",
  });
  fModes.addInput(P, "interferenceScale", {
    min: 0.1,
    max: 8,
    step: 0.1,
    label: "Interf Scale",
  });
  fModes.addInput(P, "interferenceMix", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Interf Mix",
  });
  fModes.addInput(P, "cellRows", { min: 1, max: 100, step: 1, label: "Cell Rows" });
  fModes.addInput(P, "cellCols", { min: 1, max: 300, step: 1, label: "Cell Cols" });
  fModes.addInput(P, "glitchBandProbability", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Glitch Prob",
  });
  fModes.addInput(P, "glitchFreqMultiplier", {
    min: 0.1,
    max: 20,
    step: 0.1,
    label: "Glitch Freq",
  });
  fModes.addInput(P, "glitchPhaseJump", {
    min: -Math.PI * 2,
    max: Math.PI * 2,
    step: 0.01,
    label: "Glitch Phase",
  });
  fModes.addInput(P, "hysteresisWidth", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Hysteresis",
  });
  fModes.addInput(P, "pulseWidth", { min: 0.01, max: 1, step: 0.01, label: "Pulse Width" });
  fModes.addInput(P, "topographyAmount", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Topo Amt",
  });

  const fStyle = pane.addFolder({ title: "Style" });
  fStyle.addInput(P, "strokeColor", { label: "Stroke" });
  fStyle.addInput(P, "bg", { label: "BG" });
  fStyle.addInput(P, "strokeWeightMM", {
    min: 0.01,
    max: 10,
    step: 0.01,
    label: "Stroke mm",
  });
  fStyle.addInput(P, "lineJoin", {
    options: { round: "round", bevel: "bevel", miter: "miter" },
    label: "Join",
  });
  fStyle.addInput(P, "showFrame", { label: "Frame" });

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
    syncCanvasSize();
    redraw();
  });
}

function hookUI() {
  document.getElementById("renderBtn").addEventListener("click", redraw);
  document.getElementById("svgBtn").addEventListener("click", exportSVG);
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

  cnv.style("width", `${Math.max(1, Math.round(pxSize.width * scale))}px`);
  cnv.style("height", `${Math.max(1, Math.round(pxSize.height * scale))}px`);
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

function joinToP5(join) {
  if (join === "bevel") {
    return BEVEL;
  }
  if (join === "miter") {
    return MITER;
  }
  return ROUND;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
