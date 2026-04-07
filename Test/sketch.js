function setup() {
  createCanvas(windowWidth, windowHeight);
  background(240);
}

function draw() {
  background(240);

  const radius = 80;
  const x = width / 2 + Math.cos(frameCount * 0.02) * 150;
  const y = height / 2 + Math.sin(frameCount * 0.02) * 150;

  noStroke();
  fill(30, 144, 255);
  circle(x, y, radius);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
} 