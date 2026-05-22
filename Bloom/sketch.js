let pane;
let flower;
let profileEditor;
let cnv;

const state = {
  canvasW: 1000,
  canvasH: 1000,
  bg: "#000000",

  originX: 500,
  originY: 610,
  scale: 1.0,

  petalCount: 12,
  bloomStage: 0.82,
  goldenAngleDeg: 137.5,
  maxRadius: 20,
  radialPower: 0.72,

  viewTilt: 1.0,
  perspective: 0.0007,
  depthScale: 0.5,

  innerLength: 220,
  outerLength: 370,
  innerWidth: 34,
  outerWidth: 88,
  lengthOpenBoost: 0.28,

  centerHeight: 20,
  heightPower: 1.65,
  closedRadiusFactor: 0.22,
  maxTiltDeg: 78,
  innerDelay: 0.42,
  openingSpread: 0.48,

  cupClosed: 64,
  cupOpen: 36,
  sideCurl: 0,
  tipCurl: 10,
  twistAmount: 0.36,
  invertCupping: true,

  showPetalProfileEditor: true,
  profileEditorX: 70,
  profileEditorY: 400,
  profileEditorW: 220,
  profileEditorH: 170,

  petalProfile: [
    { v: 0.0, w: 0.08 },
    { v: 0.28, w: 0.75 },
    { v: 0.58, w: 1.0 },
    { v: 1.0, w: 0.05 },
  ],

  longitudinalLines: 25,
  crossLines: 0,
  lineSamples: 42,
  drawLongitudinal: true,
  drawCross: true,
  drawSpine: true,

  strokeCol: "#f7ffff",
  strokeAlpha: 0.5,
  strokeWeight: 1.05,

  chromaticGhost: false,
  ghostOffset: 1.6,
  ghostAlpha: 0.55,

  showAnchors: false,
  showPetalIndex: false,
};

function setup() {
  cnv = createCanvas(state.canvasW, state.canvasH);
  cnv.parent("wrap");

  pixelDensity(1);
  angleMode(RADIANS);

  flower = new RosetteFlower();
  profileEditor = new PetalProfileEditor();

  setupPane();
  hookUI();
}

function draw() {
  background(state.bg);

  flower.draw();
  profileEditor.draw();

  drawLabels();
}

function setupPane() {
  pane = new Tweakpane.Pane({
    container: document.getElementById("pane"),
    title: "3D Rosette Flower",
  });

  const fView = pane.addFolder({ title: "View / Export", expanded: true });
  fView.addInput(state, "bg", { label: "Background" });
  fView.addInput(state, "originX", { min: 0, max: 1000, step: 1 });
  fView.addInput(state, "originY", { min: 0, max: 1000, step: 1 });
  fView.addInput(state, "scale", { min: 0.2, max: 2.0, step: 0.01 });
  fView.addBlade({ view: "button", title: "Export PNG" }).on("click", () => {
    saveCanvas("rosette_flower", "png");
  });
  fView.addBlade({ view: "button", title: "Export SVG" }).on("click", () => {
    exportSvg();
  });

  const fRosette = pane.addFolder({ title: "Rosette architecture", expanded: true });
  fRosette.addInput(state, "petalCount", { min: 8, max: 180, step: 1 });
  fRosette.addInput(state, "bloomStage", { min: 0, max: 1, step: 0.01 });
  fRosette.addInput(state, "goldenAngleDeg", { min: 80, max: 180, step: 0.1 });
  fRosette.addInput(state, "maxRadius", { min: 20, max: 480, step: 1 });
  fRosette.addInput(state, "radialPower", { min: 0.25, max: 1.6, step: 0.01 });

  const fCamera = pane.addFolder({ title: "3D projection", expanded: true });
  fCamera.addInput(state, "viewTilt", { min: -1.0, max: 1.0, step: 0.01 });
  fCamera.addInput(state, "perspective", { min: 0, max: 0.003, step: 0.0001 });
  fCamera.addInput(state, "depthScale", { min: -1.0, max: 1.0, step: 0.01 });

  const fPetal = pane.addFolder({ title: "Petal size", expanded: true });
  fPetal.addInput(state, "innerLength", { min: 20, max: 300, step: 1 });
  fPetal.addInput(state, "outerLength", { min: 40, max: 520, step: 1 });
  fPetal.addInput(state, "innerWidth", { min: 5, max: 180, step: 1 });
  fPetal.addInput(state, "outerWidth", { min: 10, max: 220, step: 1 });
  fPetal.addInput(state, "lengthOpenBoost", { min: 0, max: 1.2, step: 0.01 });

  const fBloom = pane.addFolder({ title: "Bloom mechanics", expanded: true });
  fBloom.addInput(state, "centerHeight", { min: 0, max: 600, step: 1 });
  fBloom.addInput(state, "heightPower", { min: 0.4, max: 3.2, step: 0.01 });
  fBloom.addInput(state, "closedRadiusFactor", { min: 0, max: 1, step: 0.01 });
  fBloom.addInput(state, "maxTiltDeg", { min: 0, max: 110, step: 1 });
  fBloom.addInput(state, "innerDelay", { min: 0, max: 1, step: 0.01 });
  fBloom.addInput(state, "openingSpread", { min: 0.05, max: 1.0, step: 0.01 });

  const fSurface = pane.addFolder({ title: "Petal surface", expanded: true });
  fSurface.addInput(state, "cupClosed", { min: 0, max: 220, step: 1 });
  fSurface.addInput(state, "cupOpen", { min: 0, max: 160, step: 1 });
  fSurface.addInput(state, "invertCupping", { label: "Invert cupping" });
  fSurface.addInput(state, "sideCurl", { min: -120, max: 120, step: 1 });
  fSurface.addInput(state, "tipCurl", { min: -180, max: 180, step: 1 });
  fSurface.addInput(state, "twistAmount", { min: -2.0, max: 2.0, step: 0.01 });

  const fProfile = pane.addFolder({ title: "Editable petal profile", expanded: true });
  fProfile.addInput(state, "showPetalProfileEditor", { label: "Show editor" });
  fProfile.addInput(state, "profileEditorX", { min: 0, max: 700, step: 1 });
  fProfile.addInput(state, "profileEditorY", { min: 200, max: 990, step: 1 });
  fProfile.addInput(state, "profileEditorW", { min: 120, max: 420, step: 1 });
  fProfile.addInput(state, "profileEditorH", { min: 100, max: 320, step: 1 });

  fProfile.addBlade({ view: "button", title: "Lotus / pointed" }).on("click", () => {
    setPetalProfile([
      { v: 0.0, w: 0.06 },
      { v: 0.25, w: 0.55 },
      { v: 0.58, w: 1.0 },
      { v: 1.0, w: 0.03 },
    ]);
  });
  fProfile.addBlade({ view: "button", title: "Daisy / narrow" }).on("click", () => {
    setPetalProfile([
      { v: 0.0, w: 0.04 },
      { v: 0.22, w: 0.32 },
      { v: 0.66, w: 0.42 },
      { v: 1.0, w: 0.1 },
    ]);
  });
  fProfile.addBlade({ view: "button", title: "Tulip / rounded" }).on("click", () => {
    setPetalProfile([
      { v: 0.0, w: 0.1 },
      { v: 0.28, w: 0.72 },
      { v: 0.78, w: 0.9 },
      { v: 1.0, w: 0.45 },
    ]);
  });
  fProfile.addBlade({ view: "button", title: "Succulent / spear" }).on("click", () => {
    setPetalProfile([
      { v: 0.0, w: 0.22 },
      { v: 0.3, w: 0.85 },
      { v: 0.62, w: 0.62 },
      { v: 1.0, w: 0.02 },
    ]);
  });
  fProfile.addBlade({ view: "button", title: "Wide water lily" }).on("click", () => {
    setPetalProfile([
      { v: 0.0, w: 0.05 },
      { v: 0.2, w: 0.72 },
      { v: 0.5, w: 1.15 },
      { v: 1.0, w: 0.18 },
    ]);
  });

  const fLines = pane.addFolder({ title: "Surface linework", expanded: true });
  fLines.addInput(state, "longitudinalLines", { min: 1, max: 25, step: 1 });
  fLines.addInput(state, "crossLines", { min: 0, max: 30, step: 1 });
  fLines.addInput(state, "lineSamples", { min: 8, max: 100, step: 1 });
  fLines.addInput(state, "drawLongitudinal");
  fLines.addInput(state, "drawCross");
  fLines.addInput(state, "drawSpine");

  const fStyle = pane.addFolder({ title: "Style", expanded: true });
  fStyle.addInput(state, "strokeCol", { label: "Stroke" });
  fStyle.addInput(state, "strokeAlpha", { min: 0.05, max: 1, step: 0.01 });
  fStyle.addInput(state, "strokeWeight", { min: 0.1, max: 4, step: 0.05 });
  fStyle.addInput(state, "chromaticGhost");
  fStyle.addInput(state, "ghostOffset", { min: 0, max: 8, step: 0.1 });
  fStyle.addInput(state, "ghostAlpha", { min: 0, max: 1, step: 0.01 });

  const fDebug = pane.addFolder({ title: "Debug", expanded: false });
  fDebug.addInput(state, "showAnchors");
  fDebug.addInput(state, "showPetalIndex");
}

function hookUI() {
  const resetBtn = document.getElementById("resetPetalBtn");
  if (resetBtn) {
    resetBtn.textContent = "Reset Profile";
    resetBtn.addEventListener("click", () => {
      setPetalProfile([
        { v: 0.0, w: 0.08 },
        { v: 0.28, w: 0.75 },
        { v: 0.58, w: 1.0 },
        { v: 1.0, w: 0.05 },
      ]);
    });
  }

  const svgBtn = document.getElementById("svgBtn");
  if (svgBtn) {
    svgBtn.addEventListener("click", exportSvg);
  }

  const pngBtn = document.getElementById("pngBtn");
  if (pngBtn) {
    pngBtn.addEventListener("click", () => {
      saveCanvas("rosette_flower", "png");
    });
  }
}

function setPetalProfile(profile) {
  state.petalProfile = profile.map((p) => ({
    v: constrain(p.v, 0, 1),
    w: constrain(p.w, 0.01, 1.5),
  }));
  sortPetalProfile();
}

class PetalProfileEditor {
  constructor() {
    this.dragIndex = -1;
    this.r = 7;
  }

  draw() {
    if (!state.showPetalProfileEditor) {
      return;
    }

    const x = state.profileEditorX;
    const y = state.profileEditorY;
    const w = state.profileEditorW;
    const h = state.profileEditorH;

    push();

    noStroke();
    fill(18, 230);
    rect(x - 12, y - h - 30, w + 24, h + 54, 8);

    fill(255, 220);
    textSize(12);
    text("Editable petal width profile", x, y - h - 13);

    stroke(255, 55);
    strokeWeight(1);
    noFill();
    rect(x, y - h, w, h);

    stroke(255, 35);
    line(x + w / 2, y - h, x + w / 2, y);

    const ptsL = [];
    const ptsR = [];
    const samples = 90;

    for (let i = 0; i <= samples; i += 1) {
      const v = i / samples;
      const ww = getProfileWidth(v);
      const pxL = x + w / 2 - ww * w * 0.45;
      const pxR = x + w / 2 + ww * w * 0.45;
      const py = y - v * h;

      ptsL.push({ x: pxL, y: py });
      ptsR.push({ x: pxR, y: py });
    }

    stroke(120, 190, 255, 230);
    strokeWeight(1.5);
    noFill();
    beginShape();
    for (const p of ptsL) {
      vertex(p.x, p.y);
    }
    for (let i = ptsR.length - 1; i >= 0; i -= 1) {
      vertex(ptsR[i].x, ptsR[i].y);
    }
    endShape(CLOSE);

    stroke(120, 190, 255, 80);
    for (let i = 0; i < state.petalProfile.length - 1; i += 1) {
      const a = this.handlePos(i);
      const b = this.handlePos(i + 1);
      line(a.x, a.y, b.x, b.y);
    }

    for (let i = 0; i < state.petalProfile.length; i += 1) {
      const hp = this.handlePos(i);
      stroke(255);
      strokeWeight(1);
      fill(i === this.dragIndex ? "#ffcc66" : "#ffffff");
      circle(hp.x, hp.y, this.r * 2);

      fill(255, 160);
      noStroke();
      textSize(10);
      text(i, hp.x + 9, hp.y + 3);
    }

    fill(255, 130);
    noStroke();
    textSize(10);
    text("Drag right-side handles. Vertical = length position, horizontal = width.", x, y + 16);

    pop();
  }

  handlePos(i) {
    const x = state.profileEditorX;
    const y = state.profileEditorY;
    const w = state.profileEditorW;
    const h = state.profileEditorH;
    const p = state.petalProfile[i];

    return {
      x: x + w / 2 + p.w * w * 0.45,
      y: y - p.v * h,
    };
  }

  mousePressed(mx, my) {
    if (!state.showPetalProfileEditor) {
      return false;
    }

    for (let i = 0; i < state.petalProfile.length; i += 1) {
      const hp = this.handlePos(i);
      if (dist(mx, my, hp.x, hp.y) < this.r + 6) {
        this.dragIndex = i;
        return true;
      }
    }

    return false;
  }

  mouseDragged(mx, my) {
    if (this.dragIndex < 0) {
      return false;
    }

    const x = state.profileEditorX;
    const y = state.profileEditorY;
    const w = state.profileEditorW;
    const h = state.profileEditorH;
    const p = state.petalProfile[this.dragIndex];

    let newV = constrain((y - my) / h, 0, 1);
    const newW = constrain((mx - (x + w / 2)) / (w * 0.45), 0.01, 1.5);

    if (this.dragIndex === 0) {
      newV = 0;
    }
    if (this.dragIndex === state.petalProfile.length - 1) {
      newV = 1;
    }

    p.v = newV;
    p.w = newW;

    sortPetalProfile();

    let closest = 0;
    let best = Infinity;

    for (let i = 0; i < state.petalProfile.length; i += 1) {
      const hp = this.handlePos(i);
      const d = dist(mx, my, hp.x, hp.y);
      if (d < best) {
        best = d;
        closest = i;
      }
    }

    this.dragIndex = closest;
    return true;
  }

  mouseReleased() {
    this.dragIndex = -1;
  }
}

function sortPetalProfile() {
  state.petalProfile.sort((a, b) => a.v - b.v);
  if (state.petalProfile.length > 0) {
    state.petalProfile[0].v = 0;
    state.petalProfile[state.petalProfile.length - 1].v = 1;
  }
}

function getProfileWidth(v) {
  const pts = state.petalProfile;

  if (!pts || pts.length === 0) {
    return Math.pow(Math.sin(Math.PI * v), 0.78);
  }

  if (v <= pts[0].v) {
    return pts[0].w;
  }
  if (v >= pts[pts.length - 1].v) {
    return pts[pts.length - 1].w;
  }

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];

    if (v >= a.v && v <= b.v) {
      const t = smoothstep(a.v, b.v, v);
      return lerp(a.w, b.w, t);
    }
  }

  return Math.pow(Math.sin(Math.PI * v), 0.78);
}

function mousePressed() {
  profileEditor.mousePressed(mouseX, mouseY);
}

function mouseDragged() {
  profileEditor.mouseDragged(mouseX, mouseY);
}

function mouseReleased() {
  profileEditor.mouseReleased();
}

class RosetteFlower {
  draw() {
    const petals = this.buildPetals();
    petals.sort((a, b) => a.depth - b.depth);

    push();
    strokeCap(ROUND);
    strokeJoin(ROUND);
    noFill();

    for (const petal of petals) {
      this.drawPetal(petal);
    }

    if (state.showAnchors || state.showPetalIndex) {
      this.drawDebug(petals);
    }

    pop();
  }

  buildPetals() {
    const petals = [];
    const n = Math.max(1, state.petalCount);
    const golden = radians(state.goldenAngleDeg);

    for (let i = 0; i < n; i += 1) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const angle = i * golden;
      const outerness = t;
      const innerness = 1 - t;
      const openStart = state.innerDelay * innerness;
      const localOpen = smoothstep(openStart, openStart + state.openingSpread, state.bloomStage);

      const baseR =
        Math.pow(t, state.radialPower) *
        state.maxRadius *
        lerp(state.closedRadiusFactor, 1.0, localOpen);

      const height =
        state.centerHeight *
        Math.pow(innerness, state.heightPower) *
        lerp(1.0, 0.28, localOpen);

      const len =
        lerp(state.innerLength, state.outerLength, outerness) *
        lerp(0.72, 1.0 + state.lengthOpenBoost, localOpen);

      const wid =
        lerp(state.innerWidth, state.outerWidth, outerness) *
        lerp(0.6, 1.0, localOpen);

      const tilt = lerp(radians(5), radians(state.maxTiltDeg), localOpen);
      const cup = lerp(state.cupClosed, state.cupOpen, localOpen);
      const twist = state.twistAmount * lerp(1.0, 0.25, localOpen);

      const base = {
        x: Math.cos(angle) * baseR,
        y: height,
        z: Math.sin(angle) * baseR,
      };

      const tip = this.surfacePoint3D({
        base,
        angle,
        tilt,
        length: len,
        width: wid,
        cup,
        twist,
        u: 0,
        v: 1,
      });

      const depth = base.z * 0.65 + tip.z * 0.35;

      petals.push({
        index: i,
        t,
        angle,
        base,
        radius: baseR,
        height,
        localOpen,
        tilt,
        length: len,
        width: wid,
        cup,
        twist,
        depth,
      });
    }

    return petals;
  }

  drawPetal(petal) {
    const lines = this.getPetalSurfaceLines(petal);
    const col = color(state.strokeCol);
    const a = state.strokeAlpha * 255;

    if (state.chromaticGhost && state.ghostOffset > 0) {
      strokeWeight(state.strokeWeight);

      stroke(0, 120, 255, a * state.ghostAlpha);
      for (const line of lines) {
        drawProjectedPolyline(line, -state.ghostOffset, 0);
      }

      stroke(255, 120, 0, a * state.ghostAlpha);
      for (const line of lines) {
        drawProjectedPolyline(line, state.ghostOffset, 0);
      }
    }

    stroke(red(col), green(col), blue(col), a);
    strokeWeight(state.strokeWeight);

    for (const line of lines) {
      drawProjectedPolyline(line, 0, 0);
    }
  }

  getPetalSurfaceLines(petal) {
    const lines = [];

    if (state.drawLongitudinal) {
      const count = Math.max(1, state.longitudinalLines);
      for (let i = 0; i < count; i += 1) {
        const u = count === 1 ? 0 : map(i, 0, count - 1, -0.95, 0.95);
        lines.push(this.buildVLine(petal, u));
      }
    }

    if (state.drawCross && state.crossLines > 0) {
      for (let i = 1; i <= state.crossLines; i += 1) {
        const v = i / (state.crossLines + 1);
        lines.push(this.buildULine(petal, v));
      }
    }

    if (state.drawSpine) {
      lines.push(this.buildVLine(petal, 0));
    }

    return lines;
  }

  buildVLine(petal, u) {
    const pts = [];

    for (let i = 0; i <= state.lineSamples; i += 1) {
      const v = i / state.lineSamples;
      const p3 = this.surfacePoint3D({
        base: petal.base,
        angle: petal.angle,
        tilt: petal.tilt,
        length: petal.length,
        width: petal.width,
        cup: petal.cup,
        twist: petal.twist,
        u,
        v,
      });

      pts.push(project3D(p3));
    }

    return pts;
  }

  buildULine(petal, v) {
    const pts = [];
    const samples = state.lineSamples;

    for (let i = 0; i <= samples; i += 1) {
      const u = map(i, 0, samples, -0.95, 0.95);
      const p3 = this.surfacePoint3D({
        base: petal.base,
        angle: petal.angle,
        tilt: petal.tilt,
        length: petal.length,
        width: petal.width,
        cup: petal.cup,
        twist: petal.twist,
        u,
        v,
      });

      pts.push(project3D(p3));
    }

    return pts;
  }

  surfacePoint3D(o) {
    const radial = {
      x: Math.cos(o.angle),
      y: 0,
      z: Math.sin(o.angle),
    };

    const tangent = {
      x: -Math.sin(o.angle),
      y: 0,
      z: Math.cos(o.angle),
    };

    const vertical = { x: 0, y: 1, z: 0 };
    const axis = normalize3({
      x: radial.x * Math.sin(o.tilt) + vertical.x * Math.cos(o.tilt),
      y: radial.y * Math.sin(o.tilt) + vertical.y * Math.cos(o.tilt),
      z: radial.z * Math.sin(o.tilt) + vertical.z * Math.cos(o.tilt),
    });

    let normal = normalize3(cross3(tangent, axis));
    if (normal.y < 0) {
      normal = scale3(normal, -1);
    }

    const v = constrain(o.v, 0, 1);
    const u = constrain(o.u, -1, 1);
    const widthProfile = getProfileWidth(v);
    const localAcross = u * o.width * widthProfile;
    const localAlong = v * o.length;

    const cupShape =
      o.cup *
      (1 - u * u) *
      Math.sin(Math.PI * v);

    const edgeCurl =
      state.sideCurl *
      u *
      u *
      signNonZero(u) *
      Math.pow(v, 1.65) *
      Math.sin(Math.PI * v * 0.75);

    const tipCurl =
      state.tipCurl *
      smoothstep(0.58, 1.0, v) *
      Math.pow(v, 1.2);

    const twistOffset =
      o.twist *
      u *
      o.width *
      widthProfile *
      Math.sin(Math.PI * v);

    const cupDirection = state.invertCupping ? -1 : 1;

    return add3(
      o.base,
      add3(
        add3(
          scale3(axis, localAlong),
          scale3(tangent, localAcross + twistOffset)
        ),
        add3(
          scale3(normal, cupDirection * (cupShape + edgeCurl)),
          scale3(axis, -tipCurl)
        )
      )
    );
  }

  drawDebug(petals) {
    noStroke();
    fill(255, 0, 0, 180);
    textSize(10);

    for (const petal of petals) {
      const p = project3D(petal.base);
      circle(p.x, p.y, 4);
      if (state.showPetalIndex) {
        text(petal.index, p.x + 4, p.y - 4);
      }
    }
  }

  getSvgPaths() {
    const petals = this.buildPetals();
    petals.sort((a, b) => a.depth - b.depth);

    const paths = [];
    for (const petal of petals) {
      const lines = this.getPetalSurfaceLines(petal);
      for (const line of lines) {
        paths.push(polylineToPath(line));
      }
    }

    return paths;
  }
}

function project3D(p) {
  const persp = 1 / (1 + p.z * state.perspective);

  return {
    x: state.originX + p.x * state.scale * persp,
    y:
      state.originY -
      p.y * state.scale * persp +
      p.z * state.depthScale * state.viewTilt * state.scale,
  };
}

function drawProjectedPolyline(line, ox, oy) {
  if (!line || line.length < 2) {
    return;
  }

  beginShape();
  for (const p of line) {
    vertex(p.x + ox, p.y + oy);
  }
  endShape();
}

function exportSvg() {
  const paths = flower.getSvgPaths();
  const col = hexToRgb(state.strokeCol);
  const strokeHex = rgbToHex(col);
  const svg = [];

  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${state.canvasW}" height="${state.canvasH}" viewBox="0 0 ${state.canvasW} ${state.canvasH}">`
  );
  svg.push(`<rect width="100%" height="100%" fill="${escapeSvg(state.bg)}"/>`);
  svg.push('<g id="rosette-flower" fill="none" stroke-linecap="round" stroke-linejoin="round">');

  if (state.chromaticGhost && state.ghostOffset > 0) {
    svg.push(
      `<g id="blue-ghost" stroke="#0078ff" stroke-opacity="${fmt(state.strokeAlpha * state.ghostAlpha)}" stroke-width="${fmt(state.strokeWeight)}" transform="translate(${fmt(-state.ghostOffset)},0)">`
    );
    for (const d of paths) {
      svg.push(`<path d="${d}"/>`);
    }
    svg.push("</g>");

    svg.push(
      `<g id="orange-ghost" stroke="#ff7800" stroke-opacity="${fmt(state.strokeAlpha * state.ghostAlpha)}" stroke-width="${fmt(state.strokeWeight)}" transform="translate(${fmt(state.ghostOffset)},0)">`
    );
    for (const d of paths) {
      svg.push(`<path d="${d}"/>`);
    }
    svg.push("</g>");
  }

  svg.push(
    `<g id="main-lines" stroke="${strokeHex}" stroke-opacity="${fmt(state.strokeAlpha)}" stroke-width="${fmt(state.strokeWeight)}">`
  );
  for (const d of paths) {
    svg.push(`<path d="${d}"/>`);
  }
  svg.push("</g>");
  svg.push("</g>");
  svg.push("</svg>");

  downloadText(
    svg.join("\n"),
    `rosette_flower_${Date.now()}.svg`,
    "image/svg+xml;charset=utf-8"
  );
}

function drawLabels() {
  noStroke();
  fill(255, 180);
  textSize(12);
  text("3D phyllotactic rosette bloom model", 24, 28);
  text("Drag profile handles to change petal geometry", 24, 46);
  text("Export SVG creates vanilla SVG paths, no p5.svg", 24, 64);
}

function add3(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale3(a, s) {
  return {
    x: a.x * s,
    y: a.y * s,
    z: a.z * s,
  };
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize3(a) {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  if (len < 0.000001) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: a.x / len,
    y: a.y / len,
    z: a.z / len,
  };
}

function signNonZero(v) {
  return v < 0 ? -1 : 1;
}

function smoothstep(edge0, edge1, x) {
  const denom = edge1 - edge0;
  if (Math.abs(denom) < 0.000001) {
    return x < edge0 ? 0 : 1;
  }

  const t = constrain((x - edge0) / denom, 0, 1);
  return t * t * (3 - 2 * t);
}

function polylineToPath(pts) {
  if (!pts || pts.length < 2) {
    return "";
  }

  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  }
  return d;
}

function fmt(v) {
  return (Math.round(Number(v) * 100) / 100).toString();
}

function escapeSvg(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function hexToRgb(hex) {
  const s = String(hex).replace("#", "");
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }

  const bigint = parseInt(s, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToHex(rgb) {
  return `#${componentToHex(rgb.r)}${componentToHex(rgb.g)}${componentToHex(rgb.b)}`;
}

function componentToHex(c) {
  const h = constrain(Math.round(c), 0, 255).toString(16);
  return h.length === 1 ? `0${h}` : h;
}
