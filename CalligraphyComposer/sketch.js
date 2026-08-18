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
const SVG_UNITS_PER_MM = 96 / 25.4;
const DRAW_FLAT_NIB_RATIO = 0.18;

function fmt(value, digits = 3) {
  return ExportUtils.fmt(value, digits);
}

function mmToSvgUnits(value) {
  return value * SVG_UNITS_PER_MM;
}

function escapeHTML(value) {
  return ExportUtils.escapeXML(value);
}

let panes = [];
let canvas;
let ctx;
let bgCanvas;
let bgCtx;
let drawCanvas;
let drawCtx;
let glyphCanvas;
let overlayCtx;
let wrapEl;
let variantMenuEl;
let boxTextInputEl;
let paperColorInputEl;
let penMarkerEl;
let paperFolder;
let sceneFolder;
let fontFolder;
let boxFolder;
let modifierFolder;
let drawFolder;
let streamFolder;
let fontBinding;
let marginBinding;
let showMarginsBinding;
let modifierDetailBindings = {};
let selectedBoxBindings = {};
let cachedLayouts = [];
let activeBoxId = null;
let nextBoxId = 1;
let dragState = null;
let hoverHandle = null;
let hoverGlyphKey = null;
let lastClickMs = 0;
let renderQueued = false;
const glyphArtworkCache = new Map();
const glSceneCache = {
  key: "",
  instances: null,
  count: 0,
  uploaded: false,
};
const viewport = {
  x: 0,
  y: 0,
  scale: 1,
  initialized: false,
};
const glRenderer = {
  gl: null,
  program: null,
  quadBuffer: null,
  instanceBuffer: null,
  aQuad: null,
  aCenter: null,
  aRadii: null,
  aRotation: null,
  aInk: null,
  uResolution: null,
  uPxPerMM: null,
  uColor: null,
  ready: false,
};
const appState = {
  mode: "text",
};

const P = {
  paperPreset: "A4 Portrait",
  canvasWMM: 210,
  canvasHMM: 297,
  dpi: 144,
  previewScale: 1,
  fitToViewport: true,
  paperColor: "#ffffff",
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
  activeName: "Text layer 1",
  text: "",
  fontSizeMM: FALLBACK_FONT_SIZE_MM,
  lineHeightMM: FALLBACK_LINE_HEIGHT_MM,
  paddingMM: 5,
  trackingMM: 0,
  align: "left",
  slantShear: 0,
  verticalScale: 1,
  modifierPreset: "custom",
  modifierScaleStart: 0.82,
  modifierScaleEnd: 1.38,
  modifierSlantStart: 0,
  modifierSlantEnd: 0.32,
  penId: "p4",
  nibMode: "fixed",
  nibWidthMM: 2.4,
  stampSpacingFactor: 0.32,
  stampSizeBoost: 1,
  inkOpacity: 0.2,
  inkSoftness: 0.34,
  inkOverlapGain: 1.2,
  inkTexture: 0.16,
};
const drawUI = {
  tool: "draw",
  showGrid: true,
  snapGrid: false,
  brushType: "flat",
  roundSize: 1.6,
  flatWidth: 3.2,
  flatAngle: 40,
  streamline: 0.45,
  smoothing: 0.25,
  minDistance: 0.6,
  exportTolerance: 0.18,
};
const streamUI = {
  target: "current",
  autoStream: false,
  streamHost: "127.0.0.1:9080",
  streamPath: "/chat",
};
const drawState = {
  strokes: [],
  selectedStrokeIds: new Set(),
  currentStroke: null,
  lassoPoints: [],
  transformState: null,
  nextStrokeId: 1,
  hoverPointer: null,
  activeTouchPointers: new Map(),
  gestureState: null,
  committedDirty: true,
  committedLayer: null,
  activeLayer: null,
};
const streamState = {
  socket: null,
  connected: false,
  reconnectTimer: null,
  streamTimer: null,
  statusText: "Stream module ready",
};

window.addEventListener("load", () => {
  PaperUtils.applyPaperPreset(P, P.paperPreset);
  createCanvas();
  buildPane();
  bindUI();
  syncCanvasSize();
  initFonts();
  connectStreamSocket();
  refreshSelectionMonitor();
  syncModeVisibility();
  requestRender();
  window.addEventListener("resize", syncDisplaySize);
});

function createCanvas() {
  wrapEl = document.getElementById("wrap");
  boxTextInputEl = document.getElementById("boxTextInput");
  paperColorInputEl = document.getElementById("paperColorInput");
  penMarkerEl = document.getElementById("penMarker");
  bgCanvas = document.createElement("canvas");
  bgCanvas.className = "paper-layer";
  bgCanvas.setAttribute("aria-hidden", "true");
  bgCanvas.style.pointerEvents = "none";
  bgCanvas.style.zIndex = "1";
  bgCtx = bgCanvas.getContext("2d");
  wrapEl.appendChild(bgCanvas);

  drawCanvas = document.createElement("canvas");
  drawCanvas.className = "draw-layer";
  drawCanvas.setAttribute("aria-hidden", "true");
  drawCanvas.style.pointerEvents = "none";
  drawCanvas.style.zIndex = "2";
  drawCtx = drawCanvas.getContext("2d");
  wrapEl.appendChild(drawCanvas);
  drawState.committedLayer = document.createElement("canvas");
  drawState.activeLayer = document.createElement("canvas");

  glyphCanvas = document.createElement("canvas");
  glyphCanvas.className = "glyph-layer";
  glyphCanvas.setAttribute("aria-hidden", "true");
  glyphCanvas.style.pointerEvents = "none";
  glyphCanvas.style.zIndex = "3";
  glyphCanvas.style.background = "transparent";
  wrapEl.appendChild(glyphCanvas);
  initGlyphRenderer();

  canvas = document.createElement("canvas");
  canvas.className = "overlay-layer";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "CalligraphyComposer canvas");
  canvas.style.zIndex = "4";
  overlayCtx = canvas.getContext("2d");
  ctx = overlayCtx;
  wrapEl.appendChild(canvas);
  variantMenuEl = document.createElement("div");
  variantMenuEl.className = "variant-menu";
  variantMenuEl.style.zIndex = "4";
  wrapEl.appendChild(variantMenuEl);
  canvas.addEventListener("pointerdown", onPointerDown);
  wrapEl.addEventListener("pointerdown", onStagePointerDown);
  wrapEl.addEventListener("wheel", onStageWheel, { passive: false });
  canvas.addEventListener("pointermove", onHoverPointerMove);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerLeave);
  variantMenuEl.addEventListener("pointerleave", onHoverPointerLeave);
}

function buildPane() {
  panes = [];
  paperFolder = createPane("docPane");
  paperFolder
    .addInput(appState, "mode", {
      label: "Mode",
      options: {
        Text: "text",
        Draw: "draw",
      },
    })
    .on("change", (ev) => {
      setAppMode(ev.value);
    });
  paperFolder
    .addInput(P, "paperPreset", {
      label: "Paper Size",
      options: Object.keys(PaperUtils.PAPER_PRESETS_MM).reduce((acc, label) => {
        acc[label] = label;
        return acc;
      }, {}),
    })
    .on("change", (ev) => {
      PaperUtils.applyPaperPreset(P, ev.value);
      syncCanvasSize();
      queueAutoStream();
    });
  marginBinding = paperFolder.addInput(P, "marginMM", { label: "Margin", min: 0, max: 80, step: 0.5 });
  marginBinding.on("change", requestRender);
  showMarginsBinding = paperFolder.addInput(P, "showMargins", { label: "Show Margin" });
  showMarginsBinding.on("change", () => {
    syncMarginVisibility();
    requestRender();
  });

  sceneFolder = paperFolder;
  sceneFolder.addInput(P, "dpi", {
    label: "DPI",
    min: 72,
    max: 600,
    step: 1,
  }).on("change", syncCanvasSize);
  sceneFolder.addInput(P, "showGuides", { label: "Show Guides" }).on("change", requestRender);

  boxFolder = createPane("toolPane");
  selectedBoxBindings = {
    penId: boxFolder.addInput(selectionState, "penId", {
      label: "Tool",
      options: {
        "Parallel 2.4": "p4",
        "Parallel 3.8": "p5",
        "Micron 03": "p1",
      },
    }),
    nibWidthMM: boxFolder.addInput(selectionState, "nibWidthMM", {
      label: "Nib width",
      min: 0.1,
      max: 20,
      step: 0.05,
    }),
    stampSpacingFactor: boxFolder.addInput(selectionState, "stampSpacingFactor", {
      label: "Stamp spacing",
      min: 0.02,
      max: 1.2,
      step: 0.01,
    }),
    stampSizeBoost: boxFolder.addInput(selectionState, "stampSizeBoost", {
      label: "Stamp size",
      min: 0.6,
      max: 1.6,
      step: 0.01,
    }),
    inkOpacity: boxFolder.addInput(selectionState, "inkOpacity", {
      label: "Ink opacity",
      min: 0.02,
      max: 1,
      step: 0.01,
    }),
    inkSoftness: boxFolder.addInput(selectionState, "inkSoftness", {
      label: "Edge softness",
      min: 0.02,
      max: 0.95,
      step: 0.01,
    }),
    inkOverlapGain: boxFolder.addInput(selectionState, "inkOverlapGain", {
      label: "Overlap gain",
      min: 0.2,
      max: 3,
      step: 0.01,
    }),
    inkTexture: boxFolder.addInput(selectionState, "inkTexture", {
      label: "Texture amount",
      min: 0,
      max: 1,
      step: 0.01,
    }),
  };

  fontFolder = createPane("scriptPane");
  buildFontBinding({ italics: "italics" });
  syncMarginVisibility();
  Object.assign(selectedBoxBindings, {
    fontSizeMM: fontFolder.addInput(selectionState, "fontSizeMM", {
      label: "Letter size",
      min: 4,
      max: 80,
      step: 0.1,
    }),
    lineHeightMM: fontFolder.addInput(selectionState, "lineHeightMM", {
      label: "Line height",
      min: 2,
      max: 120,
      step: 0.01,
    }),
    trackingMM: fontFolder.addInput(selectionState, "trackingMM", {
      label: "Letter Spacing",
      min: -10,
      max: 20,
      step: 0.01,
    }),
    slantShear: fontFolder.addInput(selectionState, "slantShear", {
      label: "Slant",
      min: -0.8,
      max: 0.8,
      step: 0.01,
    }),
    verticalScale: fontFolder.addInput(selectionState, "verticalScale", {
      label: "Vertical scale",
      min: 0.2,
      max: 3,
      step: 0.01,
    }),
  });

  modifierFolder = createPane("modifierPane");
  selectedBoxBindings.modifierPreset = modifierFolder.addInput(selectionState, "modifierPreset", {
    label: "Preset",
    options: {
      Custom: "custom",
      Cascade: "cascade",
      "Line Spaced": "linespaced",
    },
  });
  modifierDetailBindings = {
    modifierScaleStart: modifierFolder.addInput(selectionState, "modifierScaleStart", {
      label: "Scale start",
      min: 0.2,
      max: 3,
      step: 0.01,
    }),
    modifierScaleEnd: modifierFolder.addInput(selectionState, "modifierScaleEnd", {
      label: "Scale end",
      min: 0.2,
      max: 3,
      step: 0.01,
    }),
    modifierSlantStart: modifierFolder.addInput(selectionState, "modifierSlantStart", {
      label: "Slant start",
      min: -1,
      max: 1,
      step: 0.01,
    }),
    modifierSlantEnd: modifierFolder.addInput(selectionState, "modifierSlantEnd", {
      label: "Slant end",
      min: -1,
      max: 1,
      step: 0.01,
    }),
  };

  for (const [key, blade] of Object.entries(selectedBoxBindings)) {
    blade.on("change", () => {
      if (key === "penId") {
        syncNibWidthToPen();
      }
      applySelectionStateToBox();
      queueAutoStream();
      requestRender();
    });
  }
  for (const blade of Object.values(modifierDetailBindings)) {
    blade.on("change", () => {
      applySelectionStateToBox();
      queueAutoStream();
      requestRender();
    });
  }

  drawFolder = createPane("drawPane");
  drawFolder
    .addInput(drawUI, "tool", {
      label: "Tool",
      options: {
        Draw: "draw",
        Lasso: "lasso",
        Transform: "transform",
      },
    })
    .on("change", () => {
      clearDrawTransientState();
      requestRender();
      syncModeVisibility();
    });
  drawFolder.addInput(drawUI, "showGrid", { label: "Show grid" }).on("change", requestRender);
  drawFolder.addInput(drawUI, "snapGrid", { label: "Snap grid" }).on("change", () => {
    applyCurrentBrushToExistingDrawStrokes();
    updateDrawStatus();
    requestRender();
  });
  drawFolder
    .addInput(drawUI, "brushType", {
      label: "Brush",
      options: {
        Round: "round",
        "Flat nib": "flat",
      },
    })
    .on("change", () => {
      applyCurrentBrushToExistingDrawStrokes();
      updateDrawStatus();
      requestRender();
    });
  drawFolder.addInput(drawUI, "roundSize", { label: "Round size", min: 0.4, max: 8, step: 0.1 }).on("change", () => {
    applyCurrentBrushToExistingDrawStrokes();
    updateDrawStatus();
    requestRender();
  });
  drawFolder.addInput(drawUI, "flatWidth", { label: "Flat width", min: 0.6, max: 12, step: 0.1 }).on("change", () => {
    applyCurrentBrushToExistingDrawStrokes();
    updateDrawStatus();
    requestRender();
  });
  drawFolder.addInput(drawUI, "flatAngle", { label: "Nib angle", min: 0, max: 180, step: 1 }).on("change", () => {
    applyCurrentBrushToExistingDrawStrokes();
    updateDrawStatus();
    requestRender();
  });
  drawFolder.addInput(drawUI, "streamline", { min: 0, max: 2, step: 0.01 }).on("change", applyCurrentBrushToExistingDrawStrokes);
  drawFolder.addInput(drawUI, "smoothing", { min: 0, max: 2, step: 0.01 }).on("change", applyCurrentBrushToExistingDrawStrokes);
  drawFolder.addInput(drawUI, "minDistance", { label: "Min distance", min: 0.1, max: 5, step: 0.1 }).on(
    "change",
    applyCurrentBrushToExistingDrawStrokes,
  );
  drawFolder.addInput(drawUI, "exportTolerance", { label: "Export fit", min: 0.03, max: 1, step: 0.01 });

  streamFolder = createPane("streamPane");
  streamFolder.addInput(streamUI, "target", {
    label: "Source",
    options: {
      "Current mode": "current",
      "Text only": "text",
      "Draw only": "draw",
      "Text + Draw": "combined",
    },
  }).on("change", () => {
    updateStreamStatus();
  });
  streamFolder.addInput(streamUI, "autoStream", { label: "Auto stream" }).on("change", () => {
    updateStreamStatus();
  });
  streamFolder.addInput(streamUI, "streamHost", { label: "SAXI host" }).on("change", reconnectStreamSocket);
  streamFolder.addInput(streamUI, "streamPath", { label: "SAXI path" }).on("change", reconnectStreamSocket);
  syncModifierVisibility();
  syncModeVisibility();
}

function createPane(id) {
  const pane = new Tweakpane.Pane({ container: document.getElementById(id) });
  panes.push(pane);
  return pane;
}

function refreshPanes() {
  for (const pane of panes) {
    pane?.refresh();
  }
  syncMarginVisibility();
  syncModifierVisibility();
  syncModeVisibility();
}

function bindUI() {
  boxTextInputEl?.addEventListener("input", () => {
    selectionState.text = boxTextInputEl.value;
    applySelectionStateToBox();
    trimVariantMap(getActiveBox());
    queueAutoStream();
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
    queueAutoStream();
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
    queueAutoStream();
    requestRender();
  });

  document.getElementById("deleteBoxBtn").addEventListener("click", () => {
    const index = state.boxes.findIndex((box) => box.id === activeBoxId);
    if (index < 0) return;
    state.boxes.splice(index, 1);
    activeBoxId = state.boxes.length ? state.boxes[Math.max(0, index - 1)]?.id ?? state.boxes[0].id : null;
    refreshSelectionMonitor();
    queueAutoStream();
    requestRender();
  });

  document.getElementById("fitBtn").addEventListener("click", () => {
    P.fitToViewport = true;
    P.previewScale = 1;
    syncDisplaySize();
    refreshPanes();
  });

  document.getElementById("resetViewBtn").addEventListener("click", () => {
    P.fitToViewport = false;
    P.previewScale = 1;
    syncDisplaySize();
    refreshPanes();
  });

  document.getElementById("svgBtn").addEventListener("click", exportSvg);
  document.getElementById("pathSvgBtn").addEventListener("click", exportPathSvg);
  document.getElementById("brushSvgBtn")?.addEventListener("click", exportDrawBrushSvg);
  document.getElementById("streamBtn")?.addEventListener("click", streamAppNow);
  document.getElementById("undoDrawBtn")?.addEventListener("click", undoLastDrawStroke);
  document.getElementById("clearDrawBtn")?.addEventListener("click", clearAllDrawStrokes);
  document.getElementById("alignLeftBtn").addEventListener("click", () => setAlignment("left"));
  document.getElementById("alignCenterBtn").addEventListener("click", () => setAlignment("center"));
  document.getElementById("alignRightBtn").addEventListener("click", () => setAlignment("right"));
  paperColorInputEl?.addEventListener("input", () => {
    P.paperColor = paperColorInputEl.value;
    syncColorIndicators();
    requestRender();
  });
  document.getElementById("inkSwatches")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    P.textColor = button.dataset.color;
    syncColorIndicators();
    requestRender();
  });
  updateDrawStatus();
}

function syncCanvasSize() {
  const size = PaperUtils.getCanvasPixelSize(P);
  if (bgCanvas) {
    bgCanvas.width = size.width;
    bgCanvas.height = size.height;
  }
  if (drawCanvas) {
    drawCanvas.width = size.width;
    drawCanvas.height = size.height;
  }
  if (glyphCanvas) {
    glyphCanvas.width = size.width;
    glyphCanvas.height = size.height;
  }
  if (drawState.committedLayer) {
    drawState.committedLayer.width = size.width;
    drawState.committedLayer.height = size.height;
  }
  if (drawState.activeLayer) {
    drawState.activeLayer.width = size.width;
    drawState.activeLayer.height = size.height;
  }
  canvas.width = size.width;
  canvas.height = size.height;
  resizeGlyphRenderer();
  drawState.committedDirty = true;
  clearDrawLayer(drawState.activeLayer);
  syncDisplaySize();
  requestRender();
}

function syncDisplaySize() {
  const pxSize = PaperUtils.getCanvasPixelSize(P);
  const wrapRect = wrapEl?.getBoundingClientRect();
  if (!wrapRect) return;
  const availableW = Math.max(1, wrapRect.width - 120);
  const availableH = Math.max(1, wrapRect.height - 120);
  const fitScale = Math.min(availableW / pxSize.width, availableH / pxSize.height, 1);
  if (P.fitToViewport || !viewport.initialized) {
    viewport.scale = fitScale * P.previewScale;
    viewport.x = (wrapRect.width - pxSize.width * viewport.scale) * 0.5;
    viewport.y = (wrapRect.height - pxSize.height * viewport.scale) * 0.5;
    viewport.initialized = true;
  }
  applyViewportTransform();
  requestRender();
}

function applyViewportTransform() {
  const pxSize = PaperUtils.getCanvasPixelSize(P);
  for (const layer of [bgCanvas, drawCanvas, glyphCanvas, canvas]) {
    if (!layer) continue;
    layer.style.width = `${pxSize.width}px`;
    layer.style.height = `${pxSize.height}px`;
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.transformOrigin = "0 0";
    layer.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
  }
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
      const bundled = getBundledFontDoc(P.fontId);
      let data;
      if (bundled) {
        data = bundled;
      } else {
        const res = await fetch(entry.resolvedPath, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Font fetch failed with status ${res.status} for ${entry.resolvedPath}`);
        }
        data = await res.json();
      }
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
    queueAutoStream();
    requestRender();
  });
}

function syncMarginVisibility() {
  const el = marginBinding?.element || marginBinding?.controller?.view?.element || marginBinding?.controller_?.view?.element;
  if (!el) return;
  el.style.display = P.showMargins ? "" : "none";
}

function syncModifierVisibility() {
  const visible = selectionState.modifierPreset === "cascade";
  for (const blade of Object.values(modifierDetailBindings)) {
    const el = blade?.element || blade?.controller?.view?.element || blade?.controller_?.view?.element;
    if (!el) continue;
    el.style.display = visible ? "" : "none";
  }
}

function clearDrawTransientState() {
  drawState.currentStroke = null;
  drawState.lassoPoints = [];
  drawState.transformState = null;
  clearDrawLayer(drawState.activeLayer);
  hidePenMarker();
}

function setAppMode(mode) {
  appState.mode = mode === "draw" ? "draw" : "text";
  hideVariantMenu(true);
  clearDrawTransientState();
  syncModeVisibility();
  updateStreamStatus();
  requestRender();
}

function syncModeVisibility() {
  const isDrawMode = appState.mode === "draw";
  document.getElementById("drawActionsCard")?.classList.toggle("hidden", !isDrawMode);
  document.getElementById("addBoxBtn")?.classList.toggle("hidden", isDrawMode);
  document.getElementById("inkSwatches")?.classList.toggle("hidden", isDrawMode);
  const textEditorCard = document.getElementById("activeLayerTitle")?.closest(".panel-card");
  textEditorCard?.classList.toggle("hidden", isDrawMode);
  const scriptPaneCard = document.getElementById("scriptPane")?.closest(".panel-card");
  scriptPaneCard?.classList.toggle("hidden", isDrawMode);
  const modifierPaneCard = document.getElementById("modifierPane")?.closest(".panel-card");
  modifierPaneCard?.classList.toggle("hidden", isDrawMode);
  const drawPaneCard = document.getElementById("drawPane")?.closest(".panel-card");
  drawPaneCard?.classList.toggle("hidden", false);
  canvas.style.cursor = isDrawMode ? "crosshair" : "default";
  updateDrawStatus();
  updateStreamStatus();
}

function updateDrawStatus(message = "") {
  const brushBadge = document.getElementById("brushBadge");
  const drawStatus = document.getElementById("drawStatus");
  if (brushBadge) brushBadge.textContent = getDrawBrushDisplayLabel(getDrawBrushSnapshot());
  if (drawStatus) {
    drawStatus.textContent =
      message ||
      (appState.mode === "draw"
        ? `tool: ${drawUI.tool}${drawState.selectedStrokeIds.size ? `, selected ${drawState.selectedStrokeIds.size}` : ""}`
        : "Draw mode ready");
  }
}

function updateStreamStatus(message = "") {
  if (message) streamState.statusText = message;
  const streamStatus = document.getElementById("streamStatus");
  const connectionBadge = document.getElementById("connectionBadge");
  if (streamStatus) {
    const targetLabel =
      streamUI.target === "current"
        ? `current (${appState.mode})`
        : streamUI.target === "combined"
          ? "text + draw"
          : streamUI.target;
    streamStatus.textContent = message || `source: ${targetLabel}${streamUI.autoStream ? ", auto" : ""}`;
  }
  if (connectionBadge) {
    connectionBadge.textContent = `socket: ${streamState.connected ? "connected" : "disconnected"}`;
  }
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
  refreshPanes();
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
  if (!canvas || !bgCtx || !overlayCtx) return;
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  drawCtx?.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  overlayCtx.clearRect(0, 0, canvas.width, canvas.height);

  const pxPerMM = PaperUtils.getPxPerMM(P);
  ctx = bgCtx;
  ctx.save();
  ctx.scale(pxPerMM, pxPerMM);
  drawPaper();
  drawGuides();

  if (!state.currentDoc) {
    drawLoadingState();
    clearGlyphRenderer();
  } else {
    cachedLayouts = state.boxes.map((box) => layoutBox(state.currentDoc, box));
    renderGlyphScene(state.currentDoc);
  }
  ctx.restore();
  renderDrawScene();

  ctx = overlayCtx;
  ctx.save();
  ctx.scale(pxPerMM, pxPerMM);
  if (state.currentDoc && appState.mode === "text") {
    drawBoxesOverlay(state.currentDoc);
  }
  drawDrawOverlay();
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
  if (appState.mode === "draw" && drawUI.showGrid) {
    ctx.strokeStyle = "#dfe4ef";
    ctx.lineWidth = 0.12;
    for (let x = 0; x <= P.canvasWMM; x += 5) {
      const major = x % 25 === 0;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, P.canvasHMM);
      ctx.strokeStyle = major ? "#cbd3e2" : "#e7ebf3";
      ctx.lineWidth = major ? 0.16 : 0.1;
      ctx.stroke();
    }
    for (let y = 0; y <= P.canvasHMM; y += 5) {
      const major = y % 25 === 0;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(P.canvasWMM, y);
      ctx.strokeStyle = major ? "#cbd3e2" : "#e7ebf3";
      ctx.lineWidth = major ? 0.16 : 0.1;
      ctx.stroke();
    }
    return;
  }
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

function drawBoxesOverlay(doc) {
  for (let i = 0; i < state.boxes.length; i++) {
    drawTextBoxOverlay(doc, state.boxes[i], cachedLayouts[i], state.boxes[i].id === activeBoxId);
  }
}

function drawTextBoxOverlay(doc, box, layout, isActive) {
  if (!layout) return;
  const totalLines = Math.max(layout.lines.length, 1);
  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
    const line = layout.lines[lineIndex];
    const baselineY = box.yMM + box.paddingMM + line.baselineMM;
    const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
    let glyphIndex = 0;
    for (const item of line.items) {
      if (!item.glyph) continue;
      const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
      const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
      if (item.key === hoverGlyphKey && item.variants?.length > 1) {
        drawGlyphHoverOutline(item, drawX, baselineY, box.fontSizeMM, modifier.slantShear, modifier.verticalScale, doc.metrics);
      }
      if (P.showSkeletonOverlay) {
        drawGlyphSkeletonOverlay(item, drawX, baselineY, box.fontSizeMM, modifier.slantShear, modifier.verticalScale);
      }
      glyphIndex += 1;
    }
  }

  if (isActive) {
    const boxHeightMM = getBoxHeightMM(box, layout);
    ctx.fillStyle = P.selectionFill;
    ctx.fillRect(box.xMM, box.yMM, box.widthMM, boxHeightMM);
    ctx.strokeStyle = P.frameColor;
    ctx.lineWidth = 0.4;
    ctx.strokeRect(box.xMM, box.yMM, box.widthMM, boxHeightMM);
    drawHandles(box, boxHeightMM);
  }
}

function drawGlyphSkeletonOverlay(item, xMM, baselineYMM, emSizeMM, slantShear, verticalScale) {
  const scale = emSizeMM / UPM;
  const transformed = transformGlyphSkeleton(item.glyph, slantShear, verticalScale);
  ctx.save();
  ctx.translate(xMM, baselineYMM);
  ctx.scale(scale, -scale);
  ctx.strokeStyle = "rgba(36,84,166,.55)";
  ctx.lineWidth = 2 / Math.max(emSizeMM, 1);
  for (const st of transformed.strokes || []) {
    drawSkeletonPathCanvas(st);
  }
  ctx.restore();
}

function renderGlyphScene(doc) {
  if (!glRenderer.ready) {
    drawBoxesCpu(doc);
    return;
  }
  const key = computeSceneGeometryKey(doc);
  if (glSceneCache.key !== key) {
    const built = buildGlyphStampInstances(doc);
    glSceneCache.key = key;
    glSceneCache.instances = built.instances;
    glSceneCache.count = built.count;
    glSceneCache.uploaded = false;
  }
  uploadGlyphSceneIfNeeded();
  drawGlyphSceneGL();
}

function drawBoxesCpu(doc) {
  for (let i = 0; i < state.boxes.length; i++) {
    const box = state.boxes[i];
    const layout = cachedLayouts[i];
    if (!layout) continue;
    const pen = resolvePenForDoc(doc, box);
    const totalLines = Math.max(layout.lines.length, 1);
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
      let glyphIndex = 0;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
        drawGlyphItem(item, pen, drawX, baselineY, box.fontSizeMM, modifier.slantShear, modifier.verticalScale);
        glyphIndex += 1;
      }
    }
  }
}

function computeSceneGeometryKey(doc) {
  return JSON.stringify({
    fontId: P.fontId,
    pens: doc?.pens,
    boxes: state.boxes.map((box) => ({
      id: box.id,
      xMM: box.xMM,
      yMM: box.yMM,
      widthMM: box.widthMM,
      heightMM: box.heightMM,
      paddingMM: box.paddingMM,
      text: box.text,
      fontSizeMM: box.fontSizeMM,
      lineHeightMM: box.lineHeightMM,
      trackingMM: box.trackingMM,
      align: box.align,
      slantShear: box.slantShear,
      verticalScale: box.verticalScale,
      modifierPreset: box.modifierPreset,
      modifierScaleStart: box.modifierScaleStart,
      modifierScaleEnd: box.modifierScaleEnd,
      modifierSlantStart: box.modifierSlantStart,
      modifierSlantEnd: box.modifierSlantEnd,
      penId: box.penId,
      nibWidthMM: box.nibWidthMM,
      stampSpacingFactor: box.stampSpacingFactor,
      stampSizeBoost: box.stampSizeBoost,
      inkOpacity: box.inkOpacity,
      inkSoftness: box.inkSoftness,
      inkOverlapGain: box.inkOverlapGain,
      inkTexture: box.inkTexture,
      variantMap: box.variantMap,
      leftKernMMMap: box.leftKernMMMap,
    })),
  });
}

function buildGlyphStampInstances(doc) {
  const instances = [];
  for (let i = 0; i < state.boxes.length; i++) {
    const box = state.boxes[i];
    const layout = cachedLayouts[i] || layoutBox(doc, box);
    const pen = resolvePenForDoc(doc, box);
    const scale = box.fontSizeMM / UPM;
    const totalLines = Math.max(layout.lines.length, 1);
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
      let glyphIndex = 0;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
        const transformed = transformGlyphSkeleton(item.glyph, modifier.slantShear, modifier.verticalScale);
        const spacingFactor = box.stampSpacingFactor ?? 0.32;
        const stampSizeBoost = box.stampSizeBoost ?? 1;
        const inkOpacity = box.inkOpacity ?? 0.2;
        const inkSoftness = box.inkSoftness ?? 0.34;
        const inkOverlapGain = box.inkOverlapGain ?? 1.2;
        const inkTexture = box.inkTexture ?? 0.16;
        const spacingU = Math.max(0.25, pen.wU * spacingFactor);
        for (const st of transformed.strokes || []) {
          const stamps = sampleStrokeForStamps(st, spacingU);
          for (const stamp of stamps) {
            const centerXMM = drawX + stamp.x * scale;
            const centerYMM = baselineY - stamp.y * scale;
            const halfWMM = (pen.mm * stamp.w * stampSizeBoost) * 0.5;
            const halfHMM = (pen.mm * Math.max(pen.ratio, MIN_RATIO) * stamp.w * stampSizeBoost) * 0.5;
            const angle = (-pen.angle * Math.PI) / 180;
            instances.push(
              centerXMM,
              centerYMM,
              halfWMM,
              halfHMM,
              Math.cos(angle),
              Math.sin(angle),
              inkOpacity,
              inkSoftness,
              inkOverlapGain,
              inkTexture,
            );
          }
        }
        glyphIndex += 1;
      }
    }
  }
  return { instances: new Float32Array(instances), count: instances.length / 10 };
}

function initGlyphRenderer() {
  const gl = glyphCanvas?.getContext("webgl2", { alpha: true, antialias: true });
  if (!gl) return;
  const vertexSource = `
    attribute vec2 a_quad;
    attribute vec2 a_center;
    attribute vec2 a_radii;
    attribute vec2 a_rotation;
    attribute vec4 a_ink;
    uniform vec2 u_resolution;
    uniform float u_pxPerMM;
    varying vec2 v_uv;
    varying vec2 v_worldMM;
    varying vec4 v_ink;
    void main() {
      vec2 localMM = vec2(a_quad.x * a_radii.x, a_quad.y * a_radii.y);
      vec2 rotatedMM = vec2(
        localMM.x * a_rotation.x - localMM.y * a_rotation.y,
        localMM.x * a_rotation.y + localMM.y * a_rotation.x
      );
      v_worldMM = a_center + rotatedMM;
      vec2 px = v_worldMM * u_pxPerMM;
      vec2 zeroToOne = px / u_resolution;
      vec2 clip = zeroToOne * 2.0 - 1.0;
      v_uv = a_quad;
      v_ink = a_ink;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform vec4 u_color;
    varying vec2 v_uv;
    varying vec2 v_worldMM;
    varying vec4 v_ink;
    float hash21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    void main() {
      float dist = length(v_uv);
      if (dist > 1.0) discard;
      float softness = clamp(v_ink.y, 0.02, 0.98);
      float inner = max(0.0, 1.0 - softness);
      float coverage = 1.0 - smoothstep(inner, 1.0, dist);
      float grainA = hash21(floor(v_worldMM * 3.0));
      float grainB = hash21(floor(v_worldMM.yx * 5.0 + 17.0));
      float grain = mix(1.0, 0.82 + 0.18 * (0.55 * grainA + 0.45 * grainB), clamp(v_ink.w, 0.0, 1.0));
      float alpha = clamp(coverage * v_ink.x * v_ink.z * grain, 0.0, 1.0);
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(u_color.rgb * alpha, alpha);
    }
  `;
  const program = createGLProgram(gl, vertexSource, fragmentSource);
  if (!program) return;
  glRenderer.gl = gl;
  glRenderer.program = program;
  glRenderer.quadBuffer = gl.createBuffer();
  glRenderer.instanceBuffer = gl.createBuffer();
  glRenderer.aQuad = gl.getAttribLocation(program, "a_quad");
  glRenderer.aCenter = gl.getAttribLocation(program, "a_center");
  glRenderer.aRadii = gl.getAttribLocation(program, "a_radii");
  glRenderer.aRotation = gl.getAttribLocation(program, "a_rotation");
  glRenderer.aInk = gl.getAttribLocation(program, "a_ink");
  glRenderer.uResolution = gl.getUniformLocation(program, "u_resolution");
  glRenderer.uPxPerMM = gl.getUniformLocation(program, "u_pxPerMM");
  glRenderer.uColor = gl.getUniformLocation(program, "u_color");
  gl.bindBuffer(gl.ARRAY_BUFFER, glRenderer.quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  glRenderer.ready = true;
}

function createGLProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileGLShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileGLShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("WebGL link failed:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function compileGLShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("WebGL shader compile failed:", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function resizeGlyphRenderer() {
  if (!glRenderer.ready) return;
  glRenderer.gl.viewport(0, 0, glyphCanvas.width, glyphCanvas.height);
  glSceneCache.uploaded = false;
}

function uploadGlyphSceneIfNeeded() {
  if (!glRenderer.ready || glSceneCache.uploaded) return;
  const gl = glRenderer.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, glRenderer.instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, glSceneCache.instances || new Float32Array(), gl.STATIC_DRAW);
  glSceneCache.uploaded = true;
}

function drawGlyphSceneGL() {
  if (!glRenderer.ready) return;
  const gl = glRenderer.gl;
  gl.viewport(0, 0, glyphCanvas.width, glyphCanvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!glSceneCache.count) return;
  gl.useProgram(glRenderer.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, glRenderer.quadBuffer);
  gl.enableVertexAttribArray(glRenderer.aQuad);
  gl.vertexAttribPointer(glRenderer.aQuad, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(glRenderer.aQuad, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, glRenderer.instanceBuffer);
  gl.enableVertexAttribArray(glRenderer.aCenter);
  gl.vertexAttribPointer(glRenderer.aCenter, 2, gl.FLOAT, false, 40, 0);
  gl.vertexAttribDivisor(glRenderer.aCenter, 1);
  gl.enableVertexAttribArray(glRenderer.aRadii);
  gl.vertexAttribPointer(glRenderer.aRadii, 2, gl.FLOAT, false, 40, 8);
  gl.vertexAttribDivisor(glRenderer.aRadii, 1);
  gl.enableVertexAttribArray(glRenderer.aRotation);
  gl.vertexAttribPointer(glRenderer.aRotation, 2, gl.FLOAT, false, 40, 16);
  gl.vertexAttribDivisor(glRenderer.aRotation, 1);
  gl.enableVertexAttribArray(glRenderer.aInk);
  gl.vertexAttribPointer(glRenderer.aInk, 4, gl.FLOAT, false, 40, 24);
  gl.vertexAttribDivisor(glRenderer.aInk, 1);

  gl.uniform2f(glRenderer.uResolution, glyphCanvas.width, glyphCanvas.height);
  gl.uniform1f(glRenderer.uPxPerMM, PaperUtils.getPxPerMM(P));
  const color = parseHexColor(P.textColor);
  gl.uniform4f(glRenderer.uColor, color[0], color[1], color[2], color[3]);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, glSceneCache.count);
}

function clearGlyphRenderer() {
  if (!glRenderer.ready) return;
  const gl = glRenderer.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function parseHexColor(value) {
  const hex = String(value || "#000000").replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(normalized, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255, 1];
}

function drawGlyphHoverOutline(item, drawX, baselineY, emSizeMM, slantShear, verticalScale, metrics) {
  const scale = emSizeMM / UPM;
  const transformed = transformGlyphSkeleton(item.glyph, slantShear, verticalScale);
  const bounds = skeletonBounds(transformed);
  ctx.save();
  ctx.strokeStyle = "rgba(76, 125, 255, 0.55)";
  ctx.lineWidth = 0.35;
  ctx.strokeRect(
    drawX + bounds.x0 * scale - 0.6,
    baselineY - bounds.y1 * scale - 0.6,
    Math.max(item.advance * scale, (bounds.x1 - bounds.x0) * scale) + 1.2,
    Math.max(0.1, (bounds.y1 - bounds.y0) * scale) + 1.2,
  );
  ctx.restore();
}

function drawGlyphItem(item, pen, xMM, baselineYMM, emSizeMM, slantShear, verticalScale) {
  const scale = emSizeMM / UPM;
  const transformed = transformGlyphSkeleton(item.glyph, slantShear, verticalScale);
  const cached = getCachedGlyphArtwork(item, pen, transformed, slantShear, verticalScale);
  ctx.save();
  ctx.translate(xMM, baselineYMM);
  ctx.scale(scale, -scale);
  ctx.fillStyle = P.textColor;
  ctx.fill(cached.path, "nonzero");
  if (P.showSkeletonOverlay) {
    ctx.strokeStyle = "rgba(36,84,166,.55)";
    ctx.lineWidth = 2 / Math.max(emSizeMM, 1);
    for (const st of transformed.strokes || []) {
      drawSkeletonPathCanvas(st);
    }
  }
  ctx.restore();
}

function transformGlyphSkeleton(glyph, slantShear, verticalScale) {
  const shear = slantShear || 0;
  const vScale = Math.max(verticalScale || 1, 0.001);
  const mapPoint = (pt) => [pt[0] + shear * pt[1], pt[1] * vScale];
  return {
    ...glyph,
    strokes: (glyph.strokes || []).map((st) => ({
      ...st,
      nodes: (st.nodes || []).map((node) => {
        const mapped = mapPoint([node.x, node.y]);
        return {
          ...node,
          x: mapped[0],
          y: mapped[1],
          in: node.in ? mapPoint(node.in) : undefined,
          out: node.out ? mapPoint(node.out) : undefined,
        };
      }),
    })),
  };
}

function resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems) {
  const base = {
    slantShear: box.slantShear || 0,
    verticalScale: Math.max(box.verticalScale || 1, 0.001),
  };
  if ((box.modifierPreset || "custom") !== "cascade") {
    return base;
  }
  const lineT = totalLines <= 1 ? 1 : lineIndex / (totalLines - 1);
  const glyphT = totalItems <= 1 ? 1 : glyphIndex / (totalItems - 1);
  const scaleStart = box.modifierScaleStart ?? 0.82;
  const scaleEnd = box.modifierScaleEnd ?? 1.38;
  const slantStart = box.modifierSlantStart ?? 0;
  const slantEnd = box.modifierSlantEnd ?? 0.32;
  return {
    verticalScale: base.verticalScale * (scaleStart + (scaleEnd - scaleStart) * lineT),
    slantShear: base.slantShear + slantStart + (slantEnd - slantStart) * glyphT,
  };
}

function getCachedGlyphArtwork(item, pen, transformedGlyph = item.glyph, slantShear = 0, verticalScale = 1) {
  const cacheKey = [
    P.fontId,
    item.name,
    item.activeVariant || "default",
    pen.id || pen.name,
    fmt(pen.wU, 4),
    fmt(pen.ratio, 4),
    fmt(pen.angle, 4),
    fmt(slantShear || 0, 4),
    fmt(Math.max(verticalScale || 1, 0.001), 4),
  ].join("|");
  let cached = glyphArtworkCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const polys = expandGlyph(transformedGlyph, pen, 4).filter(
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

function drawHandles(box, boxHeightMM = box.heightMM) {
  for (const handle of getBoxHandles(box, boxHeightMM)) {
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
  if ((box.modifierPreset || "custom") === "linespaced") {
    applyLineSpacedPreset(layout.lines, maxWidthU, box.align);
  }
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
    (metrics.ascender - metrics.descender) * scaleMMPerUnit + Math.max(0, lineCount - 1) * lineAdvanceMM;
  box.heightMM = Math.max(12, contentHeightMM + box.paddingMM * 2);
  return {
    lines,
    heightMM: box.heightMM,
    overflow: false,
    missing: layout.missing,
    textLength: box.text.length,
  };
}

function applyLineSpacedPreset(lines, maxWidthU, align = "left") {
  for (const line of lines) {
    const itemCount = line.items.length;
    if (itemCount <= 1) {
      line.width = Math.min(line.width, maxWidthU);
      line.offsetX = previewLineOffset(line.width, maxWidthU, align);
      continue;
    }
    const glyphSpanU = line.items.reduce((sum, item) => Math.max(sum, item.x + item.advance), 0);
    const gaps = itemCount - 1;
    const derivedTrackingU = gaps > 0 ? Math.max(0, (maxWidthU - glyphSpanU) / gaps) : 0;
    for (let i = 0; i < line.items.length; i++) {
      const item = line.items[i];
      item.x += derivedTrackingU * i;
    }
    line.width = Math.min(maxWidthU, glyphSpanU + derivedTrackingU * gaps);
    line.offsetX = previewLineOffset(line.width, maxWidthU, align);
  }
}

function getBoxHeightMM(box, layout = null) {
  return Math.max(12, layout?.heightMM ?? box.heightMM ?? 12);
}

function createTextBox(overrides = {}) {
  const id = nextBoxId++;
  const baseFontSizeMM = overrides.fontSizeMM ?? FALLBACK_FONT_SIZE_MM;
  return {
    id,
    name: overrides.name || `Text layer ${id}`,
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
    modifierPreset: overrides.modifierPreset || "custom",
    modifierScaleStart: overrides.modifierScaleStart ?? 0.82,
    modifierScaleEnd: overrides.modifierScaleEnd ?? 1.38,
    modifierSlantStart: overrides.modifierSlantStart ?? 0,
    modifierSlantEnd: overrides.modifierSlantEnd ?? 0.32,
    penId: overrides.penId || "p4",
    nibMode: overrides.nibMode || "fixed",
    nibWidthMM: overrides.nibWidthMM ?? (overrides.penWidthScale ? 2.4 * overrides.penWidthScale : 2.4),
    stampSpacingFactor: overrides.stampSpacingFactor ?? 0.32,
    stampSizeBoost: overrides.stampSizeBoost ?? 1,
    inkOpacity: overrides.inkOpacity ?? 0.2,
    inkSoftness: overrides.inkSoftness ?? 0.34,
    inkOverlapGain: overrides.inkOverlapGain ?? 1.2,
    inkTexture: overrides.inkTexture ?? 0.16,
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
  const duplicateBtn = document.getElementById("duplicateBoxBtn");
  const deleteBtn = document.getElementById("deleteBoxBtn");
  document.getElementById("boxCountLabel").textContent = `${state.boxes.length} text box${state.boxes.length === 1 ? "" : "es"}`;
  if (!active) {
    selectionState.activeName = "None";
    refreshPanes();
    if (boxTextInputEl) {
      boxTextInputEl.value = "";
      boxTextInputEl.disabled = true;
    }
    if (duplicateBtn) duplicateBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    document.getElementById("activeLayerTitle").textContent = "No text layer selected";
    syncAlignmentButtons(null);
    updateStats();
    return;
  }
  selectionState.activeName = active.name;
  for (const key of ["text", "fontSizeMM", "lineHeightMM", "trackingMM", "align", "slantShear", "verticalScale", "modifierPreset", "modifierScaleStart", "modifierScaleEnd", "modifierSlantStart", "modifierSlantEnd", "penId", "nibWidthMM", "stampSpacingFactor", "stampSizeBoost", "inkOpacity", "inkSoftness", "inkOverlapGain", "inkTexture"]) {
    selectionState[key] = active[key];
  }
  refreshPanes();
  if (boxTextInputEl) {
    boxTextInputEl.value = active.text || "";
    boxTextInputEl.disabled = false;
  }
  if (duplicateBtn) duplicateBtn.disabled = false;
  if (deleteBtn) deleteBtn.disabled = false;
  document.getElementById("activeLayerTitle").textContent = layerLabelForBox(active);
  syncAlignmentButtons(active.align);
  syncColorIndicators();
  updateStats();
}

function applySelectionStateToBox() {
  const box = getActiveBox();
  if (!box) return;
  for (const key of ["text", "fontSizeMM", "lineHeightMM", "paddingMM", "trackingMM", "penId", "nibWidthMM", "slantShear", "verticalScale", "modifierPreset", "modifierScaleStart", "modifierScaleEnd", "modifierSlantStart", "modifierSlantEnd", "stampSpacingFactor", "stampSizeBoost", "inkOpacity", "inkSoftness", "inkOverlapGain", "inkTexture"]) {
    box[key] = selectionState[key];
  }
  box.align = selectionState.align;
}

function setAlignment(align) {
  selectionState.align = align;
  applySelectionStateToBox();
  syncAlignmentButtons(align);
  refreshPanes();
  queueAutoStream();
  requestRender();
}

function syncNibWidthToPen() {
  const doc = state.currentDoc;
  if (!doc) return;
  const pen = doc.pens.find((candidate) => candidate.id === selectionState.penId) || doc.pens[0];
  if (!pen) return;
  selectionState.nibMode = "fixed";
  selectionState.nibWidthMM = pen.mm;
  refreshPanes();
}

function syncAlignmentButtons(align) {
  const mapping = {
    alignLeftBtn: align === "left",
    alignCenterBtn: align === "center",
    alignRightBtn: align === "right",
  };
  for (const [id, active] of Object.entries(mapping)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("active", !!active);
  }
}

function syncColorIndicators() {
  if (paperColorInputEl) {
    paperColorInputEl.value = P.paperColor;
    const chip = document.getElementById("paperColorChip");
    if (chip) chip.style.background = P.paperColor;
  }
  document.querySelectorAll("#inkSwatches [data-color]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.color || "").toLowerCase() === P.textColor.toLowerCase());
  });
}

function layerLabelForBox(box) {
  if (!box) return "Text layer";
  const match = String(box.name || "").match(/(\d+)/);
  return match ? `Text layer ${match[1]}` : box.name || "Text layer";
}

function onPointerDown(event) {
  if (appState.mode === "draw") {
    onDrawPointerDown(event);
    return;
  }
  const point = pointerToMM(event);
  if (!point || !state.currentDoc) return;
  const now = Date.now();
  const hit = hitTestBoxes(point);
  if (!hit) {
    activeBoxId = null;
    state.activeGlyphItem = null;
    hideVariantMenu(true);
    refreshSelectionMonitor();
    startPanDrag(event);
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

function onStagePointerDown(event) {
  if (event.target !== wrapEl) return;
  if (appState.mode === "draw") {
    clearDrawSelection();
  }
  activeBoxId = null;
  state.activeGlyphItem = null;
  hideVariantMenu(true);
  refreshSelectionMonitor();
  startPanDrag(event);
  requestRender();
}

function onPointerMove(event) {
  if (dragState?.kind === "pan") {
    viewport.x = dragState.origin.x + (event.clientX - dragState.startClient.x);
    viewport.y = dragState.origin.y + (event.clientY - dragState.startClient.y);
    P.fitToViewport = false;
    applyViewportTransform();
    requestRender();
    return;
  }
  if (appState.mode === "draw") {
    onDrawPointerMove(event);
    return;
  }
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
    const boxHeightMM = getBoxHeightMM(box, cachedLayouts[state.boxes.findIndex((candidate) => candidate.id === box.id)]);
    box.xMM = clamp(dragState.origin.xMM + (point.x - dragState.start.x), 0, P.canvasWMM - box.widthMM);
    box.yMM = clamp(dragState.origin.yMM + (point.y - dragState.start.y), 0, P.canvasHMM - boxHeightMM);
  } else {
    applyResize(box, dragState, point);
  }
  refreshSelectionMonitor();
  requestRender();
}

function onPointerUp(event) {
  if (appState.mode === "draw") {
    onDrawPointerUp(event);
  }
  const shouldQueueTextStream = !!dragState && dragState.kind !== "pan" && appState.mode !== "draw";
  if (dragState) {
    wrapEl.classList.remove("is-panning");
    dragState = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (wrapEl.hasPointerCapture?.(event.pointerId)) {
      wrapEl.releasePointerCapture(event.pointerId);
    }
    if (shouldQueueTextStream) queueAutoStream();
    requestRender();
  }
}

function onPointerLeave() {
  if (appState.mode === "draw") {
    onDrawPointerLeave();
  }
  hoverHandle = null;
  if (!dragState) requestRender();
}

function onHoverPointerMove(event) {
  if (appState.mode === "draw") return;
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
  if (appState.mode === "draw") return;
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
      queueAutoStream();
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
      queueAutoStream();
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

function startPanDrag(event) {
  wrapEl.classList.add("is-panning");
  dragState = {
    kind: "pan",
    startClient: { x: event.clientX, y: event.clientY },
    origin: { x: viewport.x, y: viewport.y },
  };
  wrapEl.setPointerCapture?.(event.pointerId);
}

function onStageWheel(event) {
  event.preventDefault();
  if (!event.ctrlKey) {
    viewport.x -= event.deltaX;
    viewport.y -= event.deltaY;
    P.fitToViewport = false;
    applyViewportTransform();
    requestRender();
    return;
  }
  const rect = wrapEl.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const zoomFactor = Math.exp(-event.deltaY * 0.0015);
  const nextScale = clamp(viewport.scale * zoomFactor, 0.1, 8);
  const worldX = (cursorX - viewport.x) / viewport.scale;
  const worldY = (cursorY - viewport.y) / viewport.scale;
  viewport.scale = nextScale;
  viewport.x = cursorX - worldX * nextScale;
  viewport.y = cursorY - worldY * nextScale;
  P.fitToViewport = false;
  P.previewScale = nextScale;
  applyViewportTransform();
  requestRender();
}

function hitTestBoxes(point) {
  const ordered = [...state.boxes].reverse();
  for (const box of ordered) {
    const layout = state.currentDoc
      ? cachedLayouts[state.boxes.findIndex((candidate) => candidate.id === box.id)] || layoutBox(state.currentDoc, box)
      : null;
    const boxHeightMM = getBoxHeightMM(box, layout);
    if (box.id === activeBoxId) {
      for (const handle of getBoxHandles(box, boxHeightMM)) {
        if (distance(point.x, point.y, handle.xMM, handle.yMM) <= 3.2) {
          return { part: "handle", box, handle };
        }
      }
    }
    if (
      point.x >= box.xMM &&
      point.x <= box.xMM + box.widthMM &&
      point.y >= box.yMM &&
      point.y <= box.yMM + boxHeightMM
    ) {
      return { part: "box", box };
    }
  }
  return null;
}

function getBoxHandles(box, boxHeightMM = box.heightMM) {
  const x0 = box.xMM;
  const y0 = box.yMM;
  const x1 = box.xMM + box.widthMM;
  const y1 = box.yMM + boxHeightMM;
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
  const bundledManifest = getBundledFontManifest();
  if (bundledManifest?.fonts?.length) {
    const out = {};
    for (const entry of bundledManifest.fonts || []) {
      out[entry.id] = { ...entry, resolvedPath: appAssetUrl(entry.path) };
    }
    if (Object.keys(out).length) {
      return out;
    }
  }
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

function getBundledFontManifest() {
  return window.__CALLIGRAPHY_FONT_BUNDLE__?.manifest || null;
}

function getBundledFontDoc(fontId) {
  const doc = window.__CALLIGRAPHY_FONT_BUNDLE__?.docs?.[fontId];
  return doc ? clone(doc) : null;
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

function sampleStrokeForStamps(st, spacingU) {
  const { pts, w } = flattenStroke(st, Math.max(4, spacingU * 0.5));
  if (!pts.length) return [];
  const out = [{ x: pts[0][0], y: pts[0][1], w: w[0] ?? 1 }];
  let remaining = spacingU;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) continue;
    let dist = remaining;
    while (dist <= segLen) {
      const t = clamp(dist / segLen, 0, 1);
      out.push({
        x: A[0] + dx * t,
        y: A[1] + dy * t,
        w: (w[i] ?? 1) * (1 - t) + (w[i + 1] ?? 1) * t,
      });
      dist += spacingU;
    }
    remaining = dist - segLen;
    if (!Number.isFinite(remaining) || remaining <= 1e-6) {
      remaining = spacingU;
    }
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (!prev || Math.hypot(last[0] - prev.x, last[1] - prev.y) > spacingU * 0.2) {
    out.push({ x: last[0], y: last[1], w: w[w.length - 1] ?? 1 });
  }
  return out;
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

function clearDrawLayer(layer) {
  const layerCtx = layer?.getContext?.("2d");
  if (!layerCtx || !layer) return;
  layerCtx.clearRect(0, 0, layer.width, layer.height);
}

function getDrawBrushSnapshot() {
  return {
    type: drawUI.brushType,
    roundSizeMM: Number(drawUI.roundSize),
    flatWidthMM: Number(drawUI.flatWidth),
    flatAngleDeg: Number(drawUI.flatAngle),
    streamline: Number(drawUI.streamline),
    smoothing: Number(drawUI.smoothing),
    minDistanceMM: Number(drawUI.minDistance),
    snapToGrid: !!drawUI.snapGrid,
  };
}

function getDrawBrushDisplayLabel(brush) {
  if (brush.type === "flat") {
    return `brush: flat ${fmt(brush.flatWidthMM)} mm @ ${fmt(brush.flatAngleDeg)} deg`;
  }
  return `brush: round ${fmt(brush.roundSizeMM)} mm`;
}

function isPenPointerEvent(event) {
  return event && event.pointerType === "pen";
}

function eventShowsHover(event) {
  return isPenPointerEvent(event) && (event.buttons === 0 || event.pressure === 0);
}

function updatePenMarkerFromPointer(pointMm, brush, pointerEvent = null) {
  if (!penMarkerEl || !pointMm) return;
  const pxPerMM = PaperUtils.getPxPerMM(P);
  const pointPx = {
    x: pointMm.x * pxPerMM * viewport.scale + viewport.x,
    y: pointMm.y * pxPerMM * viewport.scale + viewport.y,
  };
  const sizePx = Math.max(8, getDrawBrushSizeMM(brush) * pxPerMM * viewport.scale);
  penMarkerEl.style.width = `${sizePx}px`;
  penMarkerEl.style.height = `${Math.max(8, brush.type === "flat" ? sizePx * 0.26 : sizePx)}px`;
  penMarkerEl.style.left = `${pointPx.x}px`;
  penMarkerEl.style.top = `${pointPx.y}px`;
  penMarkerEl.classList.toggle("flat", brush.type === "flat");
  const angle = brush.type === "flat" ? brush.flatAngleDeg : 0;
  const pressure = pointerEvent && Number.isFinite(pointerEvent.pressure) ? pointerEvent.pressure : 0;
  const opacity = eventShowsHover(pointerEvent) ? 0.7 : clamp(0.45 + pressure * 0.5, 0.45, 1);
  penMarkerEl.style.opacity = `${opacity}`;
  penMarkerEl.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  penMarkerEl.classList.remove("hidden");
}

function hidePenMarker() {
  penMarkerEl?.classList.add("hidden");
  drawState.hoverPointer = null;
}

function getDrawBrushSizeMM(brush) {
  return brush.type === "flat" ? brush.flatWidthMM : brush.roundSizeMM;
}

function getDrawBrushStampRadiusMM(brush) {
  if (brush.type === "flat") return Math.max(0.12, brush.flatWidthMM * 0.16);
  return Math.max(0.12, brush.roundSizeMM * 0.5);
}

function getDrawBrushStampStepMM(brush) {
  return Math.max(0.2, getDrawBrushStampRadiusMM(brush) * 1.6);
}

function drawPointDistance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function subtractDrawPoints(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function addDrawPoints(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scaleDrawPoint(point, factor) {
  return { x: point.x * factor, y: point.y * factor };
}

function normalizeDrawPoint(point) {
  const length = Math.hypot(point.x, point.y);
  if (length <= 1e-6) return { x: 0, y: 0 };
  return { x: point.x / length, y: point.y / length };
}

function invalidateDrawStrokeCaches(stroke) {
  stroke.pathDirty = true;
  stroke.brushDirty = true;
  stroke.bezierDirty = true;
}

function rebuildDrawStrokePointsFromRaw(rawPoints, brush) {
  if (!rawPoints.length) return { points: [], filtered: null };
  let filtered = rawPoints[0];
  let point = filtered;
  if (brush.snapToGrid) {
    point = {
      x: Math.round(point.x / 5) * 5,
      y: Math.round(point.y / 5) * 5,
    };
  }
  const points = [point];
  for (let i = 1; i < rawPoints.length; i += 1) {
    filtered = lerpPoint(filtered, rawPoints[i], clamp(1 - brush.streamline * 0.45, 0.015, 1));
    point = filtered;
    if (brush.snapToGrid) {
      point = {
        x: Math.round(point.x / 5) * 5,
        y: Math.round(point.y / 5) * 5,
      };
    }
    const last = points[points.length - 1];
    if (!last || drawPointDistance(last, point) >= brush.minDistanceMM) {
      points.push(point);
    }
  }
  return { points, filtered };
}

function applyCurrentBrushToExistingDrawStrokes() {
  const nextBrush = getDrawBrushSnapshot();
  for (const stroke of drawState.strokes) {
    stroke.brush = { ...nextBrush };
    const rebuilt = rebuildDrawStrokePointsFromRaw(stroke.rawPoints, stroke.brush);
    stroke.points = rebuilt.points;
    stroke.filtered = rebuilt.filtered || stroke.filtered;
    invalidateDrawStrokeCaches(stroke);
  }
  clearDrawLayer(drawState.activeLayer);
  drawState.committedDirty = true;
  updateDrawStatus();
  requestRender();
}

function createDrawStroke(point) {
  const brush = getDrawBrushSnapshot();
  const id = globalThis.crypto?.randomUUID?.() || `draw-stroke-${drawState.nextStrokeId++}`;
  return {
    id,
    rawPoints: [point],
    points: [point],
    filtered: point,
    brush,
    pathCache: [],
    brushCache: [],
    bezierCache: null,
    pathDirty: true,
    brushDirty: true,
    bezierDirty: true,
  };
}

function smoothDrawPath(points, smoothing) {
  if (points.length < 3 || smoothing <= 0.001) return points.slice();
  const passes = Math.max(1, Math.min(5, Math.round(1 + smoothing * 2)));
  const alpha = clamp(0.08 + smoothing * 0.12, 0.08, 0.28);
  let out = points.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i += 1) {
      const prev = out[i - 1];
      const cur = out[i];
      const after = out[i + 1];
      next.push({
        x: cur.x * (1 - alpha * 2) + (prev.x + after.x) * alpha,
        y: cur.y * (1 - alpha * 2) + (prev.y + after.y) * alpha,
      });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function getDrawStrokePathPoints(stroke) {
  if (!stroke.pathDirty) return stroke.pathCache;
  stroke.pathCache = smoothDrawPath(stroke.points, stroke.brush.smoothing).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  stroke.pathDirty = false;
  return stroke.pathCache;
}

function perpendicularDrawDistance(point, a, b) {
  const length = drawPointDistance(a, b);
  if (length <= 1e-6) return drawPointDistance(point, a);
  const area = Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y));
  return area / length;
}

function simplifyDrawRadial(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (drawPointDistance(points[i], previous) >= tolerance) {
      out.push(points[i]);
      previous = points[i];
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function simplifyDrawDouglas(points, tolerance) {
  if (points.length <= 2) return points.slice();
  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const nextDistance = perpendicularDrawDistance(points[i], start, end);
    if (nextDistance > maxDistance) {
      maxDistance = nextDistance;
      splitIndex = i;
    }
  }
  if (maxDistance <= tolerance || splitIndex < 0) {
    return [start, end];
  }
  const left = simplifyDrawDouglas(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyDrawDouglas(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function cornerAwareSimplifyDraw(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const cornerCosine = Math.cos((35 * Math.PI) / 180);
  const segments = [];
  let segmentStart = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const incoming = normalizeDrawPoint(subtractDrawPoints(points[i], points[i - 1]));
    const outgoing = normalizeDrawPoint(subtractDrawPoints(points[i + 1], points[i]));
    const cosine = incoming.x * outgoing.x + incoming.y * outgoing.y;
    if (cosine > cornerCosine) continue;
    segments.push(points.slice(segmentStart, i + 1));
    segmentStart = i;
  }
  segments.push(points.slice(segmentStart));
  const out = [];
  for (const segment of segments) {
    const radial = simplifyDrawRadial(segment, tolerance * 0.5);
    const simplified = simplifyDrawDouglas(radial, tolerance);
    if (!out.length) out.push(...simplified);
    else out.push(...simplified.slice(1));
  }
  return out;
}

function catmullRomToBezierDraw(points) {
  if (!points.length) return [];
  if (points.length === 1) return [{ type: "move", point: points[0] }];
  const segments = [{ type: "move", point: points[0] }];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1 = addDrawPoints(p1, scaleDrawPoint(subtractDrawPoints(p2, p0), 1 / 6));
    const cp2 = subtractDrawPoints(p2, scaleDrawPoint(subtractDrawPoints(p3, p1), 1 / 6));
    segments.push({ type: "cubic", cp1, cp2, point: p2 });
  }
  return segments;
}

function buildDrawBezierPathCache(stroke) {
  const tolerance = clamp(Number(drawUI.exportTolerance) || 0.18, 0.03, 1);
  if (!stroke.bezierDirty && stroke.bezierCache && Math.abs(stroke.bezierCache.tolerance - tolerance) < 1e-6) {
    return stroke.bezierCache;
  }
  const path = getDrawStrokePathPoints(stroke);
  const simplified = cornerAwareSimplifyDraw(path, tolerance);
  const segments = catmullRomToBezierDraw(simplified);
  stroke.bezierCache = { tolerance, segments };
  stroke.bezierDirty = false;
  return stroke.bezierCache;
}

function bezierSegmentsToPathData(segments) {
  if (!segments?.length) return "";
  const commands = [];
  for (const segment of segments) {
    if (segment.type === "move") commands.push(`M ${fmt(segment.point.x)} ${fmt(segment.point.y)}`);
    else if (segment.type === "cubic") {
      commands.push(
        `C ${fmt(segment.cp1.x)} ${fmt(segment.cp1.y)} ${fmt(segment.cp2.x)} ${fmt(segment.cp2.y)} ${fmt(segment.point.x)} ${fmt(segment.point.y)}`,
      );
    }
  }
  return commands.join(" ");
}

function bezierSegmentsToStreamPathData(segments) {
  if (!segments?.length) return "";
  const commands = [];
  for (const segment of segments) {
    if (segment.type === "move") {
      commands.push(`M ${fmt(mmToSvgUnits(segment.point.x))} ${fmt(mmToSvgUnits(segment.point.y))}`);
    } else if (segment.type === "cubic") {
      commands.push(
        `C ${fmt(mmToSvgUnits(segment.cp1.x))} ${fmt(mmToSvgUnits(segment.cp1.y))} ${fmt(mmToSvgUnits(segment.cp2.x))} ${fmt(mmToSvgUnits(segment.cp2.y))} ${fmt(mmToSvgUnits(segment.point.x))} ${fmt(mmToSvgUnits(segment.point.y))}`,
      );
    }
  }
  return commands.join(" ");
}

function pointOnFlatDrawStamp(center, width, angleRad, xDir, yDir) {
  const halfWidth = width * 0.5;
  const thickness = Math.max(0.12, width * 0.18);
  return {
    x: center.x + xDir * Math.cos(angleRad) * halfWidth + yDir * -Math.sin(angleRad) * thickness * 0.5,
    y: center.y + xDir * Math.sin(angleRad) * halfWidth + yDir * Math.cos(angleRad) * thickness * 0.5,
  };
}

function buildFlatDrawPolygon(center, width, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return [
    pointOnFlatDrawStamp(center, width, angleRad, -1, -1),
    pointOnFlatDrawStamp(center, width, angleRad, 1, -1),
    pointOnFlatDrawStamp(center, width, angleRad, 1, 1),
    pointOnFlatDrawStamp(center, width, angleRad, -1, 1),
  ];
}

function buildFlatNibStampPolygon(center, width, angleDeg) {
  return nibPolygon(width, DRAW_FLAT_NIB_RATIO, angleDeg).map(([x, y]) => ({
    x: center.x + x,
    y: center.y + y,
  }));
}

function buildDrawBrushStampCache(stroke) {
  if (!stroke.brushDirty) return stroke.brushCache;
  const brush = stroke.brush;
  const path = getDrawStrokePathPoints(stroke);
  const step = getDrawBrushStampStepMM(brush);
  const stamps = [];
  const pushStamp = (point) => {
    if (brush.type === "flat") {
      stamps.push({ kind: "polygon", points: buildFlatNibStampPolygon(point, brush.flatWidthMM, brush.flatAngleDeg) });
      return;
    }
    stamps.push({ kind: "circle", x: point.x, y: point.y, r: getDrawBrushStampRadiusMM(brush) });
  };
  if (path.length === 1) {
    pushStamp(path[0]);
  } else if (path.length > 1) {
    pushStamp(path[0]);
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      const length = drawPointDistance(a, b);
      const steps = Math.max(1, Math.ceil(length / step));
      for (let j = 1; j <= steps; j += 1) {
        pushStamp(lerpPoint(a, b, j / steps));
      }
    }
  }
  stroke.brushCache = stamps;
  stroke.brushDirty = false;
  return stroke.brushCache;
}

function drawDrawStampGeometry(targetCtx, stamp) {
  if (stamp.kind === "circle") {
    targetCtx.beginPath();
    targetCtx.arc(stamp.x, stamp.y, stamp.r, 0, Math.PI * 2);
    targetCtx.fill();
    return;
  }
  const points = stamp.points || [];
  if (!points.length) return;
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) targetCtx.lineTo(points[i].x, points[i].y);
  targetCtx.closePath();
  targetCtx.fill();
}

function withMmScale(targetCtx, fn) {
  targetCtx.save();
  const pxPerMM = PaperUtils.getPxPerMM(P);
  targetCtx.setTransform(pxPerMM, 0, 0, pxPerMM, 0, 0);
  fn(targetCtx);
  targetCtx.restore();
}

function drawDrawStrokeToLayer(layer, stroke) {
  const layerCtx = layer?.getContext?.("2d");
  const stamps = buildDrawBrushStampCache(stroke);
  if (!layerCtx || !stamps.length) return;
  withMmScale(layerCtx, (scaledCtx) => {
    scaledCtx.fillStyle = "rgba(17, 17, 17, 0.92)";
    for (const stamp of stamps) drawDrawStampGeometry(scaledCtx, stamp);
  });
}

function drawIncrementalDrawStrokeSegment(layer, stroke, fromPoint, toPoint) {
  const layerCtx = layer?.getContext?.("2d");
  const brush = stroke.brush;
  const step = getDrawBrushStampStepMM(brush);
  if (!layerCtx) return;
  withMmScale(layerCtx, (scaledCtx) => {
    scaledCtx.fillStyle = "rgba(17, 17, 17, 0.92)";
    if (!fromPoint) {
      const firstStamp =
        brush.type === "flat"
          ? { kind: "polygon", points: buildFlatNibStampPolygon(toPoint, brush.flatWidthMM, brush.flatAngleDeg) }
          : { kind: "circle", x: toPoint.x, y: toPoint.y, r: getDrawBrushStampRadiusMM(brush) };
      drawDrawStampGeometry(scaledCtx, firstStamp);
      return;
    }
    const length = drawPointDistance(fromPoint, toPoint);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let i = 1; i <= steps; i += 1) {
      const point = lerpPoint(fromPoint, toPoint, i / steps);
      drawDrawStampGeometry(
        scaledCtx,
        brush.type === "flat"
          ? { kind: "polygon", points: buildFlatNibStampPolygon(point, brush.flatWidthMM, brush.flatAngleDeg) }
          : { kind: "circle", x: point.x, y: point.y, r: getDrawBrushStampRadiusMM(brush) },
      );
    }
  });
}

function rerenderCommittedDrawLayer() {
  clearDrawLayer(drawState.committedLayer);
  for (const stroke of drawState.strokes) drawDrawStrokeToLayer(drawState.committedLayer, stroke);
  drawState.committedDirty = false;
}

function renderDrawScene() {
  if (!drawCtx || !drawCanvas) return;
  if (drawState.committedDirty) rerenderCommittedDrawLayer();
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (drawState.committedLayer) drawCtx.drawImage(drawState.committedLayer, 0, 0);
  if (drawState.activeLayer) drawCtx.drawImage(drawState.activeLayer, 0, 0);
}

function drawPolylineMM(targetCtx, points, color, widthMM) {
  if (points.length < 2) return;
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = widthMM;
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) targetCtx.lineTo(points[i].x, points[i].y);
  targetCtx.stroke();
  targetCtx.restore();
}

function computeDrawSelectionBounds() {
  const selected = drawState.strokes.filter((stroke) => drawState.selectedStrokeIds.has(stroke.id));
  if (!selected.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of selected) {
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY, centerX: (minX + maxX) * 0.5, centerY: (minY + maxY) * 0.5 };
}

function getDrawTransformHandles(bounds) {
  return {
    tl: { x: bounds.minX, y: bounds.minY },
    tr: { x: bounds.maxX, y: bounds.minY },
    bl: { x: bounds.minX, y: bounds.maxY },
    br: { x: bounds.maxX, y: bounds.maxY },
    rotate: { x: bounds.centerX, y: bounds.minY - 10 },
  };
}

function hitTestDrawTransform(pointMm) {
  const bounds = computeDrawSelectionBounds();
  if (!bounds) return null;
  const handles = getDrawTransformHandles(bounds);
  for (const [name, handle] of Object.entries(handles)) {
    if (drawPointDistance(pointMm, handle) <= 4) {
      return { type: name === "rotate" ? "rotate" : "scale", handle: name, bounds };
    }
  }
  if (pointMm.x >= bounds.minX && pointMm.x <= bounds.maxX && pointMm.y >= bounds.minY && pointMm.y <= bounds.maxY) {
    return { type: "move", bounds };
  }
  return null;
}

function transformDrawPoint(point, centerX, centerY, moveX, moveY, scaleX, scaleY, angle) {
  let x = point.x - centerX;
  let y = point.y - centerY;
  x *= scaleX;
  y *= scaleY;
  if (angle !== 0) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }
  return {
    x: clamp(centerX + x + moveX, 0, P.canvasWMM),
    y: clamp(centerY + y + moveY, 0, P.canvasHMM),
  };
}

function applyDrawTransformFromState(pointMm) {
  if (!drawState.transformState) return;
  const { bounds, anchor, type } = drawState.transformState;
  const cx = bounds.centerX;
  const cy = bounds.centerY;
  let moveX = 0;
  let moveY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let angle = 0;
  if (type === "move") {
    moveX = pointMm.x - anchor.x;
    moveY = pointMm.y - anchor.y;
  } else if (type === "rotate") {
    const startAngle = Math.atan2(anchor.y - cy, anchor.x - cx);
    const nextAngle = Math.atan2(pointMm.y - cy, pointMm.x - cx);
    angle = nextAngle - startAngle;
  } else if (type === "scale") {
    const sx0 = anchor.x - cx;
    const sy0 = anchor.y - cy;
    const sx1 = pointMm.x - cx;
    const sy1 = pointMm.y - cy;
    scaleX = Math.abs(sx0) < 0.001 ? 1 : sx1 / sx0;
    scaleY = Math.abs(sy0) < 0.001 ? 1 : sy1 / sy0;
    scaleX = Math.sign(scaleX || 1) * Math.max(0.05, Math.abs(scaleX || 1));
    scaleY = Math.sign(scaleY || 1) * Math.max(0.05, Math.abs(scaleY || 1));
  }
  for (const stroke of drawState.strokes) {
    if (!drawState.selectedStrokeIds.has(stroke.id)) continue;
    const original = drawState.transformState.snapshot.get(stroke.id);
    stroke.rawPoints = original.rawPoints.map((point) => transformDrawPoint(point, cx, cy, moveX, moveY, scaleX, scaleY, angle));
    stroke.points = original.points.map((point) => transformDrawPoint(point, cx, cy, moveX, moveY, scaleX, scaleY, angle));
    stroke.filtered = stroke.points[stroke.points.length - 1] || stroke.filtered;
    invalidateDrawStrokeCaches(stroke);
  }
  drawState.committedDirty = true;
}

function drawDrawOverlay() {
  const bounds = computeDrawSelectionBounds();
  if (bounds) {
    for (const stroke of drawState.strokes) {
      if (drawState.selectedStrokeIds.has(stroke.id)) {
        drawPolylineMM(ctx, getDrawStrokePathPoints(stroke), "rgba(45, 139, 131, 0.9)", 0.5);
      }
    }
    ctx.save();
    ctx.setLineDash([2, 1.5]);
    ctx.strokeStyle = "#2d8b83";
    ctx.lineWidth = 0.35;
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.restore();
    const handles = getDrawTransformHandles(bounds);
    for (const [name, point] of Object.entries(handles)) {
      if (name === "rotate") {
        ctx.beginPath();
        ctx.moveTo(bounds.centerX, bounds.minY);
        ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = "#2d8b83";
        ctx.lineWidth = 0.25;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = name === "rotate" ? "#2d8b83" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#2d8b83";
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }
  }
  if (drawState.lassoPoints.length > 1) {
    ctx.save();
    ctx.setLineDash([1.8, 1.4]);
    ctx.strokeStyle = "#2d8b83";
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(drawState.lassoPoints[0].x, drawState.lassoPoints[0].y);
    for (let i = 1; i < drawState.lassoPoints.length; i += 1) {
      ctx.lineTo(drawState.lassoPoints[i].x, drawState.lassoPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function pointInDrawPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clearDrawSelection() {
  drawState.selectedStrokeIds.clear();
  drawState.transformState = null;
  drawState.lassoPoints = [];
  updateDrawStatus();
  requestRender();
}

function finishDrawLasso() {
  drawState.selectedStrokeIds.clear();
  if (drawState.lassoPoints.length >= 3) {
    for (const stroke of drawState.strokes) {
      if (stroke.points.some((point) => pointInDrawPolygon(point, drawState.lassoPoints))) {
        drawState.selectedStrokeIds.add(stroke.id);
      }
    }
  }
  drawState.lassoPoints = [];
  if (drawState.selectedStrokeIds.size > 0) {
    drawUI.tool = "transform";
    refreshPanes();
    updateDrawStatus("Selection ready");
  } else {
    updateDrawStatus("Nothing selected");
  }
  requestRender();
}

function beginDrawTransform(hit, pointMm) {
  drawState.transformState = {
    type: hit.type,
    handle: hit.handle || null,
    bounds: hit.bounds,
    anchor: pointMm,
    snapshot: new Map(
      drawState.strokes
        .filter((stroke) => drawState.selectedStrokeIds.has(stroke.id))
        .map((stroke) => [
          stroke.id,
          {
            rawPoints: stroke.rawPoints.map((point) => ({ ...point })),
            points: stroke.points.map((point) => ({ ...point })),
          },
        ]),
    ),
  };
}

function finalizeCurrentDrawStroke() {
  if (!drawState.currentStroke) return;
  invalidateDrawStrokeCaches(drawState.currentStroke);
  drawDrawStrokeToLayer(drawState.committedLayer, drawState.currentStroke);
  clearDrawLayer(drawState.activeLayer);
  drawState.currentStroke = null;
  drawState.committedDirty = false;
}

function beginDrawStroke(point) {
  drawState.currentStroke = createDrawStroke(point);
  drawState.strokes.push(drawState.currentStroke);
  clearDrawLayer(drawState.activeLayer);
  drawIncrementalDrawStrokeSegment(drawState.activeLayer, drawState.currentStroke, null, point);
  updateDrawStatus();
}

function handleDrawMove(point) {
  if (!drawState.currentStroke) return;
  drawState.currentStroke.rawPoints.push(point);
  let filtered = lerpPoint(
    drawState.currentStroke.filtered,
    point,
    clamp(1 - drawState.currentStroke.brush.streamline * 0.45, 0.015, 1),
  );
  drawState.currentStroke.filtered = filtered;
  if (drawState.currentStroke.brush.snapToGrid) {
    filtered = { x: Math.round(filtered.x / 5) * 5, y: Math.round(filtered.y / 5) * 5 };
  }
  const last = drawState.currentStroke.points[drawState.currentStroke.points.length - 1];
  if (!last || drawPointDistance(last, filtered) >= drawState.currentStroke.brush.minDistanceMM) {
    drawState.currentStroke.points.push(filtered);
    invalidateDrawStrokeCaches(drawState.currentStroke);
    drawIncrementalDrawStrokeSegment(drawState.activeLayer, drawState.currentStroke, last || null, filtered);
    requestRender();
  }
  queueDrawAutoStream();
}

function handleDrawPenPreview(event) {
  if (!isPenPointerEvent(event)) return;
  const point = pointerToMM(event);
  if (!point) return;
  drawState.hoverPointer = { pointMm: point, event };
  updatePenMarkerFromPointer(point, getDrawBrushSnapshot(), event);
}

function undoLastDrawStroke() {
  if (!drawState.strokes.length) return;
  const removed = drawState.strokes.pop();
  drawState.selectedStrokeIds.delete(removed.id);
  drawState.committedDirty = true;
  updateDrawStatus();
  requestRender();
  streamIfDrawAutoEnabled();
}

function clearAllDrawStrokes() {
  drawState.strokes.length = 0;
  drawState.selectedStrokeIds.clear();
  drawState.lassoPoints = [];
  drawState.transformState = null;
  clearDrawLayer(drawState.activeLayer);
  clearDrawLayer(drawState.committedLayer);
  drawState.committedDirty = false;
  updateDrawStatus("Cleared");
  requestRender();
  streamIfDrawAutoEnabled();
}

function onDrawPointerDown(event) {
  const point = pointerToMM(event);
  if (!point) return;
  if (isPenPointerEvent(event)) handleDrawPenPreview(event);
  if (drawUI.tool === "draw") {
    beginDrawStroke(point);
  } else if (drawUI.tool === "lasso") {
    drawState.lassoPoints = [point];
    updateDrawStatus("Tracing selection");
  } else if (drawUI.tool === "transform") {
    const hit = hitTestDrawTransform(point);
    if (hit) {
      beginDrawTransform(hit, point);
      updateDrawStatus(hit.type === "move" ? "Moving selection" : hit.type === "rotate" ? "Rotating selection" : "Scaling selection");
    } else {
      clearDrawSelection();
    }
  }
  canvas.setPointerCapture?.(event.pointerId);
  requestRender();
}

function onDrawPointerMove(event) {
  if (isPenPointerEvent(event)) handleDrawPenPreview(event);
  const sourceEvents =
    drawState.currentStroke && drawUI.tool === "draw" && typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [event];
  if (drawUI.tool === "draw" && drawState.currentStroke) {
    for (const sourceEvent of sourceEvents) {
      const point = pointerToMM(sourceEvent);
      if (!point) continue;
      handleDrawMove(point);
    }
    return;
  }
  const point = pointerToMM(event);
  if (!point) return;
  if (drawUI.tool === "lasso" && drawState.lassoPoints.length > 0) {
    const last = drawState.lassoPoints[drawState.lassoPoints.length - 1];
    if (!last || drawPointDistance(last, point) >= 1) {
      drawState.lassoPoints.push(point);
      requestRender();
    }
    return;
  }
  if (drawUI.tool === "transform" && drawState.transformState) {
    applyDrawTransformFromState(point);
    updateDrawStatus();
    requestRender();
  }
}

function onDrawPointerUp(event) {
  if (drawUI.tool === "draw") {
    finalizeCurrentDrawStroke();
    requestRender();
    streamIfDrawAutoEnabled();
  } else if (drawUI.tool === "lasso") {
    finishDrawLasso();
  } else if (drawUI.tool === "transform" && drawState.transformState) {
    drawState.transformState = null;
    requestRender();
    streamIfDrawAutoEnabled();
  }
  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function onDrawPointerLeave() {
  if (drawUI.tool === "draw" && drawState.currentStroke) {
    finalizeCurrentDrawStroke();
    requestRender();
  }
  hidePenMarker();
}

function buildDrawPathSvgDocument() {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`,
  );
  parts.push('<g fill="none" stroke="#000" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round">');
  for (const stroke of drawState.strokes) {
    const bezier = buildDrawBezierPathCache(stroke);
    const d = bezierSegmentsToPathData(bezier.segments);
    if (d) parts.push(`<path d="${d}"/>`);
  }
  parts.push("</g>");
  parts.push("</svg>");
  return parts.join("\n");
}

function polygonToDrawPath(points) {
  if (!points?.length) return "";
  const commands = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length; i += 1) commands.push(`L ${fmt(points[i].x)} ${fmt(points[i].y)}`);
  commands.push("Z");
  return commands.join(" ");
}

function buildDrawBrushSvgDocument() {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(P.canvasWMM)}mm" height="${fmt(P.canvasHMM)}mm" viewBox="0 0 ${fmt(P.canvasWMM)} ${fmt(P.canvasHMM)}">`,
  );
  parts.push('<g fill="#000" stroke="none">');
  for (const stroke of drawState.strokes) {
    const stamps = buildDrawBrushStampCache(stroke);
    for (const stamp of stamps) {
      if (stamp.kind === "circle") {
        parts.push(`<circle cx="${fmt(stamp.x)}" cy="${fmt(stamp.y)}" r="${fmt(stamp.r)}"/>`);
      } else {
        const pathData = polygonToDrawPath(stamp.points);
        if (pathData) parts.push(`<path d="${pathData}"/>`);
      }
    }
  }
  parts.push("</g>");
  parts.push("</svg>");
  return parts.join("\n");
}

function buildDrawStreamSvgDocument() {
  const svgWidth = mmToSvgUnits(P.canvasWMM);
  const svgHeight = mmToSvgUnits(P.canvasHMM);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(svgWidth)} ${fmt(svgHeight)}">`);
  parts.push('<g fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">');
  for (const stroke of drawState.strokes) {
    const bezier = buildDrawBezierPathCache(stroke);
    const d = bezierSegmentsToStreamPathData(bezier.segments);
    if (d) parts.push(`<path d="${d}"/>`);
  }
  parts.push("</g>");
  parts.push("</svg>");
  return parts.join("\n");
}

function appendDrawStreamPaths(parts) {
  parts.push('<g fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">');
  for (const stroke of drawState.strokes) {
    const bezier = buildDrawBezierPathCache(stroke);
    const d = bezierSegmentsToStreamPathData(bezier.segments);
    if (d) parts.push(`<path d="${d}"/>`);
  }
  parts.push("</g>");
}

function appendTextStreamPaths(parts) {
  if (!state.currentDoc) return;
  const doc = state.currentDoc;
  parts.push('<g fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">');
  for (let i = 0; i < state.boxes.length; i++) {
    const box = state.boxes[i];
    const layout = cachedLayouts[i] || layoutBox(doc, box);
    const totalLines = Math.max(layout.lines.length, 1);
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
      let glyphIndex = 0;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
        const transformed = transformGlyphSkeleton(item.glyph, modifier.slantShear, modifier.verticalScale);
        const tx = mmToSvgUnits(drawX);
        const ty = mmToSvgUnits(baselineY);
        const scale = (box.fontSizeMM / UPM) * SVG_UNITS_PER_MM;
        parts.push(`<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(scale)} ${fmt(-scale)})">`);
        for (const st of transformed.strokes || []) {
          const d = strokePathData(st, 3);
          if (d) parts.push(`<path d="${d}"/>`);
        }
        parts.push("</g>");
        glyphIndex += 1;
      }
    }
  }
  parts.push("</g>");
}

function resolveStreamTarget() {
  if (streamUI.target === "current") return appState.mode === "draw" ? "draw" : "text";
  return streamUI.target;
}

function buildTextStreamSvgDocument() {
  const svgWidth = mmToSvgUnits(P.canvasWMM);
  const svgHeight = mmToSvgUnits(P.canvasHMM);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(svgWidth)} ${fmt(svgHeight)}">`);
  appendTextStreamPaths(parts);
  parts.push("</svg>");
  return parts.join("\n");
}

function buildCombinedStreamSvgDocument() {
  const svgWidth = mmToSvgUnits(P.canvasWMM);
  const svgHeight = mmToSvgUnits(P.canvasHMM);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(svgWidth)} ${fmt(svgHeight)}">`);
  appendTextStreamPaths(parts);
  appendDrawStreamPaths(parts);
  parts.push("</svg>");
  return parts.join("\n");
}

function buildStreamSvgDocument() {
  const target = resolveStreamTarget();
  if (target === "draw") return buildDrawStreamSvgDocument();
  if (target === "combined") return buildCombinedStreamSvgDocument();
  return buildTextStreamSvgDocument();
}

function exportDrawPathSvg() {
  ExportUtils.downloadText(buildDrawPathSvgDocument(), "calligraphy-composer-draw-paths.svg", "image/svg+xml");
}

function exportDrawBrushSvg() {
  ExportUtils.downloadText(buildDrawBrushSvgDocument(), "calligraphy-composer-draw-brush.svg", "image/svg+xml");
}

function streamAppNow() {
  if (!streamState.socket || streamState.socket.readyState !== WebSocket.OPEN) {
    updateStreamStatus("Socket not connected");
    return;
  }
  streamState.socket.send(
    JSON.stringify({
      c: "incoming-svg",
      p: { svg: buildStreamSvgDocument() },
    }),
  );
  updateStreamStatus(`Streamed at ${new Date().toLocaleTimeString()}`);
}

function queueAutoStream() {
  if (!streamUI.autoStream || streamState.streamTimer) return;
  streamState.streamTimer = setTimeout(() => {
    streamState.streamTimer = null;
    streamAppNow();
  }, 110);
}

function streamIfAutoEnabled() {
  if (streamUI.autoStream) streamAppNow();
}

function queueDrawAutoStream() {
  queueAutoStream();
}

function streamIfDrawAutoEnabled() {
  streamIfAutoEnabled();
}

function getStreamSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = String(streamUI.streamHost || "").trim() || "127.0.0.1:9080";
  const rawPath = String(streamUI.streamPath || "").trim() || "/chat";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${protocol}://${host}${path}`;
}

function disconnectStreamSocket() {
  if (streamState.reconnectTimer) {
    window.clearTimeout(streamState.reconnectTimer);
    streamState.reconnectTimer = null;
  }
  if (streamState.socket) {
    const socket = streamState.socket;
    streamState.socket = null;
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    } catch (_error) {
      // Ignore close errors.
    }
  }
  streamState.connected = false;
  updateStreamStatus("Disconnected");
}

function reconnectStreamSocket() {
  disconnectStreamSocket();
  connectStreamSocket();
}

function connectStreamSocket() {
  const socketUrl = getStreamSocketUrl();
  try {
    streamState.socket = new WebSocket(socketUrl);
  } catch (_error) {
    updateStreamStatus("Socket unavailable");
    return;
  }
  streamState.socket.addEventListener("open", () => {
    streamState.connected = true;
    updateStreamStatus("Connected");
  });
  streamState.socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (
        msg.c === "plan-options" &&
        msg.p &&
        msg.p.paperSize &&
        Number.isFinite(msg.p.paperSize.x) &&
        Number.isFinite(msg.p.paperSize.y) &&
        Number.isFinite(msg.p.marginMm)
      ) {
        P.canvasWMM = Math.max(10, Number(msg.p.paperSize.x));
        P.canvasHMM = Math.max(10, Number(msg.p.paperSize.y));
        P.marginMM = Math.max(0, Number(msg.p.marginMm));
        PaperUtils.syncPresetFromSize(P);
        refreshPanes();
        syncCanvasSize();
      }
    } catch (_error) {
      // Ignore non-json messages.
    }
  });
  streamState.socket.addEventListener("close", () => {
    streamState.connected = false;
    updateStreamStatus("Disconnected");
    streamState.reconnectTimer = window.setTimeout(() => {
      streamState.reconnectTimer = null;
      connectStreamSocket();
    }, 1000);
  });
  streamState.socket.addEventListener("error", () => {
    streamState.connected = false;
    updateStreamStatus("Socket error");
  });
}

function exportSvg() {
  if (appState.mode === "draw") {
    exportDrawBrushSvg();
    return;
  }
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
    const totalLines = Math.max(layout.lines.length, 1);
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
      let glyphIndex = 0;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
        const pathData = polysToPathData(
          getCachedGlyphArtwork(
            item,
            pen,
            transformGlyphSkeleton(item.glyph, modifier.slantShear, modifier.verticalScale),
            modifier.slantShear,
            modifier.verticalScale,
          ).polys,
        );
        if (!pathData) continue;
        svg.push(`<g transform="translate(${ExportUtils.fmt(drawX)} ${ExportUtils.fmt(baselineY)}) scale(${ExportUtils.fmt(scale)} ${ExportUtils.fmt(-scale)})">`);
        svg.push(`<path d="${pathData}" fill="${ExportUtils.escapeXML(P.textColor)}" fill-rule="nonzero"/>`);
        svg.push(`</g>`);
        glyphIndex += 1;
      }
    }
    svg.push("</g>");
  }
  svg.push("</svg>");
  ExportUtils.downloadText(svg.join("\n"), P.svgFilename, "image/svg+xml");
}

function exportPathSvg() {
  if (appState.mode === "draw") {
    exportDrawPathSvg();
    return;
  }
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
    const totalLines = Math.max(layout.lines.length, 1);
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const baselineY = box.yMM + box.paddingMM + line.baselineMM;
      const totalItems = Math.max(line.items.filter((item) => item.glyph).length, 1);
      let glyphIndex = 0;
      for (const item of line.items) {
        if (!item.glyph) continue;
        const drawX = box.xMM + box.paddingMM + line.offsetMM + item.xMM;
        const modifier = resolveGlyphModifier(box, lineIndex, totalLines, glyphIndex, totalItems);
        const transformed = transformGlyphSkeleton(item.glyph, modifier.slantShear, modifier.verticalScale);
        svg.push(`<g transform="translate(${ExportUtils.fmt(drawX)} ${ExportUtils.fmt(baselineY)}) scale(${ExportUtils.fmt(scale)} ${ExportUtils.fmt(-scale)})">`);
        for (const st of transformed.strokes || []) {
          const d = strokePathData(st, 3);
          if (d) {
            svg.push(`<path d="${d}"/>`);
          }
        }
        svg.push(`</g>`);
        glyphIndex += 1;
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
  if (appState.mode === "draw") {
    const brush = getDrawBrushSnapshot();
    document.getElementById("stat-active-box").textContent = `${drawState.strokes.length} stroke${drawState.strokes.length === 1 ? "" : "s"}`;
    document.getElementById("stat-paper").textContent = `${P.canvasWMM} x ${P.canvasHMM} mm`;
    document.getElementById("stat-font").textContent = `${drawUI.tool} tool`;
    document.getElementById("stat-nib").textContent = getDrawBrushDisplayLabel(brush);
    return;
  }
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
