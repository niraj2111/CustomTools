const MM_PER_INCH = 25.4;

let pane;
let cnv;

const P = {
  // Canvas & Layout
  canvasWMM: 210,
  canvasHMM: 210,
  canvasSizePreset: "Square",
  dpi: 96,
  previewScale: 1.0,
  fitToViewport: true,
  bg: "#ffffff",
  lineColor: "#0b0c10",
  strokeWeightMM: 0.35,
  marginMM: 20,

  // Primary Form (0-1)
  neckWidth: 0.25,
  rimFlare: 0.5,
  baseWidth: 0.4,
  a4: 0.8,

  // Bulge Geometry (0-1)
  bellyWidth: 0.8,
  a2: 0.8,
  a3: 0.8,
  bulbHeightRatio: 0.5,

  // Locks (Internal)
  lock_neckWidth: false,
  lock_rimFlare: false,
  lock_baseWidth: false,
  lock_a4: false,
  lock_bellyWidth: false,
  lock_a2: false,
  lock_a3: false,
  lock_bulbHeightRatio: false,
  
  // Proportions & Density
  neckDepth: 5,
  baseDepth: 5,
  vaseLines: 80,

  // Plant
  showBranch: true,
  branchHeightRatio: 0.35,
  branchSeed: 42,
  branchAngle: Math.PI / 8,

  showControls: false,
  svgFilename: "Vase-Bundle",
};

function setup() {
  const size = getCanvasPixelSize();
  cnv = createCanvas(size.width, size.height);
  cnv.parent("wrap");
  pixelDensity(1);
  noLoop();

  buildPane();
  hookUI();
  updateCanvasDisplaySize();
  redraw();
}

function draw() {
  background(P.bg);
  push();
  scale(getPxPerMM());
  stroke(P.lineColor);
  strokeWeight(P.strokeWeightMM);
  noFill();

  const usableW = P.canvasWMM - (P.marginMM * 2);
  const usableH = P.canvasHMM - (P.marginMM * 2);
  const centerX = P.canvasWMM / 2;
  const centerY = P.canvasHMM / 2;

  const plantHLimit = P.showBranch ? usableH * P.branchHeightRatio : 0;
  const vaseHLimit = usableH - plantHLimit;
  const artTop = centerY - (usableH / 2);

  if (P.showBranch) {
    push();
    randomSeed(P.branchSeed);
    translate(centerX, artTop + plantHLimit);
    strokeWeight(P.strokeWeightMM * 0.7);
    branch(plantHLimit);
    pop();
  }

  drawVase(centerX, artTop + plantHLimit, vaseHLimit, usableW);
  pop();
}

function drawVase(x, y, h, w) {
  const bulbY = h * P.bulbHeightRatio;
  const sy = 0; const ey = h;
  const pts = [{ py: sy }, { py: sy + P.neckDepth }, { py: sy + P.neckDepth }, { py: ey - P.baseDepth }, { py: ey - P.baseDepth }, { py: ey }];

  const maxW = (w * 0.9) / 1.5;
  const baseGap = maxW; 

  push();
  translate(x, y);

  for (let j = 0; j <= P.vaseLines; j++) {
    let factor = map(j, 0, P.vaseLines, -1, 1);
    let g = baseGap * factor;
    const cx = (val) => constrain(val, -maxW, maxW);

    beginShape();
    vertex(cx(g * P.neckWidth), pts[0].py);
    vertex(cx(g * P.neckWidth), pts[1].py);
    bezierVertex(cx(g * P.rimFlare), pts[1].py, cx(g * P.a2), pts[2].py + bulbY, cx(g * P.bellyWidth), pts[2].py + bulbY);
    bezierVertex(cx(g * P.a3), pts[2].py + bulbY, cx(g * P.a4), pts[4].py, cx(g * P.baseWidth), pts[4].py);
    vertex(cx(g * P.baseWidth), pts[4].py);
    vertex(cx(g * P.baseWidth), pts[5].py);
    endShape();

    if (P.showControls && (j === 0 || j === P.vaseLines)) {
      drawDot(cx(g * P.rimFlare), pts[1].py);
      drawDot(cx(g * P.a2), pts[2].py + bulbY);
      drawDot(cx(g * P.a3), pts[2].py + bulbY);
      drawDot(cx(g * P.a4), pts[4].py);
    }
  }
  pop();
}

function drawDot(x, y) {
  push(); noStroke(); fill(255, 0, 0, 150); ellipse(x, y, 1.2, 1.2); pop();
}

function branch(len) {
  line(0, 0, 0, -len * 0.4);
  translate(0, -len * 0.4);
  if (len > 15) {
    push(); rotate(P.branchAngle * random(0.6, 1.4)); branch(len * 0.65); pop();
    push(); rotate(-P.branchAngle * random(0.6, 1.4)); branch(len * 0.55); pop();
  } else {
    noStroke(); fill(P.lineColor);
    ellipse(0, 0, 1.5, 1.5);
  }
}

function buildPane() {
  pane = new Tweakpane.Pane({ container: document.getElementById("pane"), title: "Vase Project" });
  
  const presets = pane.addFolder({ title: "Presets Management" });
  presets.addButton({ title: "💾 Save Bundle (SVG+JSON)" }).on("click", exportBundle);
  presets.addButton({ title: "📂 Load JSON Preset" }).on("click", () => document.getElementById("presetInput").click());

  const form = pane.addFolder({ title: "Primary Form (0-1)" });
  form.addInput(P, "neckWidth", { min: 0.1, max: 1.0, label: "Neck Width" });
  form.addInput(P, "lock_neckWidth", { label: "Lock Neck" });
  form.addInput(P, "rimFlare", { min: 0.1, max: 1.0, label: "Rim Flare (A1)" });
  form.addInput(P, "lock_rimFlare", { label: "Lock Flare" });
  form.addInput(P, "baseWidth", { min: 0.1, max: 1.0, label: "Base Width" });
  form.addInput(P, "lock_baseWidth", { label: "Lock Base" });
  form.addInput(P, "a4", { min: 0.1, max: 1.0, label: "Shoulder (A4)" });
  form.addInput(P, "lock_a4", { label: "Lock Shoulder" });

  const bulb = pane.addFolder({ title: "Bulge Geometry (0-1)" });
  bulb.addInput(P, "bellyWidth", { min: 0.1, max: 1.5, label: "Belly Width" });
  bulb.addInput(P, "lock_bellyWidth", { label: "Lock Belly" });
  bulb.addInput(P, "a2", { min: 0.1, max: 2.0, label: "Bulb Top Handle" });
  bulb.addInput(P, "lock_a2", { label: "Lock Top" });
  bulb.addInput(P, "a3", { min: 0.1, max: 2.0, label: "Bulb Btm Handle" });
  bulb.addInput(P, "lock_a3", { label: "Lock Btm" });
  bulb.addInput(P, "bulbHeightRatio", { min: 0.1, max: 0.9, label: "Bulb Position %" });
  bulb.addInput(P, "lock_bulbHeightRatio", { label: "Lock Position" });

  const plant = pane.addFolder({ title: "Plant Variety" });
  plant.addInput(P, "showBranch", { label: "Show" });
  plant.addInput(P, "branchSeed", { min: 0, max: 9999, step: 1, label: "Seed" });
  plant.addInput(P, "branchHeightRatio", { min: 0.1, max: 0.7, label: "Height %" });
  plant.addInput(P, "branchAngle", { min: 0.1, max: 1.5, label: "Spread Angle" });

  const dim = pane.addFolder({ title: "Vase Lines & Heights" });
  dim.addInput(P, "vaseLines", { min: 5, max: 300, step: 1, label: "Density" });
  dim.addInput(P, "neckDepth", { min: 2, max: 80, label: "Neck H" });
  dim.addInput(P, "baseDepth", { min: 2, max: 80, label: "Base H" });

  const layout = pane.addFolder({ title: "Canvas Settings" });
  layout.addInput(P, "canvasWMM", { label: "Width (mm)" });
  layout.addInput(P, "canvasHMM", { label: "Height (mm)" });
  layout.addInput(P, "canvasSizePreset", { options: { Square: "Square", A5: "A5", A4: "A4", A3: "A3" }, label: "Preset Paper" }).on("change", (ev) => {
    if (ev.value === "A5") { P.canvasWMM = 148; P.canvasHMM = 210; }
    else if (ev.value === "A4") { P.canvasWMM = 210; P.canvasHMM = 297; }
    else if (ev.value === "A3") { P.canvasWMM = 297; P.canvasHMM = 420; }
    else if (ev.value === "Square") { P.canvasWMM = 210; P.canvasHMM = 210; }
    pane.refresh();
  });
  layout.addInput(P, "marginMM", { min: 0, max: 80, step: 1, label: "Margin (mm)" });
  layout.addInput(P, "previewScale", { min: 0.1, max: 5, step: 0.1, label: "Zoom" });
  layout.addInput(P, "fitToViewport", { label: "Fit View" });

  const style = pane.addFolder({ title: "Styling" });
  style.addInput(P, "lineColor", { label: "Ink Color" });
  style.addInput(P, "strokeWeightMM", { min: 0.05, max: 1.0, step: 0.05, label: "Lineweight" });
  style.addInput(P, "showControls", { label: "Guides (G)" });

  pane.on("change", () => { syncCanvasSize(); redraw(); });
}

function hookUI() {
  document.getElementById("randomBtn").addEventListener("click", () => {
    const keys = ["neckWidth", "rimFlare", "baseWidth", "a4", "bellyWidth", "a2", "a3", "bulbHeightRatio"];
    keys.forEach(k => { if (!P["lock_" + k]) P[k] = Math.random() * 0.8 + 0.1; });
    P.branchSeed = Math.floor(Math.random() * 9999);
    pane.refresh(); redraw();
  });
  document.getElementById("svgBtn").addEventListener("click", exportBundle);
  
  // Hidden Preset Input
  const inp = document.createElement("input");
  inp.type = "file"; inp.id = "presetInput"; inp.style.display = "none";
  inp.accept = ".json";
  inp.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        Object.keys(data).forEach(k => { if (P.hasOwnProperty(k)) P[k] = data[k]; });
        pane.refresh(); syncCanvasSize(); redraw();
      } catch (err) { console.error("Error loading preset:", err); }
    };
    reader.readAsText(file);
  });
  document.body.appendChild(inp);

  window.addEventListener("resize", () => { syncCanvasSize(); redraw(); });
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "r") document.getElementById("randomBtn").click();
    if (e.key.toLowerCase() === "s") document.getElementById("svgBtn").click();
    if (e.key.toLowerCase() === "g") { P.showControls = !P.showControls; pane.refresh(); redraw(); }
  });
}

function exportBundle() {
  const ts = Math.floor(Date.now() / 1000);
  const name = `Vase_${ts}`;
  
  // 1. Export SVG immediately
  const svgContent = buildSVGContent();
  downloadText(svgContent, `${name}.svg`, "image/svg+xml");
  
  // 2. Export JSON with a slight delay to bypass security throttling
  setTimeout(() => {
    const preset = {};
    Object.keys(P).forEach(k => { if (!k.startsWith("lock_")) preset[k] = P[k]; });
    downloadText(JSON.stringify(preset, null, 2), `${name}.json`, "application/json");
  }, 300);
}

function buildSVGContent() {
  const svg = [];
  const centerX = P.canvasWMM / 2;
  const centerY = P.canvasHMM / 2;
  const uW = P.canvasWMM - (P.marginMM * 2);
  const uH = P.canvasHMM - (P.marginMM * 2);
  const pH = P.showBranch ? uH * P.branchHeightRatio : 0;
  const vH = uH - pH;
  const artTop = centerY - (uH / 2);

  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`);
  svg.push(`<rect width="100%" height="100%" fill="${P.bg}"/>`);
  
  // Vase Group
  svg.push(`<g id="Vase" fill="none" stroke="${P.lineColor}" stroke-width="${fmt(P.strokeWeightMM)}" stroke-linecap="round" stroke-linejoin="round">`);
  const mH = P.neckDepth;
  const bH = P.baseDepth;
  const bulbsY = vH * P.bulbHeightRatio;
  const pts = [{ py: 0 }, { py: mH }, { py: mH }, { py: vH - bH }, { py: vH - bH }, { py: vH }];
  const mw = (uW * 0.9) / 1.5;
  const cx = (val) => constrain(val, -mw, mw);

  for (let j = 0; j <= P.vaseLines; j++) {
    let fact = map(j, 0, P.vaseLines, -1, 1);
    let g = mw * fact;
    const vY = artTop + pH;
    let d = `M ${fmt(centerX + cx(g * P.neckWidth))} ${fmt(vY + pts[0].py)} L ${fmt(centerX + cx(g * P.neckWidth))} ${fmt(vY + pts[1].py)}`;
    d += ` C ${fmt(centerX + cx(g * P.rimFlare))} ${fmt(vY + pts[1].py)}, ${fmt(centerX + cx(g * P.a2))} ${fmt(vY + pts[2].py + bulbsY)}, ${fmt(centerX + cx(g * P.bellyWidth))} ${fmt(vY + pts[2].py + bulbsY)}`;
    d += ` C ${fmt(centerX + cx(g * P.a3))} ${fmt(vY + pts[2].py + bulbsY)}, ${fmt(centerX + cx(g * P.a4))} ${fmt(vY + pts[4].py)}, ${fmt(centerX + cx(g * P.baseWidth))} ${fmt(vY + pts[4].py)}`;
    d += ` L ${fmt(centerX + cx(g * P.baseWidth))} ${fmt(vY + pts[4].py)} L ${fmt(centerX + cx(g * P.baseWidth))} ${fmt(vY + pts[5].py)}`;
    svg.push(`<path d="${d}"/>`);
  }
  svg.push(`</g>`);

  // Branches Group
  if (P.showBranch) {
    svg.push(`<g id="Branches" fill="none" stroke="${P.lineColor}" stroke-width="${fmt(P.strokeWeightMM * 0.7)}" stroke-linecap="round">`);
    const rng = mulberry32(P.branchSeed);
    let out = "";
    const recurse = (sx, sy, angle, blen) => {
      const step = blen * 0.4;
      const ex = sx + Math.sin(angle) * step;
      const ey = sy - Math.cos(angle) * step;
      out += `<line x1="${fmt(sx)}" y1="${fmt(sy)}" x2="${fmt(ex)}" y2="${fmt(ey)}"/>\n`;
      if (blen > 15) {
        recurse(ex, ey, angle + P.branchAngle * (rng() * 0.8 + 0.6), blen * 0.65);
        recurse(ex, ey, angle - P.branchAngle * (rng() * 0.8 + 0.6), blen * 0.55);
      } else {
        out += `<circle cx="${fmt(ex)}" cy="${fmt(ey)}" r="0.75" fill="${P.lineColor}" stroke="none"/>\n`;
      }
    };
    recurse(centerX, artTop + pH, 0, pH);
    svg.push(out);
    svg.push(`</g>`);
  }
  svg.push("</svg>");
  return svg.join("\n");
}

function getPxPerMM() { return P.dpi / MM_PER_INCH; }
function mmToPx(mm) { return Math.max(1, Math.round(mm * getPxPerMM())); }
function getCanvasPixelSize() { return { width: mmToPx(P.canvasWMM), height: mmToPx(P.canvasHMM) }; }
function syncCanvasSize() {
  const size = getCanvasPixelSize();
  if (width !== size.width || height !== size.height) resizeCanvas(size.width, size.height, true);
  updateCanvasDisplaySize();
}
function updateCanvasDisplaySize() {
  const main = document.getElementById("main");
  if (!main) return;
  const rect = main.getBoundingClientRect();
  const pxSize = getCanvasPixelSize();
  const fitScale = Math.min((rect.width - 60) / pxSize.width, (rect.height - 60) / pxSize.height);
  const scale = P.fitToViewport ? fitScale : P.previewScale;
  if (cnv) {
    cnv.elt.style.width = `${Math.round(pxSize.width * scale)}px`;
    cnv.elt.style.height = `${Math.round(pxSize.height * scale)}px`;
  }
}
function fmt(value) { return Number(value).toFixed(3).replace(/\.?0+$/, ""); }

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
