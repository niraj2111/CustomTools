const ALIGN_OPTIONS = {
  Left: "left",
  Center: "center",
  Right: "right",
};

const NIB_MODE_OPTIONS = {
  Fixed: "fixed",
  Proportional: "proportional",
};

const UPM = 1000;
const MIN_RATIO = 0.02;
const NIB_SEGS = 24;
const ITALIC_SHEAR = 0.22;

function fmt(value, digits = 3) {
  return ExportUtils.fmt(value, digits);
}

function escapeHTML(value) {
  return ExportUtils.escapeXML(value);
}

let pane;
let canvas;
let ctx;
let wrapEl;
let variantMenuEl;
let boxTextInputEl;
let paperFolder;
let sceneFolder;
let fontFolder;
let boxFolder;
let fontBinding;
let selectedBoxBindings;
let actionBindings = {};
let cachedLayouts = [];
let activeBoxId = null;
let nextBoxId = 1;
let dragState = null;
let hoverHandle = null;
let hoverGlyphKey = null;
let lastClickMs = 0;
let renderQueued = false;
const glyphArtworkCache = new Map();

const P = {
  paperPreset: "A4 Portrait",
  canvasWMM: 210,
  canvasHMM: 297,
  dpi: 96,
  previewScale: 1,
  fitToViewport: true,
  paperColor: "#f7f1e8",
  marginColor: "#d0ba97",
  guideColor: "#dbc9ad",
  frameColor: "#2454a6",
  frameInactiveColor: "#69819f",
  handleColor: "#f76b2c",
  textColor: "#1e2430",
  selectionFill: "rgba(36, 84, 166, 0.08)",
  showMargins: true,
  marginMM: 14,
  showGuides: true,
  guideSpacingMM: 8,
  bgColor: "#0c1016",
  svgFilename: "CalligraphyComposer.svg",
  fontId: "italics",
  showSkeletonOverlay: false,
};

const FALLBACK_FONT_SIZE_MM = 18;
const FALLBACK_LINE_HEIGHT_MM = 19.26;

const state = {
  projectFonts: {},
  fontDocs: {},
  currentDoc: null,
  loadingFont: false,
  fontError: "",
  hoveredGlyphItem: null,
  activeGlyphItem: null,
  variantMenu: { boxId: null, key: null, anchorPx: null },
  boxes: [
    createTextBox({
      xMM: 24,
      yMM: 36,
      widthMM: 120,
      heightMM: 92,
      text: "Calligraphy is measured on paper first, then styled.",
      fontSizeMM: FALLBACK_FONT_SIZE_MM,
      lineHeightMM: FALLBACK_LINE_HEIGHT_MM,
    }),
  ],
};

const selectionState = {
  activeName: "Box 1",
  text: "",
  fontSizeMM: FALLBACK_FONT_SIZE_MM,
  lineHeightMM: FALLBACK_LINE_HEIGHT_MM,
  paddingMM: 5,
  trackingMM: 0,
  align: "left",
  slantShear: 0,
  verticalScale: 1,
  penId: "p4",
  nibMode: "fixed",
  nibWidthMM: 2.4,
};

window.addEventListener("load", () => {
  PaperUtils.applyPaperPreset(P, P.paperPreset);
  createCanvas();
  buildPane();
  bindUI();
  syncCanvasSize();
  initFonts();
  refreshSelectionMonitor();
  requestRender();
  window.addEventListener("resize", syncDisplaySize);
});

function createCanvas() {
  wrapEl = document.getElementById("wrap");
  boxTextInputEl = document.getElementById("boxTextInput");
  canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "CalligraphyComposer canvas");
  ctx = canvas.getContext("2d");
  wrapEl.appendChild(canvas);
  variantMenuEl = document.createElement("div");
  variantMenuEl.className = "variant-menu";
  wrapEl.appendChild(variantMenuEl);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onHoverPointerMove);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  variantMenuEl.addEventListener("pointerleave", onHoverPointerLeave);
}

function buildPane() {
  pane = new Tweakpane.Pane({ container: document.getElementById("pane") });

  paperFolder = pane.addFolder({ title: "Paper", expanded: true });
  paperFolder
    .addInput(P, "paperPreset", {
      label: "Preset",
      options: Object.keys(PaperUtils.PAPER_PRESETS_MM).reduce((acc, label) => {
        acc[label] = label;
        return acc;
      }, {}),
    })
    .on("change", (ev) => {
      PaperUtils.applyPaperPreset(P, ev.value);
      syncCanvasSize();
    });
  paperFolder
    .addInput(P, "canvasWMM", { label: "Width", min: 60, max: 1000, step: 1 })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      syncCanvasSize();
    });
  paperFolder
    .addInput(P, "canvasHMM", { label: "Height", min: 60, max: 1000, step: 1 })
    .on("change", () => {
      PaperUtils.syncPresetFromSize(P);
      syncCanvasSize();
    });
  paperFolder
    .addInput(P, "dpi", { label: "DPI", min: 36, max: 1200, step: 1 })
    .on("change", syncCanvasSize);
  paperFolder.addInput(P, "fitToViewport", { label: "Fit preview" }).on("change", syncDisplaySize);
  paperFolder
    .addInput(P, "previewScale", { label: "Zoom", min: 0.2, max: 4, step: 0.01 })
    .on("change", syncDisplaySize);
  paperFolder.addInput(P, "marginMM", { label: "Margin", min: 0, max: 80, step: 0.5 }).on(
    "change",
    requestRender,
  );
  paperFolder.addInput(P, "showMargins", { label: "Show margins" }).on("change", requestRender);

  sceneFolder = pane.addFolder({ title: "Guides", expanded: false });
  sceneFolder.addInput(P, "showGuides", { label: "Show guides" }).on("change", requestRender);
  sceneFolder.addInput(P, "guideSpacingMM", { label: "Guide gap", min: 2, max: 40, step: 0.5 }).on(
    "change",
    requestRender,
  );
  sceneFolder.addInput(P, "showSkeletonOverlay", { label: "Show skeleton" }).on("change", requestRender);

  fontFolder = pane.addFolder({ title: "Stroke Font", expanded: true });
  buildFontBinding({ italics: "italics" });

  boxFolder = pane.addFolder({ title: "Selected text box", expanded: true });
  selectedBoxBindings = {
    activeName: boxFolder.addMonitor(selectionState, "activeName", { label: "Active" }),
    fontSizeMM: boxFolder.addInput(selectionState, "fontSizeMM", {
      label: "Letter size",
      min: 4,
      max: 80,
      step: 0.1,
    }),
    lineHeightMM: boxFolder.addInput(selectionState, "lineHeightMM", {
      label: "Line height",
      min: 2,
      max: 120,
      step: 0.01,
    }),
    paddingMM: boxFolder.addInput(selectionState, "paddingMM", {
      label: "Padding",
      min: 0,
      max: 30,
      step: 0.25,
    }),
    trackingMM: boxFolder.addInput(selectionState, "trackingMM", {
      label: "Tracking",
      min: -10,
      max: 20,
      step: 0.01,
    }),
    slantShear: boxFolder.addInput(selectionState, "slantShear", {
      label: "Slant shear",
      min: -0.8,
      max: 0.8,
      step: 0.01,
    }),
    verticalScale: boxFolder.addInput(selectionState, "verticalScale", {
      label: "Vertical scale",
      min: 0.2,
      max: 3,
      step: 0.01,
    }),
    penId: boxFolder.addInput(selectionState, "penId", {
      label: "Pen",
      options: {
        "Parallel 2.4": "p4",
        "Parallel 3.8": "p5",
        "Micron 03": "p1",
      },
    }),
    nibMode: boxFolder.addInput(selectionState, "nibMode", {
      label: "Nib mode",
      options: NIB_MODE_OPTIONS,
    }),
    nibWidthMM: boxFolder.addInput(selectionState, "nibWidthMM", {
      label: "Nib width",
      min: 0.1,
      max: 20,
      step: 0.05,
    }),
  };

  actionBindings.alignLeft = boxFolder.addButton({ title: "L" });
  actionBindings.alignCenter = boxFolder.addButton({ title: "C" });
  actionBindings.alignRight = boxFolder.addButton({ title: "R" });
  layoutActionButtonsRow();
  actionBindings.alignLeft.on("click", () => setAlignment("left"));
  actionBindings.alignCenter.on("click", () => setAlignment("center"));
  actionBindings.alignRight.on("click", () => setAlignment("right"));

  for (const [key, blade] of Object.entries(selectedBoxBindings)) {
    if (key === "activeName") continue;
    blade.on("change", () => {
      if (key === "penId") {
        syncNibWidthToPen();
      }
      if (key === "nibMode") {
        syncNibWidthToPen();
      }
      if (key === "fontSizeMM" && selectionState.nibMode === "proportional") {
        syncNibWidthToPen();
      }
      applySelectionStateToBox();
      requestRender();
    });
  }
}

function bindUI() {
  boxTextInputEl?.addEventListener("input", () => {
    selectionState.text = boxTextInputEl.value;
    applySelectionStateToBox();
    trimVariantMap(getActiveBox());
    requestRender();
  });

  document.getElementById("addBoxBtn").addEventListener("click", () => {
    const doc = state.currentDoc;
    const next = createTextBox({
      xMM: 20 + state.boxes.length * 8,
      yMM: 20 + state.boxes.length * 8,
      text: "New calligraphy text box",
      fontSizeMM: doc ? doc.physicalEmMm : FALLBACK_FONT_SIZE_MM,
      lineHeightMM: doc ? defaultLineHeightMMForDoc(doc) : FALLBACK_LINE_HEIGHT_MM,
      penId: doc?.activePen || "p4",
      nibMode: "fixed",
      nibWidthMM: doc?.pens.find((pen) => pen.id === (doc?.activePen || "p4"))?.mm ?? 2.4,
      trackingMM: 0,
    });
    state.boxes.push(next);
    activeBoxId = next.id;
    refreshSelectionMonitor();
    requestRender();
  });

  document.getElementById("duplicateBoxBtn").addEventListener("click", () => {
    const source = getActiveBox();
    if (!source) return;
    const copy = createTextBox({
      ...source,
      xMM: source.xMM + 8,
      yMM: source.yMM + 8,
      name: `${source.name} Copy`,
    });
    state.boxes.push(copy);
    activeBoxId = copy.id;
    refreshSelectionMonitor();
    requestRender();
  });

  document.getElementById("deleteBoxBtn").addEventListener("click", () => {
    if (state.boxes.length <= 1) return;
    const index = state.boxes.findIndex((box) => box.id === activeBoxId);
    if (index < 0) return;
    state.boxes.splice(index, 1);
    activeBoxId = state.boxes[Math.max(0, index - 1)].id;
    refreshSelectionMonitor();
    requestRender();
  });

  document.getElementById("fitBtn").addEventListener("click", () => {
    P.fitToViewport = true;
    P.previewScale = 1;
    syncDisplaySize();
    pane.refresh();
  });

  document.getElementById("resetViewBtn").addEventListener("click", () => {
    P.fitToViewport = false;
    P.previewScale = 1;
    syncDisplaySize();
    pane.refresh();
  });

  document.getElementById("svgBtn").addEventListener("click", exportSvg);
  document.getElementById("pathSvgBtn").addEventListener("click", exportPathSvg);
}

function syncCanvasSize() {
  const size = PaperUtils.getCanvasPixelSize(P);
  canvas.width = size.width;
  canvas.height = size.height;
  syncDisplaySize();
  requestRender();
}

function syncDisplaySize() {
  PaperUtils.updateCanvasDisplaySize(
    {
      style(name, value) {
        canvas.style[name] = value;
      },
    },
    P,
    "wrap",
    36,
  );
  requestRender();
}

async function initFonts() {
  try {
    state.projectFonts = await loadProjectFonts();
    syncCurrentFontId();
    rebuildFontBinding();
    await ensureCurrentFontDoc();
    state.fontError = "";
  } catch (error) {
    state.currentDoc = null;
    state.fontError = error instanceof Error ? error.message : String(error);
    console.error("CalligraphyComposer font init failed:", error);
  }
  requestRender();
}

async function ensureCurrentFontDoc() {
  const entry = state.projectFonts[P.fontId];
  if (!entry) {
    state.currentDoc = null;
    throw new Error(`Font entry "${P.fontId}" was not found in the manifest.`);
  }
  if (!state.fontDocs[P.fontId]) {
    state.loadingFont = true;
    requestRender();
    try {
      const res = await fetch(entry.resolvedPath, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Font fetch failed with status ${res.status} for ${entry.resolvedPath}`);
      }
      const data = await res.json();
      state.fontDocs[P.fontId] = normalizeDoc(data);
    } finally {
      state.loadingFont = false;
    }
  }
  state.currentDoc = state.fontDocs[P.fontId];
  state.fontError = "";
  const defaultFontSizeMM = state.currentDoc.physicalEmMm || FALLBACK_FONT_SIZE_MM;
  const defaultLineHeightMM = defaultLineHeightMMForDoc(state.currentDoc);
  for (const box of state.boxes) {
    if (!state.currentDoc.pens.find((pen) => pen.id === box.penId)) {
      box.penId = state.currentDoc.activePen;
    }
    if (!box.fontSizeMM || box.fontSizeMM === 26 || box.fontSizeMM === FALLBACK_FONT_SIZE_MM) {
      box.fontSizeMM = defaultFontSizeMM;
    }
    if (!box.nibMode) {
      box.nibMode = "fixed";
    }
    if (!box.lineHeightMM || box.lineHeightMM === 26 || box.lineHeightMM === FALLBACK_LINE_HEIGHT_MM) {
      if (box.lineHeight) {
        box.lineHeightMM = defaultFontSizeMM * box.lineHeight;
      } else {
        box.lineHeightMM = defaultLineHeightMM;
      }
    }
    if (!box.nibWidthMM) {
      const pen = state.currentDoc.pens.find((candidate) => candidate.id === box.penId) || state.currentDoc.pens[0];
      if (box.penWidthScale && pen) {
        box.nibWidthMM = pen.mm * box.penWidthScale;
      } else if (pen) {
        box.nibWidthMM = pen.mm;
      }
    }
  }
  refreshSelectionMonitor();
}

function buildFontBinding(options) {
  fontBinding = fontFolder.addInput(P, "fontId", { label: "Font", options });
  fontBinding.on("change", async () => {
    await ensureCurrentFontDoc();
    requestRender();
  });
}

function rebuildFontBinding() {
  const options = Object.values(state.projectFonts).reduce((acc, entry) => {
    acc[entry.name || entry.id] = entry.id;
    return acc;
  }, {});
  if (fontBinding) {
    fontBinding.dispose();
  }
  buildFontBinding(Object.keys(options).length ? options : { italics: "italics" });
  pane.refresh();
}

function syncCurrentFontId() {
  const ids = Object.keys(state.projectFonts);
  if (!ids.length) return;
  if (!state.projectFonts[P.fontId]) {
    P.fontId = ids[0];
  }
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = P.bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pxPerMM = PaperUtils.getPxPerMM(P);
  ctx.save();
  ctx.scale(pxPerMM, pxPerMM);
  drawPaper();
  drawGuides();

  if (!state.currentDoc) {
    drawLoadingState();
  } else {
    cachedLayouts = state.boxes.map((box) => layoutBox(state.currentDoc, box));
    drawBoxes(state.currentDoc);
  }
  ctx.restore();
  updateStats();
}

function drawPaper() {
  ctx.fillStyle = P.paperColor;
  ctx.fillRect(0, 0, P.canvasWMM, P.canvasHMM);
  if (!P.showMargins || P.marginMM <= 0) return;
  ctx.strokeStyle = P.marginColor;
  ctx.lineWidth = 0.25;
  ctx.strokeRect(P.marginMM, P.marginMM, P.canvasWMM - P.marginMM * 2, P.canvasHMM - P.marginMM * 2);
}

function drawGuides() {
  if (!P.showGuides || P.guideSpacingMM <= 0) return;
  ctx.strokeStyle = P.guideColor;
  ctx.lineWidth = 0.12;
  for (let y = P.marginMM; y <= P.canvasHMM - P.marginMM; y += P.guideSpacingMM) {
    ctx.beginPath();
    ctx.moveTo(P.marginMM, y);
    ctx.lineTo(P.canvasWMM - P.marginMM, y);
    ctx.stroke();
  }
}

function drawLoadingState() {
  ctx.fillStyle = "#6b7384";
  ctx.font = "5mm sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const message = state.loadingFont
    ? "Loading stroke font..."
    : state.fontError
      ? `Font load error: ${state.fontError}`
      : "No stroke font loaded";
  ctx.fillText(message, P.canvasWMM * 0.5, P.canvasHMM * 0.5);
}

function drawBoxes(doc) {
  for (let i = 0; i < state.boxes.length; i++) {
    drawTextBox(doc, state.boxes[i], cachedLayouts[i], state.boxes[i].id === activeBoxId);
  }
}

function drawTextBox(doc, box, layout, isActive) {
  if (!layout) return;
  const pen = resolvePenForDoc(doc, box);
  for (const line of layout.lines) {
    const baselineY = box.yMM + box.paddingMM + line.baselineMM;
    for (const item of line.items) {
      if (!item.glyph) continue;
      const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
      drawGlyphItem(item, pen, drawX, baselineY, box.fontSizeMM, box.slantShear, box.verticalScale);
      if (item.key === hoverGlyphKey && item.variants?.length > 1) {
        drawGlyphHoverOutline(item, drawX, baselineY, box.fontSizeMM, box.slantShear, box.verticalScale, doc.metrics);
      }
    }
  }

  if (isActive) {
    ctx.fillStyle = P.selectionFill;
    ctx.fillRect(box.xMM, box.yMM, box.widthMM, box.heightMM);
    ctx.strokeStyle = P.frameColor;
    ctx.lineWidth = 0.4;
    ctx.strokeRect(box.xMM, box.yMM, box.widthMM, box.heightMM);
    drawHandles(box);
  }
}

function drawGlyphHoverOutline(item, drawX, baselineY, emSizeMM, slantShear, verticalScale, metrics) {
  const scale = emSizeMM / UPM;
  const horizontalShift = Math.abs(slantShear) * (metrics.ascender - metrics.descender) * scale;
  const scaledHeight = (metrics.ascender - metrics.descender) * scale * Math.max(verticalScale || 1, 0.001);
  ctx.save();
  ctx.strokeStyle = "rgba(76, 125, 255, 0.55)";
  ctx.lineWidth = 0.35;
  ctx.strokeRect(
    drawX + Math.min(0, slantShear * metrics.descender * scale) - 0.6,
    baselineY - metrics.ascender * scale * Math.max(verticalScale || 1, 0.001) - 0.6,
    item.advance * scale + horizontalShift + 1.2,
    scaledHeight + 1.2,
  );
  ctx.restore();
}

function drawGlyphItem(item, pen, xMM, baselineYMM, emSizeMM, slantShear, verticalScale) {
  const scale = emSizeMM / UPM;
  const cached = getCachedGlyphArtwork(item, pen);
  ctx.save();
  ctx.translate(xMM, baselineYMM);
  ctx.scale(scale, -scale);
  ctx.transform(1, 0, slantShear || 0, Math.max(verticalScale || 1, 0.001), 0, 0);
  ctx.fillStyle = P.textColor;
  ctx.fill(cached.path, "nonzero");
  if (P.showSkeletonOverlay) {
    ctx.strokeStyle = "rgba(36,84,166,.55)";
    ctx.lineWidth = 2 / Math.max(emSizeMM, 1);
    for (const st of item.glyph.strokes || []) {
      drawSkeletonPathCanvas(st);
    }
  }
  ctx.restore();
}

function getCachedGlyphArtwork(item, pen) {
  const cacheKey = [
    P.fontId,
    item.name,
    item.activeVariant || "default",
    pen.id || pen.name,
    fmt(pen.wU, 4),
    fmt(pen.ratio, 4),
    fmt(pen.angle, 4),
  ].join("|");
  let cached = glyphArtworkCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const polys = expandGlyph(item.glyph, pen, 4).filter(
    (poly) => poly && poly.length > 1 && poly.every((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1])),
  );
  const path = new Path2D();
  for (const poly of polys) {
    path.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      path.lineTo(poly[i][0], poly[i][1]);
    }
    path.closePath();
  }
  cached = { polys, path };
  glyphArtworkCache.set(cacheKey, cached);
  return cached;
}

function fillPolysCanvas(polys, fillStyle) {
  ctx.fillStyle = fillStyle;
  for (const poly of polys) {
    if (!poly || poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fill("nonzero");
  }
}

function drawSkeletonPathCanvas(st) {
  const nodes = st.nodes || [];
  if (!nodes.length) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  const count = st.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const A = nodes[i];
    const B = nodes[(i + 1) % nodes.length];
    const p0 = [A.x, A.y];
    const p1 = [B.x, B.y];
    const c1 = A.out || p0;
    const c2 = B.in || p1;
    if (!A.out && !B.in) {
      ctx.lineTo(p1[0], p1[1]);
    } else {
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]);
    }
  }
  if (st.closed) ctx.closePath();
  ctx.stroke();
}

function drawHandles(box) {
  for (const handle of getBoxHandles(box)) {
    ctx.fillStyle = handle.key === hoverHandle ? "#ffb15a" : P.handleColor;
    ctx.fillRect(handle.xMM - 1.3, handle.yMM - 1.3, 2.6, 2.6);
  }
}

function layoutBox(doc, box) {
  const metrics = doc.metrics;
  const scaleMMPerUnit = box.fontSizeMM / UPM;
  const innerWidthMM = Math.max(4, box.widthMM - box.paddingMM * 2);
  const maxWidthU = innerWidthMM / scaleMMPerUnit;
  const lineAdvanceMM = Math.max(0.1, box.lineHeightMM || box.fontSizeMM);
  const lineAdvanceU = lineAdvanceMM / scaleMMPerUnit;
  const trackingU = (box.trackingMM || 0) / scaleMMPerUnit;
  const layout = layoutProofText(
    doc,
    box.text,
    maxWidthU,
    box.align,
    box.variantMap || {},
    box.leftKernMMMap || {},
    trackingU,
    scaleMMPerUnit,
  );
  const lines = layout.lines.map((line, index) => ({
    items: line.items.map((item) => ({
      ...item,
      key: `${box.id}:${item.sourceIndex}`,
      xMM: item.x * scaleMMPerUnit,
      advanceMM: item.advance * scaleMMPerUnit,
    })),
    baselineMM: metrics.ascender * scaleMMPerUnit + index * lineAdvanceU * scaleMMPerUnit,
    offsetMM: line.offsetX * scaleMMPerUnit,
    widthMM: line.width * scaleMMPerUnit,
  }));
  const lineCount = Math.max(lines.length, 1);
  const contentHeightMM =
    lineCount * (metrics.ascender - metrics.descender + metrics.lineGap) * scaleMMPerUnit -
    metrics.lineGap * scaleMMPerUnit;
  box.heightMM = Math.max(12, contentHeightMM + box.paddingMM * 2);
  return {
    lines,
    overflow: false,
    missing: layout.missing,
    textLength: box.text.length,
  };
}

function createTextBox(overrides = {}) {
  const id = nextBoxId++;
  const baseFontSizeMM = overrides.fontSizeMM ?? FALLBACK_FONT_SIZE_MM;
  return {
    id,
    name: overrides.name || `Box ${id}`,
    text: overrides.text || "CalligraphyComposer",
    xMM: overrides.xMM ?? 26,
    yMM: overrides.yMM ?? 32,
    widthMM: overrides.widthMM ?? 110,
    heightMM: overrides.heightMM ?? 72,
    paddingMM: overrides.paddingMM ?? 5,
    trackingMM: overrides.trackingMM ?? 0,
    fontSizeMM: baseFontSizeMM,
    lineHeightMM:
      overrides.lineHeightMM ?? (overrides.lineHeight ? baseFontSizeMM * overrides.lineHeight : baseFontSizeMM),
    align: overrides.align || "left",
    slantShear: overrides.slantShear ?? 0,
    verticalScale: overrides.verticalScale ?? 1,
    penId: overrides.penId || "p4",
    nibMode: overrides.nibMode || "fixed",
    nibWidthMM: overrides.nibWidthMM ?? (overrides.penWidthScale ? 2.4 * overrides.penWidthScale : 2.4),
    variantMap: clone(overrides.variantMap || {}),
    leftKernMMMap: clone(overrides.leftKernMMMap || {}),
  };
}

function defaultLineHeightMMForDoc(doc) {
  const metrics = doc?.metrics;
  const emMM = doc?.physicalEmMm || FALLBACK_FONT_SIZE_MM;
  if (!metrics) return FALLBACK_LINE_HEIGHT_MM;
  return ((metrics.ascender - metrics.descender + metrics.lineGap) / UPM) * emMM;
}

function getActiveBox() {
  return state.boxes.find((box) => box.id === activeBoxId) || null;
}

function refreshSelectionMonitor() {
  const active = getActiveBox();
  document.getElementById("boxCountLabel").textContent = `${state.boxes.length} text box${state.boxes.length === 1 ? "" : "es"}`;
  if (!active) {
    selectionState.activeName = "None";
    pane?.refresh();
    if (boxTextInputEl) {
      boxTextInputEl.value = "";
    }
    updateStats();
    return;
  }
  selectionState.activeName = active.name;
  for (const key of ["text", "fontSizeMM", "lineHeightMM", "paddingMM", "trackingMM", "align", "slantShear", "verticalScale", "penId", "nibMode", "nibWidthMM"]) {
    selectionState[key] = active[key];
  }
  pane?.refresh();
  if (boxTextInputEl) {
    boxTextInputEl.value = active.text || "";
  }
  updateStats();
}

function applySelectionStateToBox() {
  const box = getActiveBox();
  if (!box) return;
  for (const key of ["text", "fontSizeMM", "lineHeightMM", "paddingMM", "trackingMM", "penId", "nibMode", "nibWidthMM", "slantShear", "verticalScale"]) {
    box[key] = selectionState[key];
  }
  box.align = selectionState.align;
}

function setAlignment(align) {
  selectionState.align = align;
  applySelectionStateToBox();
  pane?.refresh();
  requestRender();
}

function layoutActionButtonsRow() {
  const row = document.createElement("div");
  row.className = "tp-action-row";
  const buttons = [actionBindings.alignLeft, actionBindings.alignCenter, actionBindings.alignRight]
    .map(getBladeElement)
    .filter(Boolean);
  if (!buttons.length) return;
  const parent = buttons[0].parentElement;
  if (!parent) return;
  parent.insertBefore(row, buttons[0]);
  for (const buttonEl of buttons) {
    row.appendChild(buttonEl);
  }
}

function getBladeElement(binding) {
  return binding?.element || binding?.controller?.view?.element || binding?.controller_?.view?.element || null;
}

function syncNibWidthToPen() {
  const doc = state.currentDoc;
  if (!doc) return;
  const pen = doc.pens.find((candidate) => candidate.id === selectionState.penId) || doc.pens[0];
  if (!pen) return;
  if (selectionState.nibMode === "proportional") {
    const referenceEm = doc.physicalEmMm || 1;
    selectionState.nibWidthMM = (pen.mm / referenceEm) * selectionState.fontSizeMM;
  } else {
    selectionState.nibWidthMM = pen.mm;
  }
  pane?.refresh();
}

function onPointerDown(event) {
  const point = pointerToMM(event);
  if (!point || !state.currentDoc) return;
  const now = Date.now();
  const hit = hitTestBoxes(point);
  if (!hit) {
    activeBoxId = null;
    state.activeGlyphItem = null;
    hideVariantMenu(true);
    refreshSelectionMonitor();
    requestRender();
    return;
  }
  activeBoxId = hit.box.id;
  refreshSelectionMonitor();

  const layout = cachedLayouts[state.boxes.findIndex((box) => box.id === hit.box.id)] || layoutBox(state.currentDoc, hit.box);
  const glyphItem = previewItemAt(hit.box, layout, state.currentDoc, point, false);
  if (glyphItem) {
    state.activeGlyphItem = glyphItem;
    showVariantMenu(glyphItem, pointerToLocalPx(event).x, pointerToLocalPx(event).y, true);
    requestRender();
    return;
  }

  if (hit.part === "handle") {
    dragState = {
      kind: "resize",
      key: hit.handle.key,
      start: point,
      origin: { ...hit.box },
    };
  } else {
    dragState = {
      kind: "move",
      start: point,
      origin: { ...hit.box },
    };
  }
  canvas.setPointerCapture(event.pointerId);
  lastClickMs = now;
  requestRender();
}

function onPointerMove(event) {
  const point = pointerToMM(event);
  if (!point) return;
  hoverHandle = null;
  const hit = hitTestBoxes(point);
  if (hit?.part === "handle") {
    hoverHandle = hit.handle.key;
  }

  if (!dragState) {
    requestRender();
    return;
  }

  const box = getActiveBox();
  if (!box) return;
  if (dragState.kind === "move") {
    box.xMM = clamp(dragState.origin.xMM + (point.x - dragState.start.x), 0, P.canvasWMM - box.widthMM);
    box.yMM = clamp(dragState.origin.yMM + (point.y - dragState.start.y), 0, P.canvasHMM - box.heightMM);
  } else {
    applyResize(box, dragState, point);
  }
  refreshSelectionMonitor();
  requestRender();
}

function onPointerUp(event) {
  if (dragState) {
    dragState = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    requestRender();
  }
}

function onPointerLeave() {
  hoverHandle = null;
  if (!dragState) requestRender();
}

function onHoverPointerMove(event) {
  if (!state.currentDoc || dragState) return;
  const point = pointerToMM(event);
  if (!point) return;
  const box = getActiveBox();
  if (!box) return;
  const layout = cachedLayouts[state.boxes.findIndex((candidate) => candidate.id === box.id)];
  if (!layout) return;
  const item = previewItemAt(box, layout, state.currentDoc, point, true);
  state.hoveredGlyphItem = item;
  hoverGlyphKey = item?.key || null;
  if (!item) {
    if (!variantMenuEl?.matches(":hover") && !state.activeGlyphItem) hideVariantMenu();
    canvas.style.cursor = "default";
    requestRender();
    return;
  }
  canvas.style.cursor = "pointer";
  if ((!state.activeGlyphItem || state.activeGlyphItem.key !== item.key) && (state.variantMenu.key !== item.key || !variantMenuEl.classList.contains("open"))) {
    const anchor = pointerToLocalPx(event);
    showVariantMenu(item, anchor.x, anchor.y, false);
  }
  requestRender();
}

function onHoverPointerLeave(event) {
  if (event.relatedTarget && wrapEl.contains(event.relatedTarget)) return;
  hoverGlyphKey = null;
  state.hoveredGlyphItem = null;
  if (!variantMenuEl?.matches(":hover") && !state.activeGlyphItem) hideVariantMenu();
  if (!dragState) requestRender();
}

function pointerToLocalPx(event) {
  const rect = wrapEl.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function showVariantMenu(item, anchorX, anchorY, isActive = false) {
  const variants = (item.variants || []).filter(Boolean);
  if ((!variants.length && !isActive) || !variantMenuEl) {
    hideVariantMenu();
    return;
  }
  state.variantMenu = { boxId: item.boxId, key: item.key, anchorPx: { x: anchorX, y: anchorY } };
  const title = `${isActive ? "Active glyph" : "Variant for"} "${escapeHTML(item.char)}"`;
  variantMenuEl.innerHTML = `<div class="variant-title">${title}</div><div class="variant-list"></div><div class="variant-controls"></div>`;
  const list = variantMenuEl.querySelector(".variant-list");
  for (const name of variants) {
    const btn = document.createElement("button");
    btn.className = "variant-btn";
    btn.type = "button";
    btn.textContent = name;
    btn.setAttribute("aria-pressed", String(name === (item.activeVariant || "default")));
    btn.addEventListener("click", () => {
      const box = state.boxes.find((candidate) => candidate.id === item.boxId);
      if (!box) return;
      box.variantMap[item.sourceIndex] = name;
      glyphArtworkCache.clear();
      refreshSelectionMonitor();
      const boxIndex = state.boxes.findIndex((candidate) => candidate.id === item.boxId);
      const layout = layoutBox(state.currentDoc, box);
      cachedLayouts[boxIndex] = layout;
      requestRender();
      const live = previewItemAt(box, layout, state.currentDoc, { x: item.xMM + 0.1, y: item.yMM + 0.1 }, false) || item;
      state.activeGlyphItem = live;
      showVariantMenu(live, state.variantMenu.anchorPx.x, state.variantMenu.anchorPx.y, true);
    });
    list.appendChild(btn);
  }
  const controls = variantMenuEl.querySelector(".variant-controls");
  if (isActive) {
    const box = state.boxes.find((candidate) => candidate.id === item.boxId);
    const kern = box?.leftKernMMMap?.[item.sourceIndex] || 0;
    controls.innerHTML = `
      <div class="variant-title" style="margin-top:8px">Left kerning</div>
      <input id="glyphKernRange" type="range" min="-10" max="10" step="0.01" value="${kern}">
      <div id="glyphKernValue" style="font-size:12px;color:#bfd0e2;margin-top:4px">${fmt(kern, 2)} mm</div>
    `;
    const range = controls.querySelector("#glyphKernRange");
    range?.addEventListener("input", (evt) => {
      const next = Number(evt.target.value);
      const targetBox = state.boxes.find((candidate) => candidate.id === item.boxId);
      if (!targetBox) return;
      targetBox.leftKernMMMap[item.sourceIndex] = next;
      glyphArtworkCache.clear();
      const boxIndex = state.boxes.findIndex((candidate) => candidate.id === item.boxId);
      cachedLayouts[boxIndex] = layoutBox(state.currentDoc, targetBox);
      const valueEl = controls.querySelector("#glyphKernValue");
      if (valueEl) valueEl.textContent = `${fmt(next, 2)} mm`;
      requestRender();
    });
  }
  variantMenuEl.classList.add("open");
  const wrapRect = wrapEl.getBoundingClientRect();
  const menuRect = variantMenuEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, anchorX + 10), Math.max(8, wrapRect.width - menuRect.width - 8));
  const top = Math.min(Math.max(8, anchorY + 10), Math.max(8, wrapRect.height - menuRect.height - 8));
  variantMenuEl.style.left = `${left}px`;
  variantMenuEl.style.top = `${top}px`;
}

function hideVariantMenu(clearActive = false) {
  state.variantMenu = { boxId: null, key: null, anchorPx: null };
  hoverGlyphKey = null;
  state.hoveredGlyphItem = null;
  if (clearActive) state.activeGlyphItem = null;
  if (variantMenuEl) {
    variantMenuEl.classList.remove("open");
    variantMenuEl.innerHTML = "";
  }
}

function pointerToMM(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const xPx = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const yPx = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const pxPerMM = PaperUtils.getPxPerMM(P);
  return { x: xPx / pxPerMM, y: yPx / pxPerMM };
}

function hitTestBoxes(point) {
  const ordered = [...state.boxes].reverse();
  for (const box of ordered) {
    if (box.id === activeBoxId) {
      for (const handle of getBoxHandles(box)) {
        if (distance(point.x, point.y, handle.xMM, handle.yMM) <= 3.2) {
          return { part: "handle", box, handle };
        }
      }
    }
    if (
      point.x >= box.xMM &&
      point.x <= box.xMM + box.widthMM &&
      point.y >= box.yMM &&
      point.y <= box.yMM + box.heightMM
    ) {
      return { part: "box", box };
    }
  }
  return null;
}

function getBoxHandles(box) {
  const x0 = box.xMM;
  const y0 = box.yMM;
  const x1 = box.xMM + box.widthMM;
  const y1 = box.yMM + box.heightMM;
  const ym = (y0 + y1) * 0.5;
  return [
    { key: "e", xMM: x1, yMM: ym },
    { key: "w", xMM: x0, yMM: ym },
  ];
}

function applyResize(box, drag, point) {
  const minSize = 12;
  const ox = drag.origin.xMM;
  const ow = drag.origin.widthMM;
  const dx = point.x - drag.start.x;
  let x = ox;
  let w = ow;

  if (drag.key.includes("e")) w = clamp(ow + dx, minSize, P.canvasWMM - ox);
  if (drag.key.includes("w")) {
    x = clamp(ox + dx, 0, ox + ow - minSize);
    w = ow - (x - ox);
  }

  box.xMM = x;
  box.widthMM = w;
}

function resolvePenForDoc(doc, box) {
  const source = doc.pens.find((pen) => pen.id === box.penId) || doc.pens.find((pen) => pen.id === doc.activePen) || doc.pens[0];
  const referenceEm = doc.physicalEmMm || 1;
  const nibWidthMM = box.nibMode === "proportional" ? (source.mm / referenceEm) * box.fontSizeMM : (box.nibWidthMM ?? source.mm);
  const renderEmMM = Math.max(box.fontSizeMM || referenceEm, 0.001);
  return {
    ...source,
    mm: nibWidthMM,
    wU: (nibWidthMM / renderEmMM) * UPM,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function appBaseHref() {
  const url = new URL(window.location.href);
  const last = url.pathname.split("/").filter(Boolean).pop() || "";
  const looksLikeFile = last.includes(".");
  if (url.pathname.endsWith("/")) return url.href;
  if (looksLikeFile) return new URL("./", url.href).href;
  return `${url.href}/`;
}

function appAssetUrl(path) {
  return new URL(String(path || "").replace(/^\.\//, ""), appBaseHref()).href;
}

async function loadProjectFonts() {
  const url = appAssetUrl("./fonts/index.json");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Manifest fetch failed with status ${res.status} for ${url}`);
  }
  const manifest = await res.json();
  const out = {};
  for (const entry of manifest.fonts || []) {
    out[entry.id] = { ...entry, resolvedPath: appAssetUrl(entry.path) };
  }
  if (!Object.keys(out).length) {
    throw new Error(`Manifest loaded from ${url} but did not contain any fonts.`);
  }
  return out;
}

function skeletonBounds(g) {
  const pts = [];
  for (const st of g.strokes || []) {
    for (const n of st.nodes || []) {
      pts.push([n.x, n.y]);
      if (n.in) pts.push(n.in);
      if (n.out) pts.push(n.out);
    }
  }
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function ensureGlyphShape(g) {
  if (!g.variants) {
    const b = skeletonBounds(g);
    g.lsb = g.lsb == null ? b.x0 : g.lsb;
    g.activeVariant = "default";
    g.variants = {
      default: {
        name: "default",
        strokes: clone(g.strokes || []),
        advance: g.advance == null ? 500 : g.advance,
        lsb: g.lsb,
      },
    };
  }
  if (!g.activeVariant || !g.variants[g.activeVariant]) {
    g.activeVariant = Object.keys(g.variants)[0] || "default";
  }
  const active = g.variants[g.activeVariant];
  if (active && !g.strokes) {
    g.strokes = clone(active.strokes || []);
    g.advance = active.advance == null ? (g.advance == null ? 500 : g.advance) : active.advance;
    g.lsb = active.lsb == null ? (g.lsb == null ? 0 : g.lsb) : active.lsb;
  }
  return g;
}

function normalizeDoc(doc) {
  doc.meta = doc.meta || { familyName: "Untitled Stroke Font", savedAt: "" };
  doc.metrics = Object.assign(
    {
      ascender: 750,
      capHeight: 700,
      xHeight: 500,
      descender: -200,
      overshoot: 12,
      lineGap: 120,
      hheaAscender: 750,
      hheaDescender: -200,
      typoAscender: 750,
      typoDescender: -200,
      typoLineGap: 120,
      winAscent: 820,
      winDescent: 260,
    },
    doc.metrics || {},
  );
  for (const name of doc.order || []) {
    if (doc.glyphs[name]) ensureGlyphShape(doc.glyphs[name]);
  }
  return doc;
}

function trimVariantMap(box) {
  const length = (box.text || "").length;
  for (const key of Object.keys(box.variantMap || {})) {
    if (+key >= length) {
      delete box.variantMap[key];
    }
  }
  for (const key of Object.keys(box.leftKernMMMap || {})) {
    if (+key >= length) {
      delete box.leftKernMMMap[key];
    }
  }
}

function previewLineOffset(lineWidth, maxWidth, align) {
  if (align === "center") return Math.max(0, (maxWidth - lineWidth) / 2);
  if (align === "right") return Math.max(0, maxWidth - lineWidth);
  return 0;
}

function glyphAdvanceForChar(doc, ch, sourceIndex, variantMap) {
  const name = ch === " " ? "space" : ch;
  const baseGlyph = doc.glyphs[name];
  if (!baseGlyph) {
    return { name, glyph: null, advance: 260, missing: true, sourceIndex, activeVariant: "default", variants: [] };
  }
  ensureGlyphShape(baseGlyph);
  const preferredVariantName = baseGlyph.variants?.var2 ? "var2" : baseGlyph.variants?.default ? "default" : null;
  const requestedVariant = variantMap[sourceIndex];
  const activeVariantName =
    requestedVariant && baseGlyph.variants?.[requestedVariant]
      ? requestedVariant
      : preferredVariantName
        ? preferredVariantName
        : baseGlyph.activeVariant && baseGlyph.variants?.[baseGlyph.activeVariant]
          ? baseGlyph.activeVariant
          : null;
  const variant = activeVariantName ? baseGlyph.variants?.[activeVariantName] : null;
  const glyph = variant
    ? {
        advance: variant.advance == null ? baseGlyph.advance : variant.advance,
        strokes: variant.strokes || baseGlyph.strokes,
      }
    : baseGlyph;
  return {
    name,
    baseGlyphName: name,
    glyph,
    advance: glyph.advance,
    missing: false,
    sourceIndex,
    activeVariant: activeVariantName || "default",
    variants: Object.keys(baseGlyph.variants || {}),
  };
}

function tokenizeProofText(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      tokens.push({ type: "break", start: i });
      i++;
      continue;
    }
    if (ch === " ") {
      let j = i;
      while (j < text.length && text[j] === " ") j++;
      tokens.push({ type: "spaces", text: text.slice(i, j), start: i });
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== " " && text[j] !== "\n") j++;
    tokens.push({ type: "word", text: text.slice(i, j), start: i });
    i = j;
  }
  return tokens;
}

function measureToken(doc, token, variantMap, leftKernMMMap, trackingU, scaleMMPerUnit) {
  if (token.type === "break") return { width: 0, items: [], missing: [] };
  const items = [];
  const missing = [];
  let width = 0;
  for (let offset = 0; offset < token.text.length; offset++) {
    const ch = token.text[offset];
    const sourceIndex = token.start + offset;
    const info = glyphAdvanceForChar(doc, ch, sourceIndex, variantMap);
    const leftKernMM = leftKernMMMap?.[sourceIndex] || 0;
    const leftKernU = leftKernMM / scaleMMPerUnit;
    items.push({
      glyph: info.glyph,
      char: ch,
      x: width + leftKernU,
      advance: info.advance,
      sourceIndex: info.sourceIndex,
      name: info.name,
      baseGlyphName: info.baseGlyphName,
      activeVariant: info.activeVariant,
      variants: info.variants,
      leftKernMM,
    });
    width += leftKernU + info.advance + (ch === "\n" ? 0 : trackingU);
    if (info.missing && !missing.includes(ch)) missing.push(ch);
  }
  return { width, items, missing };
}

function layoutProofText(doc, text, maxWidth, align = "left", variantMap = {}, leftKernMMMap = {}, trackingU = 0, scaleMMPerUnit = 1) {
  const tokens = tokenizeProofText(text || "");
  const lines = [];
  const missing = new Set();
  let current = { index: 0, width: 0, items: [] };

  const pushLine = () => {
    lines.push(current);
    current = { index: lines.length, width: 0, items: [] };
  };

  for (const token of tokens) {
    if (token.type === "break") {
      pushLine();
      continue;
    }
    const measured = measureToken(doc, token, variantMap, leftKernMMMap, trackingU, scaleMMPerUnit);
    measured.missing.forEach((ch) => missing.add(ch));
    if (token.type === "spaces" && current.items.length === 0) continue;
    if (token.type === "word" && current.items.length && current.width + measured.width > maxWidth) {
      pushLine();
    }
    if (token.type === "spaces" && current.width + measured.width > maxWidth) {
      pushLine();
      continue;
    }
    if (token.type === "word" && measured.width > maxWidth && !current.items.length) {
      let localX = 0;
      for (const item of measured.items) {
        if (localX && localX + item.advance > maxWidth) {
          current.width = localX;
          pushLine();
          localX = 0;
        }
        current.items.push({ ...item, x: localX });
        localX += item.advance;
      }
      current.width = localX;
      continue;
    }
    for (const item of measured.items) {
      current.items.push({ ...item, x: current.width + item.x });
    }
    current.width += measured.width;
  }

  if (!lines.length || current.items.length || text.endsWith("\n")) {
    lines.push(current);
  }
  for (const line of lines) {
    line.offsetX = previewLineOffset(line.width, maxWidth, align);
  }
  return { lines, missing: [...missing] };
}

function previewItemAt(box, layout, doc, point, variantsOnly = true) {
  const metrics = doc.metrics;
  const scale = box.fontSizeMM / UPM;
  for (let i = layout.lines.length - 1; i >= 0; i--) {
    const line = layout.lines[i];
    const baselineY = box.yMM + box.paddingMM + line.baselineMM;
    for (let j = line.items.length - 1; j >= 0; j--) {
      const item = line.items[j];
      if (item.char === " ") continue;
      if (variantsOnly && (!item.variants || item.variants.length <= 1)) continue;
      const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
      const horizontalShift = Math.abs(box.slantShear || 0) * (metrics.ascender - metrics.descender) * scale;
      const verticalScale = Math.max(box.verticalScale || 1, 0.001);
      const x = drawX + Math.min(0, (box.slantShear || 0) * metrics.descender * scale);
      const y = baselineY - metrics.ascender * scale * verticalScale;
      const w = item.advanceMM + horizontalShift;
      const h = (metrics.ascender - metrics.descender) * scale * verticalScale;
      if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
        return { ...item, boxId: box.id, xMM: x, yMM: y, wMM: w, hMM: h, drawXMM: drawX, baselineYMM: baselineY };
      }
    }
  }
  return null;
}

function nibPolygon(widthU, ratio, angleDeg) {
  const a = widthU / 2;
  const b = (widthU * Math.max(ratio, MIN_RATIO)) / 2;
  const t = (angleDeg * Math.PI) / 180;
  const co = Math.cos(t);
  const si = Math.sin(t);
  const points = [];
  for (let i = 0; i < NIB_SEGS; i++) {
    const u = (i / NIB_SEGS) * Math.PI * 2;
    const x = a * Math.cos(u);
    const y = b * Math.sin(u);
    points.push([x * co - y * si, x * si + y * co]);
  }
  return points;
}

function hull(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const low = [];
  const up = [];
  for (const q of sorted) {
    while (low.length >= 2 && cross(low[low.length - 2], low[low.length - 1], q) <= 0) low.pop();
    low.push(q);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const q = sorted[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  low.pop();
  up.pop();
  return low.concat(up);
}

function cubicAt(p0, c1, c2, p1, t) {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const c = 3 * m * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function flattenStroke(st, tol) {
  const nodes = st.nodes || [];
  if (nodes.length < 2) {
    return { pts: nodes.map((n) => [n.x, n.y]), w: nodes.map((n) => n.w ?? 1) };
  }
  const pts = [];
  const ws = [];
  const count = st.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const A = nodes[i];
    const B = nodes[(i + 1) % nodes.length];
    const p0 = [A.x, A.y];
    const p1 = [B.x, B.y];
    const c1 = A.out || p0;
    const c2 = B.in || p1;
    const isLine = !A.out && !B.in;
    if (isLine) {
      pts.push(p0);
      ws.push(A.w ?? 1);
    } else {
      const L =
        Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) +
        Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
        Math.hypot(p1[0] - c2[0], p1[1] - c2[1]);
      const n = Math.max(4, Math.min(64, Math.ceil(L / tol)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push(cubicAt(p0, c1, c2, p1, t));
        ws.push((A.w ?? 1) * (1 - smooth(t)) + (B.w ?? 1) * smooth(t));
      }
    }
  }
  if (!st.closed) {
    const last = nodes[nodes.length - 1];
    pts.push([last.x, last.y]);
    ws.push(last.w ?? 1);
  } else {
    pts.push(pts[0].slice());
    ws.push(ws[0]);
  }
  return { pts, w: ws };
}

function expandStroke(st, pen, tol) {
  const { pts, w } = flattenStroke(st, tol);
  if (pts.length < 2) {
    if (pts.length === 1) {
      return [nibPolygon(pen.wU, pen.ratio, pen.angle).map((q) => [q[0] + pts[0][0], q[1] + pts[0][1]])];
    }
    return [];
  }
  const base = nibPolygon(pen.wU, pen.ratio, pen.angle);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    if (Math.abs(A[0] - B[0]) < 1e-9 && Math.abs(A[1] - B[1]) < 1e-9) continue;
    const wa = w[i];
    const wb = w[i + 1];
    const cloud = [];
    for (const q of base) {
      cloud.push([q[0] * wa + A[0], q[1] * wa + A[1]]);
      cloud.push([q[0] * wb + B[0], q[1] * wb + B[1]]);
    }
    out.push(hull(cloud));
  }
  return out;
}

function expandGlyph(g, pen, tol) {
  let polys = [];
  for (const st of g.strokes || []) {
    polys = polys.concat(expandStroke(st, pen, tol));
  }
  return polys;
}

function polysToPathData(polys, precision = 3) {
  return polys
    .filter((poly) => poly && poly.length > 1 && poly.every((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1])))
    .map((poly) => {
      let d = `M ${ExportUtils.fmt(poly[0][0])} ${ExportUtils.fmt(poly[0][1])}`;
      for (let i = 1; i < poly.length; i++) {
        d += ` L ${ExportUtils.fmt(poly[i][0])} ${ExportUtils.fmt(poly[i][1])}`;
      }
      return `${d} Z`;
    })
    .join(" ");
}

function exportSvg() {
  if (!state.currentDoc) return;
  const doc = state.currentDoc;
  const svg = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(
      P.canvasHMM,
    )}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`,
  );
  for (let i = 0; i < state.boxes.length; i++) {
    const box = state.boxes[i];
    const layout = cachedLayouts[i] || layoutBox(doc, box);
    const pen = resolvePenForDoc(doc, box);
    const scale = box.fontSizeMM / UPM;
    svg.push(`<g data-box="${ExportUtils.escapeXML(box.name)}">`);
    for (const line of layout.lines) {
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const pathData = polysToPathData(getCachedGlyphArtwork(item, pen).polys);
        if (!pathData) continue;
        svg.push(
          `<g transform="translate(${ExportUtils.fmt(drawX)} ${ExportUtils.fmt(baselineY)}) scale(${ExportUtils.fmt(
            scale,
          )} ${ExportUtils.fmt(-scale)}) matrix(1 0 ${ExportUtils.fmt(box.slantShear || 0)} ${ExportUtils.fmt(Math.max(box.verticalScale || 1, 0.001))} 0 0)">`,
        );
        svg.push(`<path d="${pathData}" fill="${ExportUtils.escapeXML(P.textColor)}" fill-rule="nonzero"/>`);
        svg.push(`</g>`);
      }
    }
    svg.push("</g>");
  }
  svg.push("</svg>");
  ExportUtils.downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function exportPathSvg() {
  if (!state.currentDoc) return;
  const doc = state.currentDoc;
  const filename = P.svgFilename.replace(/\.svg$/i, "-paths.svg");
  const svg = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ExportUtils.fmt(P.canvasWMM)}mm" height="${ExportUtils.fmt(
      P.canvasHMM,
    )}mm" viewBox="0 0 ${ExportUtils.fmt(P.canvasWMM)} ${ExportUtils.fmt(P.canvasHMM)}">`,
  );
  for (let i = 0; i < state.boxes.length; i++) {
    const box = state.boxes[i];
    const layout = cachedLayouts[i] || layoutBox(doc, box);
    const scale = box.fontSizeMM / UPM;
    svg.push(
      `<g data-box="${ExportUtils.escapeXML(box.name)}" fill="none" stroke="${ExportUtils.escapeXML(P.textColor)}" stroke-width="0.2">`,
    );
    for (const line of layout.lines) {
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        svg.push(
          `<g transform="translate(${ExportUtils.fmt(drawX)} ${ExportUtils.fmt(baselineY)}) scale(${ExportUtils.fmt(
            scale,
          )} ${ExportUtils.fmt(-scale)}) matrix(1 0 ${ExportUtils.fmt(box.slantShear || 0)} ${ExportUtils.fmt(Math.max(box.verticalScale || 1, 0.001))} 0 0)">`,
        );
        for (const st of item.glyph.strokes || []) {
          const d = strokePathData(st, 3);
          if (d) {
            svg.push(`<path d="${d}"/>`);
          }
        }
        svg.push(`</g>`);
      }
    }
    svg.push(`</g>`);
  }
  svg.push("</svg>");
  ExportUtils.downloadText(svg.join("\n"), filename, "image/svg+xml");
}

function strokePathData(st, precision = 3) {
  const nodes = st.nodes || [];
  if (!nodes.length) return "";
  let d = `M ${fmt(nodes[0].x, precision)} ${fmt(nodes[0].y, precision)}`;
  const count = st.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const A = nodes[i];
    const B = nodes[(i + 1) % nodes.length];
    const p0 = [A.x, A.y];
    const p1 = [B.x, B.y];
    const c1 = A.out || p0;
    const c2 = B.in || p1;
    if (!A.out && !B.in) {
      d += ` L ${fmt(p1[0], precision)} ${fmt(p1[1], precision)}`;
    } else {
      d += ` C ${fmt(c1[0], precision)} ${fmt(c1[1], precision)} ${fmt(c2[0], precision)} ${fmt(c2[1], precision)} ${fmt(p1[0], precision)} ${fmt(p1[1], precision)}`;
    }
  }
  if (st.closed) {
    d += " Z";
  }
  return d;
}

function updateStats() {
  const active = getActiveBox();
  const doc = state.currentDoc;
  if (!active || !doc) return;
  const pen = resolvePenForDoc(doc, active);
  document.getElementById("stat-active-box").textContent = active.name;
  document.getElementById("stat-paper").textContent = `${P.canvasWMM} x ${P.canvasHMM} mm`;
  document.getElementById("stat-font").textContent = `${active.fontSizeMM.toFixed(1)} mm letters, ${active.lineHeightMM.toFixed(1)} mm lines`;
  document.getElementById("stat-nib").textContent = `${pen.mm.toFixed(1)} mm nib, ${active.nibMode}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(x0, y0, x1, y1) {
  return Math.hypot(x1 - x0, y1 - y0);
}
