/* Masked Cloth (Two Masks) — p5 + Tweakpane + SVG export (no p5.svg) */

let pane;

let maskSystem; // owns both masks and samplers
let cloth;
let rebuildTimer = null;
let pendingRebuild = null;

const REBUILD_FLAGS = {
  meshMask: false,
  tearMask: false,
  cloth: false,
};

const ui = {
  // Canvas / layout
  pixelDensity: 1,

  // Grid
  cols: 110,
  rows: 140,
  spacing: 8,
  topOffset: 40,
  centerX: 0.5, // normalized (0..1)
  centerY: 0.45,

  // Anchoring
  anchorMode: "edge", // "none" | "edge" | "all"
  edgeProbeMul: 1.0,

  // Physics
  gravity: 0.0,
  damping: 0.70,
  stiffness: 0.22,
  iterations: 3,

  // Constraint behavior
  shrinkFactor: 1.00,
  tensionEnable: true,
  tensionFactor: 1.6,
  tensionStrength: 0.35,

  // Extras
  addDiagonals: false,

  // Interaction
  mode: "drag",           // "drag" | "tear"
  pickRadius: 18,
  tearRadius: 6,

  // Render
  bgAlpha: 255,
  lineWeight: 1,
  showPoints: false,
  showLocked: false,

  // Export
  svgStrokeWidth: 1,
  exportPoints: false,

  // Randomness
  seed: 1,
  initJitter: 0.0,
  jitterScale: 0.02,

  // -------------------------
  // TWO MASKS
  // -------------------------
  showMeshMaskOverlay: false,
  showTearMaskOverlay: false,

  meshInvert: false,
  meshThreshold: 60,

  tearInvert: false,
  tearThreshold: 60,
  applyTearOnBuild: true,
  tearAffects: "constraints", // "constraints" | "points+constraints"

  // Mask types
  meshMaskType: "rectCircle",   // "rectCircle" | "voronoiBlobs"
  tearMaskType: "voronoiBlobs", // "rectCircle" | "voronoiBlobs"

  // Rect+Circle params (shared by both masks)
  rectX: 0.25, rectY: 0.18, rectW: 0.35, rectH: 0.55,
  circX: 0.62, circY: 0.42, circR: 0.22,
  rectCircleShowCircle: true,

  // Voronoi blobs params (shared)
  vorSeeds: 28,
  vorPadding: 24,
  vorMinSep: 26,        // Poisson-disc minimum separation (controls non-overlap)
  vorRelaxIters: 1,     // optional mild relax
  vorRadiusJitter: 0.45,// 0..1 random radius variation
  vorWobbleFreq: 0.015, // noise frequency for boundary
  vorWobbleAmp: 0.35,   // 0..1 boundary wobble
  vorFill: 1.0,         // 0..1: smaller => smaller blobs inside cells
  maskResScale: 0.5,    // render mask at lower res for speed (0.25..1)
};

function setup() {
  const { w, h } = getAvailableCanvasSize();
  pixelDensity(ui.pixelDensity);
  const c = createCanvas(w, h);
  c.parent("wrap");

  buildPane();
  hookButtons();

  maskSystem = new DualMaskSystem();
  rebuildAll({ meshMask: true, tearMask: true, cloth: true });
}

function draw() {
  // Background / trails
  if (ui.bgAlpha >= 255) {
    background(11, 12, 14);
  } else {
    noStroke();
    fill(11, 12, 14, ui.bgAlpha);
    rect(0, 0, width, height);
  }

  if (!cloth) return;
  const isActive = cloth.update();

  // Mask overlays (debug)
  if (ui.showMeshMaskOverlay) maskSystem.drawOverlay("mesh", 70);
  if (ui.showTearMaskOverlay) maskSystem.drawOverlay("tear", 70);

  cloth.drawScreen();

  if (!isActive) {
    noLoop();
  }
}

function windowResized() {
  const { w, h } = getAvailableCanvasSize();
  resizeCanvas(w, h);
  queueRebuild({ meshMask: true, tearMask: true, cloth: true }, true);
}

/* ---------------- UI (Tweakpane) ---------------- */

function buildPane() {
  pane = new Tweakpane.Pane({ container: document.getElementById("pane") });

  const fGrid = pane.addFolder({ title: "Grid" });
  fGrid.addInput(ui, "cols", { min: 20, max: 220, step: 1 }).on("change", debounceClothRebuild);
  fGrid.addInput(ui, "rows", { min: 20, max: 260, step: 1 }).on("change", debounceClothRebuild);
  fGrid.addInput(ui, "spacing", { min: 4, max: 20, step: 1 }).on("change", debounceClothRebuild);
  fGrid.addInput(ui, "topOffset", { min: 0, max: 200, step: 1 }).on("change", debounceClothRebuild);
  fGrid.addInput(ui, "centerX", { min: 0, max: 1, step: 0.01 }).on("change", debounceClothRebuild);
  fGrid.addInput(ui, "centerY", { min: 0, max: 1, step: 0.01 }).on("change", debounceClothRebuild);

  const fAnchor = pane.addFolder({ title: "Anchoring" });
  fAnchor.addInput(ui, "anchorMode", { options: { none: "none", edge: "edge", all: "all" } }).on("change", debounceClothRebuild);
  fAnchor.addInput(ui, "edgeProbeMul", { min: 0.5, max: 2.5, step: 0.05 }).on("change", debounceClothRebuild);

  const fPhys = pane.addFolder({ title: "Physics" });
  fPhys.addInput(ui, "gravity", { min: -2.0, max: 2.0, step: 0.01 }).on("change", wakeSimulation);
  fPhys.addInput(ui, "damping", { min: 0.0, max: 0.999, step: 0.001 }).on("change", wakeSimulation);
  fPhys.addInput(ui, "stiffness", { min: 0.01, max: 1.0, step: 0.01 }).on("change", wakeSimulation);
  fPhys.addInput(ui, "iterations", { min: 1, max: 10, step: 1 }).on("change", wakeSimulation);

  const fCon = pane.addFolder({ title: "Constraint behavior" });
  fCon.addInput(ui, "shrinkFactor", { min: 0.2, max: 1.2, step: 0.01 }).on("change", wakeSimulation);
  fCon.addInput(ui, "tensionEnable").on("change", wakeSimulation);
  fCon.addInput(ui, "tensionFactor", { min: 1.0, max: 10.0, step: 0.05 }).on("change", wakeSimulation);
  fCon.addInput(ui, "tensionStrength", { min: 0.0, max: 1.0, step: 0.01 }).on("change", wakeSimulation);
  fCon.addInput(ui, "addDiagonals").on("change", debounceClothRebuild);

  const fInt = pane.addFolder({ title: "Interaction" });
  fInt.addInput(ui, "mode", { options: { drag: "drag", tear: "tear" } }).on("change", wakeSimulation);
  fInt.addInput(ui, "pickRadius", { min: 4, max: 80, step: 1 }).on("change", wakeSimulation);
  fInt.addInput(ui, "tearRadius", { min: 1, max: 30, step: 1 }).on("change", wakeSimulation);

  const fRen = pane.addFolder({ title: "Render" });
  fRen.addInput(ui, "bgAlpha", { min: 0, max: 255, step: 1 }).on("change", wakeSimulation);
  fRen.addInput(ui, "lineWeight", { min: 0.5, max: 4, step: 0.5 }).on("change", wakeSimulation);
  fRen.addInput(ui, "showPoints").on("change", wakeSimulation);
  fRen.addInput(ui, "showLocked").on("change", wakeSimulation);

  const fExp = pane.addFolder({ title: "Export" });
  fExp.addInput(ui, "svgStrokeWidth", { min: 0.25, max: 5, step: 0.25 }).on("change", wakeSimulation);
  fExp.addInput(ui, "exportPoints").on("change", wakeSimulation);

  const fRnd = pane.addFolder({ title: "Randomness" });
  fRnd.addInput(ui, "seed", { min: 1, max: 999999, step: 1 }).on("change", debounceSeededRebuild);
  fRnd.addInput(ui, "initJitter", { min: 0, max: 20, step: 0.5 }).on("change", debounceClothRebuild);
  fRnd.addInput(ui, "jitterScale", { min: 0.001, max: 0.2, step: 0.001 }).on("change", debounceClothRebuild);

  // ---- Masks ----
  const fMasks = pane.addFolder({ title: "Masks (Two Layers)" });

  const fMeshMask = fMasks.addFolder({ title: "Mesh Mask (where cloth exists)" });
  fMeshMask.addInput(ui, "meshMaskType", { options: { rectCircle: "rectCircle", voronoiBlobs: "voronoiBlobs" } })
    .on("change", debounceMeshMaskRebuild);
  fMeshMask.addInput(ui, "meshThreshold", { min: 1, max: 254, step: 1 }).on("change", debounceClothRebuild);
  fMeshMask.addInput(ui, "meshInvert").on("change", debounceClothRebuild);
  fMeshMask.addInput(ui, "showMeshMaskOverlay").on("change", wakeSimulation);

  const fTearMask = fMasks.addFolder({ title: "Tear Mask (pre-cut)" });
  fTearMask.addInput(ui, "tearMaskType", { options: { rectCircle: "rectCircle", voronoiBlobs: "voronoiBlobs" } })
    .on("change", debounceTearMaskRebuild);
  fTearMask.addInput(ui, "tearThreshold", { min: 1, max: 254, step: 1 }).on("change", debounceClothRebuild);
  fTearMask.addInput(ui, "tearInvert").on("change", debounceClothRebuild);
  fTearMask.addInput(ui, "showTearMaskOverlay").on("change", wakeSimulation);
  fTearMask.addInput(ui, "applyTearOnBuild").on("change", debounceClothRebuild);
  fTearMask.addInput(ui, "tearAffects", { options: { constraints: "constraints", "points+constraints": "points+constraints" } })
    .on("change", debounceClothRebuild);

  const fRectCirc = fMasks.addFolder({ title: "Rect+Circle Params" });
  fRectCirc.addInput(ui, "rectX", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "rectY", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "rectW", { min: 0.05, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "rectH", { min: 0.05, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "rectCircleShowCircle").on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "circX", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "circY", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fRectCirc.addInput(ui, "circR", { min: 0.02, max: 0.6, step: 0.01 }).on("change", debounceAllMasksRebuild);

  const fVor = fMasks.addFolder({ title: "Voronoi Blobs Params" });
  fVor.addInput(ui, "maskResScale", { min: 0.25, max: 1.0, step: 0.05 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorSeeds", { min: 3, max: 140, step: 1 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorPadding", { min: 0, max: 200, step: 1 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorMinSep", { min: 4, max: 200, step: 1 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorRelaxIters", { min: 0, max: 6, step: 1 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorRadiusJitter", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorFill", { min: 0.1, max: 1.0, step: 0.01 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorWobbleFreq", { min: 0.001, max: 0.06, step: 0.001 }).on("change", debounceAllMasksRebuild);
  fVor.addInput(ui, "vorWobbleAmp", { min: 0, max: 1, step: 0.01 }).on("change", debounceAllMasksRebuild);
}

function debounceClothRebuild() {
  queueRebuild({ cloth: true });
}

function debounceMeshMaskRebuild() {
  queueRebuild({ meshMask: true, cloth: true });
}

function debounceTearMaskRebuild() {
  queueRebuild({ tearMask: true, cloth: true });
}

function debounceAllMasksRebuild() {
  queueRebuild({ meshMask: true, tearMask: true, cloth: true });
}

function debounceSeededRebuild() {
  queueRebuild({
    meshMask: ui.meshMaskType === "voronoiBlobs",
    tearMask: ui.tearMaskType === "voronoiBlobs",
    cloth: true,
  });
}

function queueRebuild(flags = REBUILD_FLAGS, immediate = false) {
  pendingRebuild = {
    meshMask: (pendingRebuild?.meshMask || false) || !!flags.meshMask,
    tearMask: (pendingRebuild?.tearMask || false) || !!flags.tearMask,
    cloth: (pendingRebuild?.cloth || false) || !!flags.cloth,
  };

  wakeSimulation();
  if (immediate) {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = null;
    flushRebuild();
    return;
  }

  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(flushRebuild, 120);
}

function flushRebuild() {
  rebuildTimer = null;
  rebuildAll(pendingRebuild || { cloth: true });
  pendingRebuild = null;
}

/* ---------------- Buttons ---------------- */

function hookButtons() {
  const rb = document.getElementById("randomBtn");
  if (rb) {
    rb.addEventListener("click", () => {
      ui.seed = Math.floor(1 + Math.random() * 999999);
      pane.refresh();
      queueRebuild({
        meshMask: ui.meshMaskType === "voronoiBlobs",
        tearMask: ui.tearMaskType === "voronoiBlobs",
        cloth: true,
      }, true);
    });
  }

  const regenBtn = document.getElementById("regenBtn");
  if (regenBtn) regenBtn.addEventListener("click", () => queueRebuild({ meshMask: true, tearMask: true, cloth: true }, true));

  const pngBtn = document.getElementById("pngBtn");
  if (pngBtn) pngBtn.addEventListener("click", () => saveCanvas("masked-cloth", "png"));

  const svgBtn = document.getElementById("svgBtn");
  if (svgBtn) svgBtn.addEventListener("click", () => exportSVG());
}

/* ---------------- Build / Rebuild ---------------- */

function rebuildAll(flags = REBUILD_FLAGS) {
  const needsMeshMask = !maskSystem.mesh.sampler || flags.meshMask;
  const needsTearMask = !maskSystem.tear.sampler || flags.tearMask;

  if (needsMeshMask) {
    maskSystem.rebuildLayer("mesh", width, height);
  }
  if (needsTearMask) {
    maskSystem.rebuildLayer("tear", width, height);
  }

  if (flags.cloth || !cloth || needsMeshMask || (ui.applyTearOnBuild && needsTearMask)) {
    cloth = createCloth();
  }

  wakeSimulation();
}

function createCloth() {
  const next = new Cloth({
    cols: ui.cols,
    rows: ui.rows,
    spacing: ui.spacing,
    topOffset: ui.topOffset,
    centerX: ui.centerX,
    centerY: ui.centerY,
    meshSampler: maskSystem.mesh.sampler,
    meshThreshold: ui.meshThreshold,
    meshInvert: ui.meshInvert,
    tearSampler: maskSystem.tear.sampler,
    tearThreshold: ui.tearThreshold,
    tearInvert: ui.tearInvert,
    anchorMode: ui.anchorMode,
    edgeProbe: ui.spacing * ui.edgeProbeMul,
    addDiagonals: ui.addDiagonals,
    seed: ui.seed,
    initJitter: ui.initJitter,
    jitterScale: ui.jitterScale,
  });

  if (ui.applyTearOnBuild) {
    next.applyTearMask(ui.tearAffects);
  }

  return next;
}

/* ---------------- Interaction ---------------- */

let picked = null;

function mousePressed() {
  if (!cloth) return;
  if (!inCanvas(mouseX, mouseY)) return;

  const mode = (keyIsDown(67) ? "tear" : ui.mode); // hold 'C' to tear
  if (mode === "drag") {
    picked = cloth.pickNearest(mouseX, mouseY, ui.pickRadius);
    wakeSimulation();
  } else {
    picked = null;
  }
}

function mouseDragged() {
  if (!cloth) return;
  if (!inCanvas(mouseX, mouseY)) return;

  const mode = (keyIsDown(67) ? "tear" : ui.mode);
  if (mode === "drag") {
    if (picked) {
      picked.pos.set(mouseX, mouseY);
      picked.prev.set(mouseX, mouseY);
      wakeSimulation();
    }
  } else {
    cloth.tear(mouseX, mouseY, ui.tearRadius);
    wakeSimulation();
  }
}

function mouseReleased() {
  picked = null;
}

function keyPressed() {
  if (key === "r" || key === "R") queueRebuild({ meshMask: true, tearMask: true, cloth: true }, true);
  if (key === "s" || key === "S") exportSVG();
}

function inCanvas(x, y) {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

/* ---------------- SVG export ---------------- */

function exportSVG() {
  if (!cloth) return;

  const w = width, h = height;
  const sw = ui.svgStrokeWidth;

  const linesV = [];
  const linesH = [];

  for (const c of cloth.constraints) {
    const x1 = c.p1.pos.x, y1 = c.p1.pos.y;
    const x2 = c.p2.pos.x, y2 = c.p2.pos.y;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);

    const el = `<line x1="${ExportUtils.fmt(x1)}" y1="${ExportUtils.fmt(y1)}" x2="${ExportUtils.fmt(x2)}" y2="${ExportUtils.fmt(y2)}" />`;
    if (dy > dx) linesV.push(el);
    else linesH.push(el);
  }

  const pts = ui.exportPoints
    ? cloth.points
      .filter((p) => !p.dead)
      .map((p) => `<circle cx="${ExportUtils.fmt(p.pos.x)}" cy="${ExportUtils.fmt(p.pos.y)}" r="${ExportUtils.fmt(sw)}" />`)
      .join("\n")
    : "";

  const svg =
`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <g id="vertical" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
${linesV.join("\n")}
  </g>
  <g id="horizontal" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
${linesH.join("\n")}
  </g>
  <g id="points" fill="#000" stroke="none">
${pts}
  </g>
</svg>`;

  ExportUtils.downloadText(svg, `masked-cloth_${Date.now()}.svg`, "image/svg+xml");
}

/* ---------------- Dual Mask System (TWO masks) ---------------- */

class DualMaskSystem {
  constructor() {
    this.mesh = new MaskLayer("mesh");
    this.tear = new MaskLayer("tear");
  }

  rebuildLayer(which, w, h) {
    if (which === "mesh") {
      this.mesh.rebuild(w, h, ui.meshMaskType);
      return;
    }
    this.tear.rebuild(w, h, ui.tearMaskType);
  }

  drawOverlay(which, alpha = 70) {
    const layer = (which === "tear") ? this.tear : this.mesh;
    if (!layer || !layer.buffer) return;
    push();
    tint(255, alpha);
    image(layer.buffer, 0, 0, width, height);
    noTint();
    pop();
  }
}

class MaskLayer {
  constructor(name) {
    this.name = name;
    this.buffer = null;
    this.sampler = null;
    this.work = null;
    this._w = -1;
    this._h = -1;
    this._workW = -1;
    this._workH = -1;
    this._signature = "";
  }

  rebuild(w, h, type) {
    const signature = this.getSignature(w, h, type);
    if (signature === this._signature && this.sampler) {
      return;
    }

    if (!this.buffer || this._w !== w || this._h !== h) {
      this.buffer = createGraphics(w, h);
      this.buffer.pixelDensity(1);
      this._w = w;
      this._h = h;
    }

    // Build mask generator
    const mask = MaskFactory.create(type);

    // Render into an internal working buffer (optionally lower res) then scale up
    const resScale = clamp(ui.maskResScale, 0.25, 1.0);
    const mw = Math.max(16, Math.floor(w * resScale));
    const mh = Math.max(16, Math.floor(h * resScale));
    if (!this.work || this._workW !== mw || this._workH !== mh) {
      if (this.work) this.work.remove();
      this.work = createGraphics(mw, mh);
      this.work.pixelDensity(1);
      this._workW = mw;
      this._workH = mh;
    }

    this.work.clear();
    this.work.background(255);
    mask.draw(this.work, this);

    // Scale to full size (nearest neighbor)
    // For masks, nearest-neighbor scaling is fine (it preserves hard edges).
    this.buffer.clear();
    this.buffer.noSmooth();
    this.buffer.image(this.work, 0, 0, w, h);

    this.buffer.loadPixels();
    this.sampler = new MaskSampler(this.buffer);
    this._signature = signature;
  }

  getSignature(w, h, type) {
    const parts = [
      this.name,
      w,
      h,
      type,
      ui.maskResScale,
      ui.seed,
      ui.rectX,
      ui.rectY,
      ui.rectW,
      ui.rectH,
      ui.circX,
      ui.circY,
      ui.circR,
      ui.rectCircleShowCircle,
      ui.vorSeeds,
      ui.vorPadding,
      ui.vorMinSep,
      ui.vorRelaxIters,
      ui.vorRadiusJitter,
      ui.vorWobbleFreq,
      ui.vorWobbleAmp,
      ui.vorFill,
    ];
    return parts.join("|");
  }
}

/* ---------------- Mask Factory + Masks ---------------- */

class MaskFactory {
  static create(type) {
    if (type === "voronoiBlobs") return new VoronoiBlobsMask();
    return new RectCircleMask();
  }
}

class MaskBase {
  draw(g) {}
}

/* Rect+Circle mask */
class RectCircleMask extends MaskBase {
  draw(g) {
    g.noStroke();
    g.fill(0);

    const rx = ui.rectX * g.width;
    const ry = ui.rectY * g.height;
    const rw = ui.rectW * g.width;
    const rh = ui.rectH * g.height;

    const cx = ui.circX * g.width;
    const cy = ui.circY * g.height;
    const cr = ui.circR * Math.min(g.width, g.height);

    g.rect(rx, ry, rw, rh);
    if (ui.rectCircleShowCircle) g.ellipse(cx, cy, cr * 2, cr * 2);
  }
}

/* Non-overlapping varied-size Voronoi blobs
   - Seeds placed by Poisson-disc min separation => no overlap of influence centers
   - Each pixel belongs to its nearest seed => blobs never overlap
   - Each seed has its own target radius derived from neighbor distance + jitter
   - Organic boundary via noise wobble
*/
class VoronoiBlobsMask extends MaskBase {
  draw(g, layer) {
    const pad = Math.max(0, ui.vorPadding);
    const seeds = getVoronoiSeeds(layer, g.width, g.height, pad);

    g.loadPixels();
    const w = g.width;
    const h = g.height;
    const px = g.pixels;

    const freq = Math.max(0.0001, ui.vorWobbleFreq);
    const amp = clamp01(ui.vorWobbleAmp);
    const fill = clamp(ui.vorFill, 0.1, 1.0);

    const seedCount = seeds.length;
    const sx = new Float32Array(seedCount);
    const sy = new Float32Array(seedCount);
    const sr2 = new Float32Array(seedCount);
    for (let i = 0; i < seedCount; i++) {
      sx[i] = seeds[i].x;
      sy[i] = seeds[i].y;
      const radius = seeds[i].r * fill;
      sr2[i] = radius * radius;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < seedCount; i++) {
          const dx = x - sx[i];
          const dy = y - sy[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }

        const n = noise((x + sx[best] * 0.37) * freq, (y + sy[best] * 0.37) * freq);
        const wobble = 1 + (n - 0.5) * 2 * amp;
        const ink = bestD2 <= sr2[best] * wobble * wobble;

        const idx = 4 * (y * w + x);
        const v = ink ? 0 : 255;
        px[idx] = v;
        px[idx + 1] = v;
        px[idx + 2] = v;
        px[idx + 3] = 255;
      }
    }

    g.updatePixels();
  }
}

/* ---------------- Poisson-disc seed generation ---------------- */

function poissonSeeds(w, h, pad, minSep, targetCount, seed) {
  randomSeed(seed);

  const pts = [];
  const attempts = Math.max(500, targetCount * 50);
  const minD2 = minSep * minSep;

  // Simple dart throwing. For your seed counts this is fine and deterministic.
  for (let k = 0; k < attempts && pts.length < targetCount; k++) {
    const x = random(pad, w - pad);
    const y = random(pad, h - pad);

    let ok = true;
    for (let i = 0; i < pts.length; i++) {
      const dx = x - pts[i].x;
      const dy = y - pts[i].y;
      if (dx * dx + dy * dy < minD2) { ok = false; break; }
    }
    if (ok) pts.push({ x, y, r: 10 });
  }

  return pts;
}

function relaxSeeds(seeds, w, h, pad) {
  // Mild repulsion
  const n = seeds.length;
  if (n < 2) return;

  const push = 0.15;
  for (let i = 0; i < n; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = seeds[i].x - seeds[j].x;
      const dy = seeds[i].y - seeds[j].y;
      const d2 = dx * dx + dy * dy + 1e-6;
      const inv = 1 / d2;
      fx += dx * inv;
      fy += dy * inv;
    }
    seeds[i].x = clamp(seeds[i].x + fx * push, pad, w - pad);
    seeds[i].y = clamp(seeds[i].y + fy * push, pad, h - pad);
  }
}

function computeSeedRadii(seeds) {
  randomSeed(ui.seed);
  const n = seeds.length;
  if (n === 0) return;

  for (let i = 0; i < n; i++) {
    let nn = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = seeds[j].x - seeds[i].x;
      const dy = seeds[j].y - seeds[i].y;
      const d = Math.hypot(dx, dy);
      if (d < nn) nn = d;
    }
    // Base radius from nearest neighbor distance
    let r = isFinite(nn) ? nn * 0.48 : ui.vorMinSep * 0.5;

    // Add radius jitter (varied sizes)
    const j = (random() - 0.5) * 2 * clamp01(ui.vorRadiusJitter);
    r *= (1 + 0.6 * j);

    // Clamp to something sensible relative to minSep
    const rMin = Math.max(4, ui.vorMinSep * 0.22);
    const rMax = Math.max(rMin + 1, ui.vorMinSep * 0.95);
    seeds[i].r = clamp(r, rMin, rMax);
  }
}

/* ---------------- Core: MaskSampler ---------------- */

class MaskSampler {
  constructor(gfx) {
    this.g = gfx;
    this.w = gfx.width;
    this.h = gfx.height;
    this.px = gfx.pixels; // RGBA
  }

  brightnessAt(x, y) {
    const xi = Math.max(0, Math.min(this.w - 1, x | 0));
    const yi = Math.max(0, Math.min(this.h - 1, y | 0));
    const idx = 4 * (yi * this.w + xi);
    return this.px[idx];
  }

  isInk(x, y, threshold, invert) {
    const br = this.brightnessAt(x, y);
    const ink = br < threshold;
    return invert ? !ink : ink;
  }
}

/* ---------------- Core: Cloth Simulation ---------------- */

class Cloth {
  constructor(opts) {
    this.points = [];
    this.constraints = [];

    const {
      cols, rows, spacing,
      topOffset, centerX, centerY,

      meshSampler, meshThreshold, meshInvert,
      tearSampler, tearThreshold, tearInvert,

      anchorMode, edgeProbe,
      addDiagonals,

      seed, initJitter, jitterScale,
    } = opts;

    this.meshSampler = meshSampler;
    this.meshThreshold = meshThreshold;
    this.meshInvert = meshInvert;

    this.tearSampler = tearSampler;
    this.tearThreshold = tearThreshold;
    this.tearInvert = tearInvert;

    const idxGrid = Array.from({ length: rows }, () => new Array(cols).fill(-1));

    const gridW = cols * spacing;
    const gridH = rows * spacing;
    const ox = (centerX * width) - gridW * 0.5;
    const oy = (centerY * height) - gridH * 0.5 + topOffset;

    noiseSeed(seed);

    // 1) points from MESH MASK
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const px = ox + gx * spacing;
        const py = oy + gy * spacing;

        if (!meshSampler.isInk(px, py, meshThreshold, meshInvert)) continue;

        const locked = this.computeLocked(meshSampler, px, py, spacing, meshThreshold, meshInvert, anchorMode, edgeProbe);

        let jx = 0, jy = 0;
        if (initJitter > 0) {
          const n1 = noise(px * jitterScale, py * jitterScale);
          const n2 = noise((px + 999.3) * jitterScale, (py - 333.7) * jitterScale);
          jx = (n1 - 0.5) * 2 * initJitter;
          jy = (n2 - 0.5) * 2 * initJitter;
        }

        const p = new Point(px + jx, py + jy, locked);
        const id = this.points.length;
        this.points.push(p);
        idxGrid[gy][gx] = id;
      }
    }

    // 2) constraints
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = idxGrid[gy][gx];
        if (i === -1) continue;

        // right
        if (gx < cols - 1) {
          const j = idxGrid[gy][gx + 1];
          if (j !== -1) this.constraints.push(new Constraint(this.points[i], this.points[j], spacing));
        }

        // down
        if (gy < rows - 1) {
          const j = idxGrid[gy + 1][gx];
          if (j !== -1) this.constraints.push(new Constraint(this.points[i], this.points[j], spacing));
        }

        // diagonals
        if (addDiagonals) {
          if (gx < cols - 1 && gy < rows - 1) {
            const j = idxGrid[gy + 1][gx + 1];
            if (j !== -1) this.constraints.push(new Constraint(this.points[i], this.points[j], Math.sqrt(2) * spacing));
          }
          if (gx > 0 && gy < rows - 1) {
            const j = idxGrid[gy + 1][gx - 1];
            if (j !== -1) this.constraints.push(new Constraint(this.points[i], this.points[j], Math.sqrt(2) * spacing));
          }
        }
      }
    }
  }

  computeLocked(maskSampler, px, py, spacing, threshold, invert, anchorMode, edgeProbe) {
    if (anchorMode === "none") return false;
    if (anchorMode === "all") return true;

    const s = edgeProbe;
    const isEdge =
      !maskSampler.isInk(px + s, py, threshold, invert) ||
      !maskSampler.isInk(px - s, py, threshold, invert) ||
      !maskSampler.isInk(px, py + s, threshold, invert) ||
      !maskSampler.isInk(px, py - s, threshold, invert);

    return isEdge;
  }

  applyTearMask(mode = "constraints") {
    if (!this.tearSampler) return;

    // Optionally remove points inside tear mask (and implicitly their constraints)
    if (mode === "points+constraints") {
      for (const p of this.points) {
        if (p.locked) continue;
        const inTear = this.tearSampler.isInk(p.pos.x, p.pos.y, this.tearThreshold, this.tearInvert);
        if (inTear) p.dead = true;
      }
    }

    // Remove constraints whose midpoint is inside tear mask OR touches dead points
    for (let i = this.constraints.length - 1; i >= 0; i--) {
      const c = this.constraints[i];
      if (c.p1.dead || c.p2.dead) {
        this.constraints.splice(i, 1);
        continue;
      }
      const mx = (c.p1.pos.x + c.p2.pos.x) * 0.5;
      const my = (c.p1.pos.y + c.p2.pos.y) * 0.5;
      const inTear = this.tearSampler.isInk(mx, my, this.tearThreshold, this.tearInvert);
      if (inTear) this.constraints.splice(i, 1);
    }
  }

  update() {
    const g = ui.gravity;
    const damp = ui.damping;
    let maxSpeed2 = 0;

    for (const p of this.points) {
      if (p.locked || p.dead) continue;

      const vx = (p.pos.x - p.prev.x) * damp;
      const vy = (p.pos.y - p.prev.y) * damp;

      p.prev.set(p.pos);
      p.pos.x += vx;
      p.pos.y += vy + g;
      const speed2 = vx * vx + vy * vy;
      if (speed2 > maxSpeed2) maxSpeed2 = speed2;

      p.pos.x = Math.max(0, Math.min(width, p.pos.x));
      p.pos.y = Math.max(0, Math.min(height, p.pos.y));
    }

    for (let k = 0; k < ui.iterations; k++) {
      for (const c of this.constraints) c.solve();
    }

    return maxSpeed2 > 0.0005;
  }

  drawScreen() {
    stroke(200);
    strokeWeight(ui.lineWeight);
    noFill();

    for (const c of this.constraints) {
      if (c.p1.dead || c.p2.dead) continue;
      line(c.p1.pos.x, c.p1.pos.y, c.p2.pos.x, c.p2.pos.y);
    }

    if (ui.showPoints || ui.showLocked) {
      noStroke();
      for (const p of this.points) {
        if (p.dead) continue;
        if (ui.showLocked && p.locked) {
          fill(255);
          circle(p.pos.x, p.pos.y, 4);
        } else if (ui.showPoints) {
          fill(180);
          circle(p.pos.x, p.pos.y, 2.5);
        }
      }
    }
  }

  pickNearest(mx, my, r) {
    let best = null;
    let bestD2 = r * r;

    for (const p of this.points) {
      if (p.dead) continue;
      const dx = p.pos.x - mx;
      const dy = p.pos.y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  tear(mx, my, radius) {
    const radius2 = radius * radius;
    this.constraints = this.constraints.filter(
      (c) => distToSegmentSquared(mx, my, c.p1.pos.x, c.p1.pos.y, c.p2.pos.x, c.p2.pos.y) > radius2,
    );
  }
}

class Point {
  constructor(x, y, locked = false) {
    this.pos = createVector(x, y);
    this.prev = this.pos.copy();
    this.locked = locked;
    this.dead = false;
  }
}

class Constraint {
  constructor(p1, p2, restLength) {
    this.p1 = p1;
    this.p2 = p2;
    this.restLength = restLength;
  }

  solve() {
    if (this.p1.dead || this.p2.dead) return;

    const dx = this.p2.pos.x - this.p1.pos.x;
    const dy = this.p2.pos.y - this.p1.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) return;
    const d = Math.sqrt(d2);

    const target = this.restLength * ui.shrinkFactor;
    const diff = ((d - target) / d) * ui.stiffness;
    const adjustX = dx * 0.5 * diff;
    const adjustY = dy * 0.5 * diff;

    if (!this.p1.locked) {
      this.p1.pos.x += adjustX;
      this.p1.pos.y += adjustY;
    }
    if (!this.p2.locked) {
      this.p2.pos.x -= adjustX;
      this.p2.pos.y -= adjustY;
    }

    if (ui.tensionEnable) {
      const limit = ui.tensionFactor * this.restLength;
      if (d > limit) {
        const excess = d - limit;
        const pullScale = (excess * ui.tensionStrength * 0.5) / d;
        const pullX = dx * pullScale;
        const pullY = dy * pullScale;
        if (!this.p1.locked) {
          this.p1.pos.x += pullX;
          this.p1.pos.y += pullY;
        }
        if (!this.p2.locked) {
          this.p2.pos.x -= pullX;
          this.p2.pos.y -= pullY;
        }
      }
    }
  }
}

/* ---------------- Utils ---------------- */

function distToSegmentSquared(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return sq(px - x1) + sq(py - y1);

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return sq(px - x2) + sq(py - y2);

  const t = c1 / c2;
  const projx = x1 + t * vx;
  const projy = y1 + t * vy;
  return sq(px - projx) + sq(py - projy);
}

function getAvailableCanvasSize() {
  const wrap = document.getElementById("wrap");
  const r = wrap.getBoundingClientRect();
  const w = Math.max(320, Math.floor(r.width));
  const h = Math.max(320, Math.floor(r.height));
  return { w, h };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function sq(v) { return v * v; }

function getVoronoiSeeds(layer, w, h, pad) {
  const signature = [
    w,
    h,
    pad,
    ui.seed,
    ui.vorSeeds,
    ui.vorMinSep,
    ui.vorRelaxIters,
    ui.vorRadiusJitter,
  ].join("|");

  if (layer._seedSignature === signature && layer._seeds) {
    return layer._seeds;
  }

  const seeds = poissonSeeds(w, h, pad, ui.vorMinSep, ui.vorSeeds, ui.seed);
  for (let it = 0; it < Math.max(0, Math.floor(ui.vorRelaxIters)); it++) {
    relaxSeeds(seeds, w, h, pad);
  }
  computeSeedRadii(seeds);

  layer._seeds = seeds;
  layer._seedSignature = signature;
  return seeds;
}

function wakeSimulation() {
  if (!isLooping()) {
    loop();
  }
}
