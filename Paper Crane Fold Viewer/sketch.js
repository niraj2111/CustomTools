let currentStep = 0;
let showWings = true;
const totalSteps = 6;

let drawingLayer;
let brushColor;
let brushSize = 10;
let isErasing = false;

let craneCanvas;
const CW = 210;
const CH = 210;
let craneRotX = -0.3;
let craneRotY = 0.4;
let craneDragStart = null;

let CX;
let CY;
let R;
const SQ = {};
let sqPixelL;
let sqPixelT;
let sqPixelW;
let sqPixelH;

const PAPER_COL = [244, 240, 228];
const VALLEY_COL = [92, 107, 192];
const MOUNTAIN_COL = [224, 82, 82];
const CREASE_COL = [176, 168, 138];
const WING_FILL = [139, 195, 74, 50];
const WING_STROKE = [85, 139, 47];
const LABEL_COL = [90, 86, 76];

const stepLabels = ['1  flat square', '2  book folds (valley)', '3  diagonal folds (mountain)', '4  preliminary base', '5  kite folds', '6  full fold map'];
const stepDescs = [
  'Draw on the square — appears as texture on the 3D crane →',
  'Valley fold top→bottom then left→right. Creates cross creases.',
  'Mountain fold corner to corner both ways. Creates X creases.',
  'All creases collapse → preliminary base (diamond, half size).',
  'Side edges fold to center crease on both halves.',
  'Every fold line on the flat square. Blue = valley, red = mountain.'
];

let btnPrev, btnNext, btnWings, btnClear, brushSizeSlider, colorPicker, btnErase;

function setup() {
  const canvas = createCanvas(780, 580);
  canvas.parent('sketch-root');
  textFont('monospace');
  pixelDensity(1);

  CX = 310;
  CY = height / 2 + 24;
  R = 200;

  SQ.tl = createVector(CX - R, CY - R);
  SQ.tr = createVector(CX + R, CY - R);
  SQ.br = createVector(CX + R, CY + R);
  SQ.bl = createVector(CX - R, CY + R);
  SQ.t = createVector(CX, CY - R);
  SQ.r = createVector(CX + R, CY);
  SQ.b = createVector(CX, CY + R);
  SQ.l = createVector(CX - R, CY);

  sqPixelL = CX - R;
  sqPixelT = CY - R;
  sqPixelW = R * 2;
  sqPixelH = R * 2;

  drawingLayer = createGraphics(512, 512);
  drawingLayer.background(...PAPER_COL);

  craneCanvas = createGraphics(CW, CH, WEBGL);
  craneCanvas.pixelDensity(1);

  brushColor = color(30, 30, 120);

  let bx = 20;
  btnPrev = createButton('← prev');
  btnPrev.position(bx, height + 8);
  btnPrev.mousePressed(() => {
    currentStep = max(0, currentStep - 1);
  });
  bx += 72;

  btnNext = createButton('next →');
  btnNext.position(bx, height + 8);
  btnNext.mousePressed(() => {
    currentStep = min(totalSteps - 1, currentStep + 1);
  });
  bx += 72;

  btnWings = createButton('wings: ON');
  btnWings.position(bx, height + 8);
  btnWings.mousePressed(() => {
    showWings = !showWings;
    btnWings.html(`wings: ${showWings ? 'ON' : 'OFF'}`);
  });
  bx += 100;

  colorPicker = createColorPicker('#1e1e78');
  colorPicker.position(bx, height + 8);
  colorPicker.input(() => {
    brushColor = colorPicker.color();
    isErasing = false;
    btnErase.html('eraser');
  });
  bx += 50;

  brushSizeSlider = createSlider(2, 40, 10, 1);
  brushSizeSlider.position(bx, height + 12);
  brushSizeSlider.style('width', '90px');
  brushSizeSlider.input(() => {
    brushSize = brushSizeSlider.value();
  });
  bx += 102;

  btnErase = createButton('eraser');
  btnErase.position(bx, height + 8);
  btnErase.mousePressed(() => {
    isErasing = !isErasing;
    btnErase.html(isErasing ? '✓ eraser' : 'eraser');
  });
  bx += 78;

  btnClear = createButton('clear drawing');
  btnClear.position(bx, height + 8);
  btnClear.mousePressed(() => drawingLayer.background(...PAPER_COL));
}

function draw() {
  background(250, 249, 245);
  fill(...LABEL_COL);
  noStroke();
  textSize(12);
  textAlign(LEFT, TOP);
  text(stepLabels[currentStep], 20, 12);
  textSize(10);
  fill(140, 136, 120);
  text(stepDescs[currentStep], 20, 28);

  for (let i = 0; i < totalSteps; i += 1) {
    fill(i === currentStep ? color(...VALLEY_COL) : color(200, 196, 180));
    noStroke();
    ellipse(width - CW - 20 - (totalSteps - 1 - i) * 14, 20, 7, 7);
  }

  handleDrawing();

  if (currentStep === 0) drawStep1();
  else if (currentStep === 1) drawStep2();
  else if (currentStep === 2) drawStep3();
  else if (currentStep === 3) drawStep4();
  else if (currentStep === 4) drawStep5();
  else drawFull();

  drawingContext.save();
  drawingContext.globalAlpha = 0.85;
  drawingContext.drawImage(drawingLayer.elt, sqPixelL, sqPixelT, sqPixelW, sqPixelH);
  drawingContext.restore();

  drawLegend();
  renderCrane();

  const cX = width - CW - 10;
  const cY = height - CH - 44;
  drawingContext.drawImage(craneCanvas.elt, cX, cY, CW, CH);

  noFill();
  stroke(180, 170, 140);
  strokeWeight(1);
  rect(cX, cY, CW, CH, 4);

  fill(...LABEL_COL);
  noStroke();
  textSize(9);
  text('drag to rotate', cX + 6, cY + 4);
  text(`brush: ${brushSize}px`, 436, height + 14);
}

function handleDrawing() {
  if (!mouseIsPressed) return;

  const cX = width - CW - 10;
  const cY = height - CH - 44;
  if (mouseX > cX && mouseX < cX + CW && mouseY > cY && mouseY < cY + CH) return;

  const u = map(mouseX, sqPixelL, sqPixelL + sqPixelW, 0, 512);
  const v = map(mouseY, sqPixelT, sqPixelT + sqPixelH, 0, 512);
  if (u < 0 || u > 512 || v < 0 || v > 512) return;

  drawingLayer.push();
  if (isErasing) {
    drawingLayer.erase();
    drawingLayer.stroke(255);
  } else {
    drawingLayer.stroke(brushColor);
  }
  drawingLayer.strokeWeight(brushSize * (512 / sqPixelW));
  drawingLayer.strokeCap(ROUND);
  drawingLayer.noFill();

  if (pmouseX !== mouseX || pmouseY !== mouseY) {
    const pu = map(pmouseX, sqPixelL, sqPixelL + sqPixelW, 0, 512);
    const pv = map(pmouseY, sqPixelT, sqPixelT + sqPixelH, 0, 512);
    drawingLayer.line(pu, pv, u, v);
  } else {
    drawingLayer.point(u, v);
  }

  if (isErasing) drawingLayer.noErase();
  drawingLayer.pop();
}

function mousePressed() {
  const cX = width - CW - 10;
  const cY = height - CH - 44;
  if (mouseX > cX && mouseX < cX + CW && mouseY > cY && mouseY < cY + CH) {
    craneDragStart = { x: mouseX, y: mouseY, rx: craneRotX, ry: craneRotY };
  }
}

function mouseReleased() {
  craneDragStart = null;
}

function mouseDragged() {
  if (!craneDragStart) return;
  craneRotY = craneDragStart.ry + (mouseX - craneDragStart.x) * 0.012;
  craneRotX = craneDragStart.rx + (mouseY - craneDragStart.y) * 0.012;
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW) currentStep = min(totalSteps - 1, currentStep + 1);
  if (keyCode === LEFT_ARROW) currentStep = max(0, currentStep - 1);
}

function renderCrane() {
  const g = craneCanvas;
  g.background(248, 247, 242);
  g.noLights();

  const tex = g.createImage(512, 512);
  tex.copy(drawingLayer, 0, 0, 512, 512, 0, 0, 512, 512);

  g.push();
  g.rotateX(craneRotX);
  g.rotateY(craneRotY + frameCount * 0.005);
  g.scale(0.72);
  g.noStroke();
  g.tint(255);
  g.texture(tex);
  g.textureMode(NORMAL);

  const triTex = (ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv) => {
    g.beginShape(TRIANGLES);
    g.vertex(ax, ay, az, au, av);
    g.vertex(bx, by, bz, bu, bv);
    g.vertex(cx, cy, cz, cu, cv);
    g.endShape();
  };

  const quadTex = (ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv, dx, dy, dz, du, dv) => {
    g.beginShape(QUADS);
    g.vertex(ax, ay, az, au, av);
    g.vertex(bx, by, bz, bu, bv);
    g.vertex(cx, cy, cz, cu, cv);
    g.vertex(dx, dy, dz, du, dv);
    g.endShape();
  };

  triTex(0, -30, 30, 0.5, 0.5, -20, 10, 20, 0.35, 0.6, 20, 10, 20, 0.65, 0.6);
  triTex(0, -30, 30, 0.5, 0.5, 20, 10, 20, 0.65, 0.6, 0, 0, -20, 0.5, 0.45);
  triTex(0, -30, 30, 0.5, 0.5, -20, 10, 20, 0.35, 0.6, 0, 0, -20, 0.5, 0.45);
  triTex(0, -30, -30, 0.5, 0.5, -20, 10, -20, 0.35, 0.6, 20, 10, -20, 0.65, 0.6);
  triTex(0, -30, -30, 0.5, 0.5, 20, 10, -20, 0.65, 0.6, 0, 0, 20, 0.5, 0.55);
  triTex(0, -30, -30, 0.5, 0.5, -20, 10, -20, 0.35, 0.6, 0, 0, 20, 0.5, 0.55);

  triTex(0, -30, 0, 0.5, 0.4, -20, 10, 20, 0.35, 0.6, -110, -10, 0, 0.05, 0.5);
  triTex(0, -30, 0, 0.5, 0.4, -20, 10, -20, 0.35, 0.6, -110, -10, 0, 0.05, 0.5);
  triTex(-110, -10, 0, 0.05, 0.5, -20, 10, 20, 0.35, 0.6, 0, -30, 0, 0.5, 0.4);
  triTex(-110, -10, 0, 0.05, 0.5, -20, 10, -20, 0.35, 0.6, 0, -30, 0, 0.5, 0.4);
  triTex(-110, -10, 0, 0.05, 0.5, -20, 10, 20, 0.35, 0.6, -20, 10, -20, 0.35, 0.6);

  triTex(0, -30, 0, 0.5, 0.4, 20, 10, 20, 0.65, 0.6, 110, -10, 0, 0.95, 0.5);
  triTex(0, -30, 0, 0.5, 0.4, 20, 10, -20, 0.65, 0.6, 110, -10, 0, 0.95, 0.5);
  triTex(110, -10, 0, 0.95, 0.5, 20, 10, 20, 0.65, 0.6, 0, -30, 0, 0.5, 0.4);
  triTex(110, -10, 0, 0.95, 0.5, 20, 10, -20, 0.65, 0.6, 0, -30, 0, 0.5, 0.4);
  triTex(110, -10, 0, 0.95, 0.5, 20, 10, 20, 0.65, 0.6, 20, 10, -20, 0.65, 0.6);

  triTex(0, 10, 20, 0.5, 0.65, -8, 25, 10, 0.45, 0.75, 8, 25, 10, 0.55, 0.75);
  triTex(0, 10, 20, 0.5, 0.65, 8, 25, 10, 0.55, 0.75, 0, 40, 0, 0.5, 0.92);
  triTex(0, 10, 20, 0.5, 0.65, -8, 25, 10, 0.45, 0.75, 0, 40, 0, 0.5, 0.92);
  triTex(0, 10, -20, 0.5, 0.65, -8, 25, -10, 0.45, 0.75, 8, 25, -10, 0.55, 0.75);
  triTex(0, 10, -20, 0.5, 0.65, 8, 25, -10, 0.55, 0.75, 0, 40, 0, 0.5, 0.92);
  triTex(0, 10, -20, 0.5, 0.65, -8, 25, -10, 0.45, 0.75, 0, 40, 0, 0.5, 0.92);

  quadTex(-6, -30, 4, 0.47, 0.3, 6, -30, 4, 0.53, 0.3, 4, -72, 2, 0.52, 0.08, -4, -72, 2, 0.48, 0.08);
  quadTex(-6, -30, -4, 0.47, 0.3, 6, -30, -4, 0.53, 0.3, 4, -72, -2, 0.52, 0.08, -4, -72, -2, 0.48, 0.08);
  quadTex(-6, -30, 4, 0.47, 0.3, -6, -30, -4, 0.47, 0.3, -4, -72, -2, 0.48, 0.08, -4, -72, 2, 0.48, 0.08);
  quadTex(6, -30, 4, 0.53, 0.3, 6, -30, -4, 0.53, 0.3, 4, -72, -2, 0.52, 0.08, 4, -72, 2, 0.52, 0.08);

  triTex(-6, -72, 3, 0.47, 0.06, 6, -72, 3, 0.53, 0.06, 0, -85, 14, 0.5, 0.02);
  triTex(-6, -72, -3, 0.47, 0.06, 6, -72, -3, 0.53, 0.06, 0, -85, -6, 0.5, 0.02);
  triTex(-6, -72, 3, 0.47, 0.06, 6, -72, 3, 0.53, 0.06, 0, -80, 0, 0.5, 0.04);

  g.pop();
}

function drawPaper() {
  fill(...PAPER_COL, 200);
  stroke(140, 128, 88);
  strokeWeight(1.5);
  quad(SQ.tl.x, SQ.tl.y, SQ.tr.x, SQ.tr.y, SQ.br.x, SQ.br.y, SQ.bl.x, SQ.bl.y);
}
const valleyLine = (x1, y1, x2, y2) => dashedLine(x1, y1, x2, y2, VALLEY_COL, 1.5, [8, 5]);
const mountainLine = (x1, y1, x2, y2) => dashedLine(x1, y1, x2, y2, MOUNTAIN_COL, 1.5, [10, 3, 2, 3]);
const creaseLine = (x1, y1, x2, y2) => dashedLine(x1, y1, x2, y2, CREASE_COL, 0.8, [3, 5]);

function dashedLine(x1, y1, x2, y2, col, w, dash) {
  stroke(...col);
  strokeWeight(w);
  drawingContext.setLineDash(dash);
  line(x1, y1, x2, y2);
  drawingContext.setLineDash([]);
}

function drawWings() {
  if (!showWings) return;
  fill(...WING_FILL);
  stroke(...WING_STROKE);
  strokeWeight(1.2);
  drawingContext.setLineDash([6, 4]);
  triangle(SQ.l.x, SQ.l.y, SQ.bl.x, SQ.bl.y, CX, CY);
  triangle(SQ.l.x, SQ.l.y, SQ.tl.x, SQ.tl.y, CX, CY);
  triangle(SQ.r.x, SQ.r.y, SQ.tr.x, SQ.tr.y, CX, CY);
  triangle(SQ.r.x, SQ.r.y, SQ.br.x, SQ.br.y, CX, CY);
  drawingContext.setLineDash([]);
  noStroke();
  fill(...WING_STROKE);
  textSize(10);
  textAlign(CENTER, CENTER);
  text('left\nwing', SQ.l.x - 22, SQ.l.y + 4);
  text('right\nwing', SQ.r.x + 22, SQ.r.y + 4);
}

const cornerLabels = () => {
  fill(...LABEL_COL); noStroke(); textSize(11); textAlign(CENTER, CENTER);
  text('A', SQ.tl.x - 10, SQ.tl.y - 10); text('B', SQ.tr.x + 10, SQ.tr.y - 10);
  text('C', SQ.br.x + 10, SQ.br.y + 10); text('D', SQ.bl.x - 10, SQ.bl.y + 10);
};
function labelNote(x, y, s, col) { fill(...col); noStroke(); textSize(10); textAlign(CENTER, CENTER); text(s, x, y); }
function arrowHead(x1, y1, x2, y2, col) {
  const a = atan2(y2 - y1, x2 - x1), sz = 8;
  stroke(...col); strokeWeight(1.5); line(x1, y1, x2, y2);
  fill(...col); noStroke(); push(); translate(x2, y2); rotate(a); triangle(0, 0, -sz, -sz * 0.4, -sz, sz * 0.4); pop();
}
function drawStep1() { drawPaper(); creaseLine(SQ.tl.x, CY, SQ.tr.x, CY); creaseLine(CX, SQ.tl.y, CX, SQ.bl.y); creaseLine(SQ.tl.x, SQ.tl.y, SQ.br.x, SQ.br.y); creaseLine(SQ.tr.x, SQ.tr.y, SQ.bl.x, SQ.bl.y); drawWings(); cornerLabels(); labelNote(CX, CY + 12, 'center', LABEL_COL); }
function drawStep2() { drawPaper(); drawWings(); valleyLine(SQ.tl.x, CY, SQ.tr.x, CY); valleyLine(CX, SQ.tl.y, CX, SQ.bl.y); arrowHead(CX, SQ.tl.y + 24, CX, CY - 12, VALLEY_COL); arrowHead(SQ.tl.x + 24, CY, CX - 12, CY, VALLEY_COL); labelNote(CX + 18, SQ.tl.y + 40, 'fold\ndown', VALLEY_COL); labelNote(SQ.tl.x + 38, CY - 18, 'fold\nright', VALLEY_COL); cornerLabels(); }
function drawStep3() { drawPaper(); drawWings(); creaseLine(SQ.tl.x, CY, SQ.tr.x, CY); creaseLine(CX, SQ.tl.y, CX, SQ.bl.y); mountainLine(SQ.tl.x, SQ.tl.y, SQ.br.x, SQ.br.y); mountainLine(SQ.tr.x, SQ.tr.y, SQ.bl.x, SQ.bl.y); labelNote(CX + 60, CY - 60, 'mountain\nfold', MOUNTAIN_COL); cornerLabels(); }
function drawStep4() { const r = R * 0.65; const dt = createVector(CX, CY - r), dr = createVector(CX + r, CY), db = createVector(CX, CY + r), dl = createVector(CX - r, CY); fill(...PAPER_COL); stroke(140, 128, 88); strokeWeight(1.5); quad(dt.x, dt.y, dr.x, dr.y, db.x, db.y, dl.x, dl.y); valleyLine(dt.x, dt.y, db.x, db.y); valleyLine(dl.x, dl.y, dr.x, dr.y); dashedLine(dt.x, dt.y, dr.x, dr.y, CREASE_COL, 0.8, [3, 4]); dashedLine(dr.x, dr.y, db.x, db.y, CREASE_COL, 0.8, [3, 4]); labelNote(CX, CY - r / 2 - 12, '1 layer', LABEL_COL); labelNote(CX, CY + r / 2 + 12, 'open end', LABEL_COL); labelNote(CX - r / 2 - 10, CY, '2\nlayers', LABEL_COL); }
function drawStep5() { const r = R * 0.65; const dt = createVector(CX, CY - r), dr = createVector(CX + r, CY), db = createVector(CX, CY + r), dl = createVector(CX - r, CY); fill(...PAPER_COL); stroke(140, 128, 88); strokeWeight(1.5); quad(dt.x, dt.y, dr.x, dr.y, db.x, db.y, dl.x, dl.y); creaseLine(dt.x, dt.y, db.x, db.y); creaseLine(dl.x, dl.y, dr.x, dr.y); const mid = r * 0.5; valleyLine(dl.x, dl.y, CX, CY - mid); valleyLine(dl.x, dl.y, CX, CY + mid); mountainLine(dr.x, dr.y, CX, CY - mid); mountainLine(dr.x, dr.y, CX, CY + mid); arrowHead(dl.x + 18, CY - r * 0.18, CX - 10, CY - r * 0.28, VALLEY_COL); }
function drawFull() { drawPaper(); drawWings(); valleyLine(SQ.tl.x, CY, SQ.tr.x, CY); valleyLine(CX, SQ.tl.y, CX, SQ.bl.y); mountainLine(SQ.tl.x, SQ.tl.y, SQ.br.x, SQ.br.y); mountainLine(SQ.tr.x, SQ.tr.y, SQ.bl.x, SQ.bl.y); const offs = R * 0.5; valleyLine(SQ.l.x, SQ.l.y, CX, CY - offs); valleyLine(SQ.l.x, SQ.l.y, CX, CY + offs); valleyLine(SQ.r.x, SQ.r.y, CX, CY - offs); valleyLine(SQ.r.x, SQ.r.y, CX, CY + offs); const nip = offs * 0.7; valleyLine(CX, SQ.t.y, CX - nip, CY - offs); valleyLine(CX, SQ.t.y, CX + nip, CY - offs); valleyLine(CX, SQ.b.y, CX - nip, CY + offs); valleyLine(CX, SQ.b.y, CX + nip, CY + offs); labelNote(CX, SQ.t.y - 14, 'head/tail tip', LABEL_COL); labelNote(CX, SQ.b.y + 14, 'tail/head tip', LABEL_COL); cornerLabels(); }

function drawLegend() {
  const lx = 20, ly = height - 18;
  valleyLine(lx, ly, lx + 36, ly);
  fill(...LABEL_COL);
  noStroke();
  textSize(10);
  textAlign(LEFT, CENTER);
  text('valley fold', lx + 40, ly);
  mountainLine(lx + 130, ly, lx + 166, ly);
  fill(...LABEL_COL);
  noStroke();
  text('mountain fold', lx + 170, ly);
  if (showWings) {
    fill(...WING_FILL);
    stroke(...WING_STROKE);
    strokeWeight(1);
    rect(lx + 298, ly - 7, 20, 14, 3);
    fill(...LABEL_COL);
    noStroke();
    text('wing region', lx + 324, ly);
  }
  fill(180, 176, 160);
  textAlign(RIGHT, CENTER);
  text('← → keys to navigate  |  draw on square above', width - CW - 24, ly);
}
