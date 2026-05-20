const PaperUtils = (() => {
  const MM_PER_INCH = 25.4;
  const PAPER_PRESETS_MM = {
    Custom: null,
    "A3 Portrait": { w: 297, h: 420 },
    "A3 Landscape": { w: 420, h: 297 },
    "A4 Portrait": { w: 210, h: 297 },
    "A4 Landscape": { w: 297, h: 210 },
    "A5 Portrait": { w: 148, h: 210 },
    "A5 Landscape": { w: 210, h: 148 },
  };

  function getPxPerMM(params) {
    return params.dpi / MM_PER_INCH;
  }

  function mmToPx(mm, params) {
    return Math.max(1, Math.round(mm * getPxPerMM(params)));
  }

  function getCanvasPixelSize(params) {
    return {
      width: mmToPx(params.canvasWMM, params),
      height: mmToPx(params.canvasHMM, params),
    };
  }

  function getPaperSizeMM(params) {
    return {
      width: params.canvasWMM,
      height: params.canvasHMM,
    };
  }

  function applyPaperPreset(params, presetName) {
    const preset = PAPER_PRESETS_MM[presetName];
    params.paperPreset = preset ? presetName : "Custom";
    if (!preset) {
      return;
    }

    params.canvasWMM = preset.w;
    params.canvasHMM = preset.h;
  }

  function syncPresetFromSize(params) {
    for (const [name, preset] of Object.entries(PAPER_PRESETS_MM)) {
      if (!preset) {
        continue;
      }
      if (preset.w === params.canvasWMM && preset.h === params.canvasHMM) {
        params.paperPreset = name;
        return;
      }
    }

    params.paperPreset = "Custom";
  }

  function updateCanvasDisplaySize(cnv, params, wrapId = "wrap", padding = 24) {
    if (!cnv) {
      return;
    }

    const wrap = document.getElementById(wrapId);
    if (!wrap) {
      return;
    }

    const rect = wrap.getBoundingClientRect();
    const pxSize = getCanvasPixelSize(params);
    const availableW = Math.max(1, rect.width - padding);
    const availableH = Math.max(1, rect.height - padding);
    const fitScale = Math.min(availableW / pxSize.width, availableH / pxSize.height, 1);
    const scale = params.fitToViewport ? fitScale * params.previewScale : params.previewScale;
    const displayW = Math.max(1, Math.round(pxSize.width * scale));
    const displayH = Math.max(1, Math.round(pxSize.height * scale));

    cnv.style("width", `${displayW}px`);
    cnv.style("height", `${displayH}px`);
  }

  function syncCanvasSize(cnv, params, resizeCanvasFn, wrapId = "wrap", padding = 24) {
    const size = getCanvasPixelSize(params);
    resizeCanvasFn(size.width, size.height, true);
    updateCanvasDisplaySize(cnv, params, wrapId, padding);
  }

  return {
    MM_PER_INCH,
    PAPER_PRESETS_MM,
    getPxPerMM,
    mmToPx,
    getCanvasPixelSize,
    getPaperSizeMM,
    applyPaperPreset,
    syncPresetFromSize,
    updateCanvasDisplaySize,
    syncCanvasSize,
  };
})();
