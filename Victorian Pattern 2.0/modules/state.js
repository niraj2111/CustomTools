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
  const MOTIF_PRESETS = {
    freeField: { label: "Free Field" },
    bottomBaseline: { label: "Bottom Baseline" },
    centerAxis: { label: "Center Axis" },
    twinRails: { label: "Twin Rails" },
    medallion: { label: "Medallion" },
    borderFrame: { label: "Border Frame" },
    voidContour: { label: "Void Contour" },
    placedSpawns: { label: "Placed Spawns" },
  };
  const VOID_SHAPES = {
    oval: { label: "Oval" },
    rect: { label: "Rect" },
    rectOvalIntersect: { label: "Rect ∩ Oval" },
  };
  const PRESERVED_PARAM_KEYS_ON_PRESET_CHANGE = ["mirror", "verticalSymmetry", "voidOn"];

  const DEFAULT_PARAMS = {
    largeSpines: 16,
    mediumSpines: 0,
    smallSpines: 0,
    infillCurls: 3,
    spacing: 30,
    depth: 4,
    falloff: 1.48,
    clearance: 15,
    decay: 0.65,
    turns: 1,
    leafProb: 0.12,
    leafCurvature: 0.62,
    spaceMotifProb: 0.0,
    mirror: true,
    verticalSymmetry: true,
    voidOn: true,
  };
  const MOTIF_PARAM_PRESETS = {
    freeField: {
      ...DEFAULT_PARAMS,
      voidOn: true,
    },
    bottomBaseline: {
      ...DEFAULT_PARAMS,
      voidOn: false,
    },
    centerAxis: {
      ...DEFAULT_PARAMS,
      voidOn: false,
    },
    twinRails: {
      ...DEFAULT_PARAMS,
      mirror: false,
      voidOn: false,
    },
    medallion: {
      ...DEFAULT_PARAMS,
      voidOn: false,
    },
    borderFrame: {
      ...DEFAULT_PARAMS,
      voidOn: false,
    },
    voidContour: {
      ...DEFAULT_PARAMS,
      largeSpines: 5,
      mediumSpines: 4,
      smallSpines: 4,
      infillCurls: 1,
      spacing: 46,
      depth: 2,
      falloff: 1.5,
      clearance: 16,
      decay: 0.52,
      leafProb: 0.08,
      leafCurvature: 0.6,
      voidOn: true,
    },
    placedSpawns: {
      ...DEFAULT_PARAMS,
      verticalSymmetry: true,
      voidOn: false,
    },
  };
  const GRAMMAR_PRESETS = {
    freeField: {
      heroBranchStart: 0.24,
      heroBranchEnd: 0.74,
      supportBranchStart: 0.28,
      supportBranchEnd: 0.82,
      fillerBranchStart: 0.38,
      fillerBranchEnd: 0.72,
      heroBranchRate: 0.88,
      supportBranchRate: 0.68,
      fillerBranchRate: 0.34,
      heroSpacingScale: 1.18,
      supportSpacingScale: 1,
      fillerSpacingScale: 0.86,
      heroLeafBias: 0.65,
      supportLeafBias: 1,
      fillerLeafBias: 1.28,
      quietRadiusScale: 1.2,
      contourTangentBlend: 0.3,
      contourOutwardBias: 0.3,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 1,
      symmetryJitter: 0.08,
    },
    bottomBaseline: {
      heroBranchStart: 0.3,
      heroBranchEnd: 0.72,
      supportBranchStart: 0.34,
      supportBranchEnd: 0.8,
      fillerBranchStart: 0.44,
      fillerBranchEnd: 0.74,
      heroBranchRate: 0.74,
      supportBranchRate: 0.62,
      fillerBranchRate: 0.26,
      heroSpacingScale: 1.24,
      supportSpacingScale: 1.02,
      fillerSpacingScale: 0.84,
      heroLeafBias: 0.72,
      supportLeafBias: 1,
      fillerLeafBias: 1.24,
      quietRadiusScale: 1.14,
      contourTangentBlend: 0.22,
      contourOutwardBias: 0.24,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 0.94,
      symmetryJitter: 0.06,
    },
    centerAxis: {
      heroBranchStart: 0.22,
      heroBranchEnd: 0.68,
      supportBranchStart: 0.3,
      supportBranchEnd: 0.8,
      fillerBranchStart: 0.42,
      fillerBranchEnd: 0.72,
      heroBranchRate: 0.8,
      supportBranchRate: 0.6,
      fillerBranchRate: 0.28,
      heroSpacingScale: 1.2,
      supportSpacingScale: 1,
      fillerSpacingScale: 0.82,
      heroLeafBias: 0.78,
      supportLeafBias: 1,
      fillerLeafBias: 1.2,
      quietRadiusScale: 1.16,
      contourTangentBlend: 0.24,
      contourOutwardBias: 0.24,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 0.92,
      symmetryJitter: 0.06,
    },
    twinRails: {
      heroBranchStart: 0.28,
      heroBranchEnd: 0.72,
      supportBranchStart: 0.32,
      supportBranchEnd: 0.8,
      fillerBranchStart: 0.42,
      fillerBranchEnd: 0.72,
      heroBranchRate: 0.7,
      supportBranchRate: 0.56,
      fillerBranchRate: 0.24,
      heroSpacingScale: 1.18,
      supportSpacingScale: 1,
      fillerSpacingScale: 0.82,
      heroLeafBias: 0.78,
      supportLeafBias: 1,
      fillerLeafBias: 1.16,
      quietRadiusScale: 1.18,
      contourTangentBlend: 0.22,
      contourOutwardBias: 0.24,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 0.88,
      symmetryJitter: 0.04,
    },
    medallion: {
      heroBranchStart: 0.26,
      heroBranchEnd: 0.66,
      supportBranchStart: 0.32,
      supportBranchEnd: 0.76,
      fillerBranchStart: 0.46,
      fillerBranchEnd: 0.72,
      heroBranchRate: 0.72,
      supportBranchRate: 0.56,
      fillerBranchRate: 0.22,
      heroSpacingScale: 1.22,
      supportSpacingScale: 1.02,
      fillerSpacingScale: 0.8,
      heroLeafBias: 0.8,
      supportLeafBias: 1,
      fillerLeafBias: 1.2,
      quietRadiusScale: 1.24,
      contourTangentBlend: 0.28,
      contourOutwardBias: 0.28,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 0.84,
      symmetryJitter: 0.05,
    },
    borderFrame: {
      heroBranchStart: 0.28,
      heroBranchEnd: 0.76,
      supportBranchStart: 0.34,
      supportBranchEnd: 0.82,
      fillerBranchStart: 0.44,
      fillerBranchEnd: 0.74,
      heroBranchRate: 0.76,
      supportBranchRate: 0.6,
      fillerBranchRate: 0.26,
      heroSpacingScale: 1.16,
      supportSpacingScale: 1,
      fillerSpacingScale: 0.84,
      heroLeafBias: 0.72,
      supportLeafBias: 1,
      fillerLeafBias: 1.18,
      quietRadiusScale: 1.12,
      contourTangentBlend: 0.26,
      contourOutwardBias: 0.28,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 0.96,
      symmetryJitter: 0.06,
    },
    voidContour: {
      heroBranchStart: 0.34,
      heroBranchEnd: 0.7,
      supportBranchStart: 0.38,
      supportBranchEnd: 0.78,
      fillerBranchStart: 0.48,
      fillerBranchEnd: 0.74,
      heroBranchRate: 0.62,
      supportBranchRate: 0.46,
      fillerBranchRate: 0.16,
      heroSpacingScale: 1.32,
      supportSpacingScale: 1.14,
      fillerSpacingScale: 0.9,
      heroLeafBias: 0.84,
      supportLeafBias: 1.08,
      fillerLeafBias: 1.28,
      quietRadiusScale: 1.28,
      contourTangentBlend: 0.72,
      contourOutwardBias: 0.76,
      contourScaleBoost: 1.08,
      contourBranchBias: 0.8,
      pocketFillBias: 0.72,
      symmetryJitter: 0.03,
    },
    placedSpawns: {
      heroBranchStart: 0.24,
      heroBranchEnd: 0.74,
      supportBranchStart: 0.28,
      supportBranchEnd: 0.8,
      fillerBranchStart: 0.38,
      fillerBranchEnd: 0.72,
      heroBranchRate: 0.84,
      supportBranchRate: 0.66,
      fillerBranchRate: 0.28,
      heroSpacingScale: 1.14,
      supportSpacingScale: 1,
      fillerSpacingScale: 0.84,
      heroLeafBias: 0.72,
      supportLeafBias: 1,
      fillerLeafBias: 1.2,
      quietRadiusScale: 1.16,
      contourTangentBlend: 0.24,
      contourOutwardBias: 0.22,
      contourScaleBoost: 1,
      contourBranchBias: 0.5,
      pocketFillBias: 1,
      symmetryJitter: 0,
    },
  };

  function resolveMotifPresetKey(motifPreset) {
    if (MOTIF_PARAM_PRESETS[motifPreset]) {
      return motifPreset;
    }

    const labelMatch = Object.entries(MOTIF_PRESETS).find(([, value]) => value.label === motifPreset);
    return labelMatch ? labelMatch[0] : "freeField";
  }

  function paramsForMotifPreset(motifPreset) {
    const presetKey = resolveMotifPresetKey(motifPreset);
    return {
      ...MOTIF_PARAM_PRESETS[presetKey],
    };
  }

  function applyMotifPreset(state, motifPreset, options = {}) {
    const { preserveExisting = true } = options;
    const presetKey = resolveMotifPresetKey(motifPreset);
    state.motifPreset = presetKey;
    const nextParams = paramsForMotifPreset(presetKey);
    if (state.params) {
      if (preserveExisting) {
        for (const key of PRESERVED_PARAM_KEYS_ON_PRESET_CHANGE) {
          if (Object.prototype.hasOwnProperty.call(state.params, key)) {
            nextParams[key] = state.params[key];
          }
        }
      }
      Object.assign(state.params, nextParams);
    } else {
      state.params = nextParams;
    }
    return state;
  }

  function createAppState(config) {
    const defaultPreset = "A4Portrait";
    return {
      seed: 1,
      motifPreset: "freeField",
      canvasPreset: defaultPreset,
      canvasWMM: CANVAS_PRESETS[defaultPreset].widthMM,
      canvasHMM: CANVAS_PRESETS[defaultPreset].heightMM,
      dpi: 288,
      previewScale: 0.5,
      fitToViewport: true,
      invertPreview: false,
      exportVoid: false,
      debugParts: false,
      designWidth: config.canvasWidth,
      designHeight: config.canvasHeight,
      params: paramsForMotifPreset("freeField"),
      manualSpawnPoints: [],
      voidMask: {
        shape: "oval",
        xPct: 50,
        yPct: 50,
        wPct: 25.333,
        hPct: 25.556,
        rectWPct: 25.333,
        rectHPct: 25.556,
        ovalWPct: 25.333,
        ovalHPct: 25.556,
        invertRectOval: false,
      },
    };
  }

  function resetAppState(state) {
    state.seed = 1;
    state.canvasPreset = "A4Portrait";
    state.canvasWMM = CANVAS_PRESETS[state.canvasPreset].widthMM;
    state.canvasHMM = CANVAS_PRESETS[state.canvasPreset].heightMM;
    state.dpi = 288;
    state.previewScale = 0.5;
    state.fitToViewport = true;
    state.invertPreview = false;
    state.exportVoid = false;
    state.debugParts = false;
    applyMotifPreset(state, "freeField", { preserveExisting: false });
    state.manualSpawnPoints = [];
    const defaultVoidMask = {
      shape: "oval",
      xPct: 50,
      yPct: 50,
      wPct: 25.333,
      hPct: 25.556,
      rectWPct: 25.333,
      rectHPct: 25.556,
      ovalWPct: 25.333,
      ovalHPct: 25.556,
      invertRectOval: false,
    };
    if (state.voidMask) {
      Object.assign(state.voidMask, defaultVoidMask);
    } else {
      state.voidMask = defaultVoidMask;
    }
    return state;
  }

  global.VictorianPatternState = {
    CANVAS_PRESETS,
    MOTIF_PRESETS,
    VOID_SHAPES,
    DEFAULT_PARAMS,
    MOTIF_PARAM_PRESETS,
    GRAMMAR_PRESETS,
    MM_PER_INCH,
    applyMotifPreset,
    createAppState,
    paramsForMotifPreset,
    resetAppState,
  };
})(window);
