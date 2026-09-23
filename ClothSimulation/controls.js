/* DialKit controls for the plain JavaScript cloth sketch. */

let dialKit;
let dialRoot;

const CONTROL_BINDINGS = [
  ["startHere.mode", "mode", "interaction"],
  ["clothShape.columns", "cols", "cloth"],
  ["clothShape.rows", "rows", "cloth"],
  ["clothShape.spacing", "spacing", "cloth"],
  ["clothShape.horizontalPosition", "centerX", "cloth"],
  ["clothShape.verticalPosition", "centerY", "cloth"],
  ["clothShape.topOffset", "topOffset", "cloth"],
  ["clothShape.anchoring", "anchorMode", "cloth"],
  ["clothShape.edgeSensitivity", "edgeProbeMul", "cloth"],
  ["clothShape.diagonalThreads", "addDiagonals", "cloth"],
  ["motion.gravity", "gravity", "live"],
  ["motion.damping", "damping", "live"],
  ["motion.stiffness", "stiffness", "live"],
  ["motion.solverPasses", "iterations", "live"],
  ["motion.advanced.restLength", "shrinkFactor", "live"],
  ["motion.advanced.limitStretch", "tensionEnable", "live"],
  ["motion.advanced.stretchLimit", "tensionFactor", "live"],
  ["motion.advanced.limitStrength", "tensionStrength", "live"],
  ["brushes.grabRadius", "pickRadius", "interaction"],
  ["brushes.cutRadius", "tearRadius", "interaction"],
  ["appearance.backgroundClearing", "bgAlpha", "live"],
  ["appearance.threadWidth", "lineWeight", "live"],
  ["appearance.showPoints", "showPoints", "live"],
  ["appearance.showAnchors", "showLocked", "live"],
  ["meshMask.shape", "meshMaskType", "meshMask"],
  ["meshMask.invert", "meshInvert", "cloth"],
  ["meshMask.preview", "showMeshMaskOverlay", "live"],
  ["tearMask.shape", "tearMaskType", "tearMask"],
  ["tearMask.applyOnRebuild", "applyTearOnBuild", "cloth"],
  ["tearMask.cutStyle", "tearAffects", "tearSettings"],
  ["tearMask.invert", "tearInvert", "tearSettings"],
  ["tearMask.preview", "showTearMaskOverlay", "live"],
  ["maskShapes.rectangle.x", "rectX", "rectCircle"],
  ["maskShapes.rectangle.y", "rectY", "rectCircle"],
  ["maskShapes.rectangle.width", "rectW", "rectCircle"],
  ["maskShapes.rectangle.height", "rectH", "rectCircle"],
  ["maskShapes.circle.showCircle", "rectCircleShowCircle", "rectCircle"],
  ["maskShapes.circle.x", "circX", "rectCircle"],
  ["maskShapes.circle.y", "circY", "rectCircle"],
  ["maskShapes.circle.radius", "circR", "rectCircle"],
  ["maskShapes.organic.islandCount", "vorSeeds", "voronoiBlobs"],
  ["maskShapes.organic.edgePadding", "vorPadding", "voronoiBlobs"],
  ["maskShapes.organic.minimumSpacing", "vorMinSep", "voronoiBlobs"],
  ["maskShapes.organic.relaxation", "vorRelaxIters", "voronoiBlobs"],
  ["maskShapes.organic.sizeVariation", "vorRadiusJitter", "voronoiBlobs"],
  ["maskShapes.organic.islandFill", "vorFill", "voronoiBlobs"],
  ["maskShapes.organic.edgeFrequency", "vorWobbleFreq", "voronoiBlobs"],
  ["maskShapes.organic.edgeWobble", "vorWobbleAmp", "voronoiBlobs"],
  ["randomness.seed", "seed", "seed"],
  ["randomness.startJitter", "initJitter", "cloth"],
  ["randomness.jitterScale", "jitterScale", "cloth"],
  ["randomness.maskResolution", "maskResScale", "bothMasks"],
  ["exportOptions.svgThreadWidth", "svgStrokeWidth", "export"],
  ["exportOptions.includePoints", "exportPoints", "export"],
];

function dialSelect(defaultValue, choices) {
  return {
    type: "select",
    default: defaultValue,
    options: choices.map(([value, label]) => ({ value, label })),
  };
}

function buildDialKit() {
  if (!window.DialKit) {
    setStatus("Controls unavailable", "The local DialKit script could not load.");
    return;
  }

  // Inline mode keeps the full control panel beside the canvas on desktop and
  // below it on narrow screens. Values and saved versions persist locally.
  dialRoot = DialKit.createDialRoot({
    target: document.getElementById("controls"),
    mode: "inline",
    theme: "dark",
    defaultOpen: true,
  });

  dialKit = DialKit.createDialKit("Cloth controls", {
    startHere: {
      mode: dialSelect(ui.mode, [["drag", "Pull cloth"], ["tear", "Tear cloth"]]),
      rebuildCloth: { type: "action", label: "Rebuild cloth" },
      newSeed: { type: "action", label: "New random seed" },
      restoreDefaults: { type: "action", label: "Restore defaults" },
    },
    clothShape: {
      _collapsed: true,
      columns: [ui.cols, 20, 220, 1],
      rows: [ui.rows, 20, 260, 1],
      spacing: [ui.spacing, 4, 20, 1],
      horizontalPosition: [ui.centerX, 0, 1, 0.01],
      verticalPosition: [ui.centerY, 0, 1, 0.01],
      topOffset: [ui.topOffset, 0, 200, 1],
      anchoring: dialSelect(ui.anchorMode, [["edge", "Edges"], ["none", "None"], ["all", "All points"]]),
      edgeSensitivity: [ui.edgeProbeMul, 0.5, 2.5, 0.05],
      diagonalThreads: ui.addDiagonals,
    },
    motion: {
      _collapsed: true,
      gravity: [ui.gravity, -2, 2, 0.01],
      damping: [ui.damping, 0, 0.999, 0.001],
      stiffness: [ui.stiffness, 0.01, 1, 0.01],
      solverPasses: [ui.iterations, 1, 10, 1],
      advanced: {
        _collapsed: true,
        restLength: [ui.shrinkFactor, 0.2, 1.2, 0.01],
        limitStretch: ui.tensionEnable,
        stretchLimit: [ui.tensionFactor, 1, 10, 0.05],
        limitStrength: [ui.tensionStrength, 0, 1, 0.01],
      },
    },
    brushes: {
      _collapsed: true,
      grabRadius: [ui.pickRadius, 4, 80, 1],
      cutRadius: [ui.tearRadius, 1, 30, 1],
    },
    appearance: {
      _collapsed: true,
      backgroundClearing: [ui.bgAlpha, 0, 255, 1],
      threadWidth: [ui.lineWeight, 0.5, 4, 0.5],
      showPoints: ui.showPoints,
      showAnchors: ui.showLocked,
    },
    meshMask: {
      _collapsed: true,
      shape: dialSelect(ui.meshMaskType, [["rectCircle", "Rectangle + circle"], ["voronoiBlobs", "Organic islands"]]),
      invert: ui.meshInvert,
      preview: ui.showMeshMaskOverlay,
    },
    tearMask: {
      _collapsed: true,
      shape: dialSelect(ui.tearMaskType, [["rectCircle", "Rectangle + circle"], ["voronoiBlobs", "Organic islands"]]),
      applyOnRebuild: ui.applyTearOnBuild,
      cutStyle: dialSelect(ui.tearAffects, [["constraints", "Cut threads"], ["points+constraints", "Remove points + threads"]]),
      invert: ui.tearInvert,
      preview: ui.showTearMaskOverlay,
    },
    maskShapes: {
      _collapsed: true,
      rectangle: {
        _collapsed: true,
        x: [ui.rectX, 0, 1, 0.01],
        y: [ui.rectY, 0, 1, 0.01],
        width: [ui.rectW, 0.05, 1, 0.01],
        height: [ui.rectH, 0.05, 1, 0.01],
      },
      circle: {
        _collapsed: true,
        showCircle: ui.rectCircleShowCircle,
        x: [ui.circX, 0, 1, 0.01],
        y: [ui.circY, 0, 1, 0.01],
        radius: [ui.circR, 0.02, 0.6, 0.01],
      },
      organic: {
        _collapsed: true,
        islandCount: [ui.vorSeeds, 3, 140, 1],
        edgePadding: [ui.vorPadding, 0, 200, 1],
        minimumSpacing: [ui.vorMinSep, 4, 200, 1],
        relaxation: [ui.vorRelaxIters, 0, 6, 1],
        sizeVariation: [ui.vorRadiusJitter, 0, 1, 0.01],
        islandFill: [ui.vorFill, 0.1, 1, 0.01],
        edgeFrequency: [ui.vorWobbleFreq, 0.001, 0.06, 0.001],
        edgeWobble: [ui.vorWobbleAmp, 0, 1, 0.01],
      },
    },
    randomness: {
      _collapsed: true,
      seed: [ui.seed, 1, 999999, 1],
      startJitter: [ui.initJitter, 0, 20, 0.5],
      jitterScale: [ui.jitterScale, 0.001, 0.2, 0.001],
      maskResolution: [ui.maskResScale, 0.25, 1, 0.05],
    },
    exportOptions: {
      _collapsed: true,
      svgThreadWidth: [ui.svgStrokeWidth, 0.25, 5, 0.25],
      includePoints: ui.exportPoints,
      exportPNG: { type: "action", label: "Export PNG" },
      exportSVG: { type: "action", label: "Export SVG" },
    },
  }, {
    id: "masked-cloth-controls",
    persist: true,
    onAction: handleDialAction,
  });

  dialKit.subscribe(applyDialValues);
}

function handleDialAction(path) {
  switch (path) {
    case "startHere.rebuildCloth":
      queueRebuild({ meshMask: true, tearMask: true, cloth: true }, true);
      break;
    case "startHere.newSeed":
      dialKit.setValue("randomness.seed", Math.floor(1 + Math.random() * 999999));
      break;
    case "startHere.restoreDefaults":
      dialKit.resetValues();
      queueRebuild({ meshMask: true, tearMask: true, cloth: true }, true);
      break;
    case "exportOptions.exportPNG":
      saveCanvas("masked-cloth", "png");
      break;
    case "exportOptions.exportSVG":
      exportSVG();
      break;
  }
}

function applyDialValues(values) {
  const flags = { meshMask: false, tearMask: false, cloth: false };
  let refreshCanvas = false;
  let seedChanged = false;

  for (const [path, uiKey, impact] of CONTROL_BINDINGS) {
    const value = path.split(".").reduce((part, key) => part?.[key], values);
    if (value === undefined || Object.is(ui[uiKey], value)) continue;
    ui[uiKey] = value;

    if (impact === "cloth") flags.cloth = true;
    if (impact === "meshMask") flags.meshMask = flags.cloth = true;
    if (impact === "tearMask") {
      flags.tearMask = true;
      if (ui.applyTearOnBuild) flags.cloth = true;
    }
    if (impact === "tearSettings" && ui.applyTearOnBuild) flags.cloth = true;
    if (impact === "bothMasks") flags.meshMask = flags.tearMask = flags.cloth = true;
    if (impact === "rectCircle" || impact === "voronoiBlobs") {
      if (ui.meshMaskType === impact) flags.meshMask = flags.cloth = true;
      if (ui.tearMaskType === impact) {
        flags.tearMask = true;
        if (ui.applyTearOnBuild) flags.cloth = true;
      }
    }
    if (impact === "seed") {
      seedChanged = true;
      if (ui.initJitter > 0) flags.cloth = true;
      if (ui.meshMaskType === "voronoiBlobs") flags.meshMask = flags.cloth = true;
      if (ui.tearMaskType === "voronoiBlobs") {
        flags.tearMask = true;
        if (ui.applyTearOnBuild) flags.cloth = true;
      }
    }
    if (impact === "live") refreshCanvas = true;
    if (impact === "interaction") updateCanvasCursor();
  }

  // The initial subscription supplies any saved DialKit values before the
  // first cloth is built. It needs no queued rebuild.
  if (!maskSystem) return;
  if (flags.meshMask || flags.tearMask || flags.cloth) queueRebuild(flags);
  else if (refreshCanvas) wakeSimulation();
  else if (seedChanged) {
    document.getElementById("statusDetail").textContent =
      "Seed saved. Use Organic islands or Start Jitter to see it change the cloth.";
  }
}
