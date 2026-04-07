/*
  Interactive Custom Graphics (p5.js)
  - Click to add control points
  - Drag points to reposition
  - Scroll to adjust point size
  - Press 'S' to save a PNG
*/

let controlPoints = [];
let draggedPointIndex = -1;
let pointRadius = 10;
let noiseSeedBase = 1337;

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('app');
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  noiseSeed(noiseSeedBase);
}

function draw() {
  drawBackgroundGradient();

  // Draw organic ribbon between points via Catmull-Rom spline
  if (controlPoints.length >= 2) {
    noFill();
    const t = millis() * 0.0003;

    // Outer glow
    strokeWeight(10);
    stroke(0, 0, 0, 30);
    drawSpline(controlPoints);

    // Core ribbon with animated hue
    const hue = map(sin(t * TWO_PI), -1, 1, 180, 320);
    strokeWeight(3);
    stroke(colorFromHsl(hue, 80, 60, 255));
    drawSpline(controlPoints);

    // Subtle flowing particles along the path
    drawPathParticles(controlPoints, t);
  }

  // Draw points last so they sit above the ribbon
  drawControlPoints();
}

function drawBackgroundGradient() {
  const g1 = color(14, 15, 19);
  const g2 = color(20, 25, 36);
  noFill();
  for (let y = 0; y < height; y++) {
    const n = y / max(1, height - 1);
    const r = lerp(red(g1), red(g2), n);
    const g = lerp(green(g1), green(g2), n);
    const b = lerp(blue(g1), blue(g2), n);
    stroke(r, g, b);
    line(0, y, width, y);
  }
}

function drawControlPoints() {
  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    const isDragged = i === draggedPointIndex;

    // Halo
    noStroke();
    fill(255, 255, 255, isDragged ? 60 : 28);
    circle(p.x, p.y, pointRadius * 3);

    // Core
    fill(220);
    stroke(255);
    strokeWeight(1);
    circle(p.x, p.y, pointRadius * 1.4);

    // Index label
    noStroke();
    fill(200);
    textSize(11);
    textAlign(CENTER, TOP);
    text(i + 1, p.x, p.y + pointRadius * 0.9);
  }
}

function drawSpline(points) {
  beginShape();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    curveVertex(p.x, p.y);
  }
  endShape();
}

function drawPathParticles(points, time) {
  if (points.length < 2) return;

  const steps = 120;
  strokeWeight(1);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const pos = evaluateCatmullRom(points, t);

    const n = noise(time * 0.8 + t * 3.0);
    const angle = n * TWO_PI * 2.0;
    const offset = p5.Vector.fromAngle(angle).mult(6);

    const h = map(n, 0, 1, 200, 280);
    stroke(colorFromHsl(h, 70, 70, 70));
    point(pos.x + offset.x, pos.y + offset.y);
  }
}

// Evaluate Catmull-Rom spline position along points for t in [0,1]
function evaluateCatmullRom(points, t) {
  const n = points.length;
  const total = n - 1;
  if (total <= 0) return createVector(points[0].x, points[0].y);

  const ft = constrain(t, 0, 1) * total;
  const i = min(floor(ft), total - 1);
  const localT = ft - i;

  const p0 = points[max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[min(i + 1, total)];
  const p3 = points[min(i + 2, total)];

  // Catmull-Rom blending
  const tt = localT * localT;
  const ttt = tt * localT;

  const q0 = -0.5 * ttt + tt - 0.5 * localT;
  const q1 = 1.5 * ttt - 2.5 * tt + 1.0;
  const q2 = -1.5 * ttt + 2.0 * tt + 0.5 * localT;
  const q3 = 0.5 * ttt - 0.5 * tt;

  const x = q0 * p0.x + q1 * p1.x + q2 * p2.x + q3 * p3.x;
  const y = q0 * p0.y + q1 * p1.y + q2 * p2.y + q3 * p3.y;
  return createVector(x, y);
}

function mousePressed() {
  const hitIndex = hitTestPoint(mouseX, mouseY, pointRadius * 1.2);
  if (hitIndex >= 0) {
    draggedPointIndex = hitIndex;
  } else {
    controlPoints.push(createVector(mouseX, mouseY));
    draggedPointIndex = controlPoints.length - 1;
  }
}

function mouseDragged() {
  if (draggedPointIndex >= 0) {
    controlPoints[draggedPointIndex].x = mouseX;
    controlPoints[draggedPointIndex].y = mouseY;
  }
}

function mouseReleased() {
  draggedPointIndex = -1;
}

function mouseWheel(event) {
  const delta = event.deltaY;
  const step = 0.5;
  pointRadius = constrain(pointRadius + (delta > 0 ? -step : step), 4, 24);
}

function keyPressed() {
  if (key === 's' || key === 'S') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveCanvas('p5-custom-graphics-' + timestamp, 'png');
  }
  if (key === 'c' || key === 'C') {
    controlPoints = [];
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function hitTestPoint(px, py, radius) {
  for (let i = controlPoints.length - 1; i >= 0; i--) {
    const p = controlPoints[i];
    if (dist(px, py, p.x, p.y) <= radius) return i;
  }
  return -1;
}

function colorFromHsl(h, s, l, a) {
  const c = hslaToRgba(h, s, l, a);
  return color(c.r, c.g, c.b, c.a);
}

// Simple HSL(A) → RGBA conversion
function hslaToRgba(h, s, l, a) {
  h = ((h % 360) + 360) % 360;
  s = constrain(s, 0, 100) / 100;
  l = constrain(l, 0, 100) / 100;
  const c = (1 - abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= hp && hp < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (1 <= hp && hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (2 <= hp && hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (3 <= hp && hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (4 <= hp && hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else if (5 <= hp && hp < 6) { r1 = c; g1 = 0; b1 = x; }
  const m = l - c / 2;
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
    a: a == null ? 255 : a
  };
} 