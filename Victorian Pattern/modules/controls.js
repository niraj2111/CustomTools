(function attachVictorianPatternControls(global) {
  const { CANVAS_PRESETS, MOTIF_PRESETS, VOID_SHAPES } = global.VictorianPatternState;

  function buildPane(config) {
    const {
      state,
      container,
      onPatternChange,
      onMotifPresetChange = onPatternChange,
      onClearPlacedSpawns,
      onCanvasChange,
      onViewChange,
      onSeedChange,
      onResetZoom,
      onCanvasPresetChange,
    } = config;
    const pane = new Tweakpane.Pane({
      container,
      title: "Victorian Pattern",
    });

    const canvasFolder = pane.addFolder({ title: "Canvas" });
    canvasFolder
      .addInput(state, "canvasPreset", {
        options: Object.fromEntries(
          Object.entries(CANVAS_PRESETS).map(([key, value]) => [value.label, key])
        ),
        label: "Preset",
      })
      .on("change", onCanvasPresetChange);
    canvasFolder
      .addInput(state, "canvasWMM", { min: 50, max: 1000, step: 1, label: "W mm" })
      .on("change", onCanvasChange);
    canvasFolder
      .addInput(state, "canvasHMM", { min: 50, max: 1000, step: 1, label: "H mm" })
      .on("change", onCanvasChange);
    canvasFolder
      .addInput(state, "dpi", { min: 36, max: 600, step: 1, label: "DPI" })
      .on("change", onCanvasChange);
    canvasFolder
      .addInput(state, "previewScale", { min: 0.1, max: 8, step: 0.1, label: "Zoom" })
      .on("change", onCanvasChange);
    canvasFolder
      .addInput(state, "fitToViewport", { label: "Fit View" })
      .on("change", onCanvasChange);

    const structureFolder = pane.addFolder({ title: "Structure" });
    structureFolder
      .addInput(state, "motifPreset", {
        options: Object.fromEntries(
          Object.entries(MOTIF_PRESETS).map(([key, value]) => [value.label, key])
        ),
        label: "Motif",
      })
      .on("change", (event) => onMotifPresetChange(event.value));
    structureFolder
      .addInput(state.params, "largeSpines", { min: 1, max: 16, step: 1, label: "Large" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "mediumSpines", { min: 0, max: 28, step: 1, label: "Medium" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "smallSpines", { min: 0, max: 16, step: 1, label: "Small" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "infillCurls", { min: 0, max: 20, step: 1, label: "Infill" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "spacing", { min: 30, max: 130, step: 2, label: "Spacing" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "depth", { min: 1, max: 4, step: 1, label: "Depth" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "falloff", { min: 0.1, max: 2.99, step: 0.01, label: "Falloff" })
      .on("change", onPatternChange);
    structureFolder
      .addInput(state.params, "clearance", { min: 6, max: 26, step: 1, label: "Clearance" })
      .on("change", onPatternChange);
    if (onClearPlacedSpawns) {
      structureFolder.addButton({ title: "Clear Placed Spawns" }).on("click", onClearPlacedSpawns);
    }

    const spiralFolder = pane.addFolder({ title: "Spiral" });
    spiralFolder
      .addInput(state.params, "decay", { min: 0.15, max: 0.92, step: 0.01, label: "Decay" })
      .on("change", onPatternChange);
    spiralFolder
      .addInput(state.params, "turns", { min: 0.5, max: 4, step: 0.25, label: "Turns" })
      .on("change", onPatternChange);

    const ornamentFolder = pane.addFolder({ title: "Ornament" });
    ornamentFolder
      .addInput(state.params, "leafProb", { min: 0, max: 0.5, step: 0.02, label: "Leaf Prob" })
      .on("change", onPatternChange);
    ornamentFolder
      .addInput(state.params, "leafCurvature", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "Leaf Curve",
      })
      .on("change", onPatternChange);
    ornamentFolder
      .addInput(state.params, "spaceMotifProb", {
        min: 0,
        max: 1,
        step: 0.02,
        label: "Space Motif",
      })
      .on("change", onPatternChange);
    ornamentFolder.addInput(state.params, "mirror", { label: "Mirror" }).on("change", onPatternChange);
    ornamentFolder
      .addInput(state.params, "verticalSymmetry", { label: "Vertical" })
      .on("change", onPatternChange);
    ornamentFolder.addInput(state.params, "voidOn", { label: "Void" }).on("change", onPatternChange);

    const voidFolder = pane.addFolder({ title: "Void Mask" });
    voidFolder
      .addInput(state.voidMask, "shape", {
        options: Object.fromEntries(
          Object.entries(VOID_SHAPES).map(([key, value]) => [value.label, key])
        ),
        label: "Shape",
      })
      .on("change", onPatternChange);
    voidFolder
      .addInput(state.voidMask, "xPct", { min: 0, max: 100, step: 0.5, label: "X %" })
      .on("change", onPatternChange);
    voidFolder
      .addInput(state.voidMask, "yPct", { min: 0, max: 100, step: 0.5, label: "Y %" })
      .on("change", onPatternChange);
    voidFolder
      .addInput(state.voidMask, "wPct", { min: 2, max: 100, step: 0.5, label: "W %" })
      .on("change", onPatternChange);
    voidFolder
      .addInput(state.voidMask, "hPct", { min: 2, max: 100, step: 0.5, label: "H %" })
      .on("change", onPatternChange);

    const viewFolder = pane.addFolder({ title: "View" });
    viewFolder
      .addInput(state, "invertPreview", { label: "Invert Preview" })
      .on("change", onViewChange);
    viewFolder
      .addInput(state, "debugParts", { label: "Debug Parts" })
      .on("change", onViewChange);

    const exportFolder = pane.addFolder({ title: "Export" });
    exportFolder
      .addInput(state, "seed", { min: 1, max: 99999, step: 1, label: "Seed" })
      .on("change", onSeedChange);
    exportFolder.addInput(state, "exportVoid", { label: "Export Void" });
    exportFolder.addButton({ title: "Reset Zoom" }).on("click", onResetZoom);

    return pane;
  }

  function bindButtons(config) {
    document.getElementById("prevSeedBtn").addEventListener("click", config.onPrevSeed);
    document.getElementById("nextSeedBtn").addEventListener("click", config.onNextSeed);
    document.getElementById("randomSeedBtn").addEventListener("click", config.onRandomSeed);
    document.getElementById("renderBtn").addEventListener("click", config.onRegenerate);
    document.getElementById("resetBtn").addEventListener("click", config.onReset);
    document.getElementById("pngBtn").addEventListener("click", config.onPng);
    document.getElementById("svgBtn").addEventListener("click", config.onSvg);
  }

  function updateStats(stats) {
    document.getElementById("seedLabel").textContent = stats.seed;
    document.getElementById("stat-arcs").textContent = stats.arcs;
    document.getElementById("stat-chains").textContent = stats.chains;
    document.getElementById("stat-len").textContent = `${stats.length.toLocaleString()} px`;
    document.getElementById("stat-g1").textContent =
      stats.g1 < 1e-6 ? "yes (< 1e-6 rad)" : `warn ${stats.g1.toExponential(2)}`;
  }

  global.VictorianPatternControls = {
    bindButtons,
    buildPane,
    updateStats,
  };
})(window);
