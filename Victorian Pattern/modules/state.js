(function attachVictorianPatternState(global) {
  const MM_PER_INCH = 25.4;
  const CANVAS_PRESETS = {
    A5Portrait: { label: "A5 Portrait", widthMM: 148, heightMM: 210 },
    A5Landscape: { label: "A5 Landscape", widthMM: 210, heightMM: 148 },
    A4Portrait: { label: "A4 Portrait", widthMM: 210, heightMM: 297 },
    A4Landscape: { label: "A4 Landscape", widthMM: 297, heightMM: 210 },
    A3Portrait: { label: "A3 Portrait", widthMM: 297, heightMM: 420 },
    A3Landscape: { label: "A3 Landscape", widthMM: 420, heightMM: 297 },
  };

  const DEFAULT_PARAMS = {
    largeSpines: 16,
    mediumSpines: 0,
    smallSpines: 4,
    infillCurls: 3,
    spacing: 32,
    depth: 3,
    falloff: 1.48,
    clearance: 13,
    decay: 0.55,
    turns: 1,
    leafProb: 0.0,
    mirror: true,
    verticalSymmetry: false,
    voidOn: true,
  };

  function createAppState(config) {
    const defaultPreset = "A4Landscape";
    return {
      seed: 1,
      canvasPreset: defaultPreset,
      canvasWMM: CANVAS_PRESETS[defaultPreset].widthMM,
      canvasHMM: CANVAS_PRESETS[defaultPreset].heightMM,
      dpi: 144,
      previewScale: 1,
      fitToViewport: true,
      invertPreview: false,
      designWidth: config.canvasWidth,
      designHeight: config.canvasHeight,
      params: { ...DEFAULT_PARAMS },
    };
  }

  function resetAppState(state) {
    state.seed = 1;
    state.canvasPreset = "A4Landscape";
    state.canvasWMM = CANVAS_PRESETS[state.canvasPreset].widthMM;
    state.canvasHMM = CANVAS_PRESETS[state.canvasPreset].heightMM;
    state.dpi = 144;
    state.previewScale = 1;
    state.fitToViewport = true;
    state.invertPreview = false;
    state.params = { ...DEFAULT_PARAMS };
    return state;
  }

  global.VictorianPatternState = {
    CANVAS_PRESETS,
    DEFAULT_PARAMS,
    MM_PER_INCH,
    createAppState,
    resetAppState,
  };
})(window);
