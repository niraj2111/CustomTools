(function attachVictorianPatternCanvas(global) {
  const { MM_PER_INCH } = global.VictorianPatternState;

  function getPxPerMM(state) {
    return state.dpi / MM_PER_INCH;
  }

  function mmToPx(state, mm) {
    return Math.max(1, Math.round(mm * getPxPerMM(state)));
  }

  function getCanvasPixelSize(state) {
    return {
      width: mmToPx(state, state.canvasWMM),
      height: mmToPx(state, state.canvasHMM),
    };
  }

  function updateCanvasDisplaySize(state, canvasInstance, wrapId) {
    if (!canvasInstance) {
      return;
    }

    const wrap = document.getElementById(wrapId);
    if (!wrap) {
      return;
    }

    const rect = wrap.getBoundingClientRect();
    const size = getCanvasPixelSize(state);
    const padding = 24;
    const availableW = Math.max(1, rect.width - padding);
    const availableH = Math.max(1, rect.height - padding);
    const fitScale = Math.min(availableW / size.width, availableH / size.height, 1);
    const scale = state.fitToViewport ? fitScale * state.previewScale : state.previewScale;

    canvasInstance.style("width", `${Math.max(1, Math.round(size.width * scale))}px`);
    canvasInstance.style("height", `${Math.max(1, Math.round(size.height * scale))}px`);
  }

  function syncCanvasSize(state, canvasInstance, resizeCanvasFn, wrapId) {
    const size = getCanvasPixelSize(state);
    resizeCanvasFn(size.width, size.height, true);
    updateCanvasDisplaySize(state, canvasInstance, wrapId);
  }

  function getRenderTransform(state) {
    const canvasSize = getCanvasPixelSize(state);
    const scale = Math.min(
      canvasSize.width / Math.max(1, state.designWidth),
      canvasSize.height / Math.max(1, state.designHeight)
    );
    const offsetX = (canvasSize.width - state.designWidth * scale) * 0.5;
    const offsetY = (canvasSize.height - state.designHeight * scale) * 0.5;
    return { scale, offsetX, offsetY, canvasSize };
  }

  function resetCanvasView(state) {
    state.previewScale = 1;
    state.fitToViewport = true;
  }

  global.VictorianPatternCanvas = {
    getCanvasPixelSize,
    getPxPerMM,
    getRenderTransform,
    mmToPx,
    updateCanvasDisplaySize,
    syncCanvasSize,
    resetCanvasView,
  };
})(window);
