/* ---------------- Parameters (controlled via Tweakpane) ---------------- */
const params = {
	spacing: 6,
	cols: 50,
	rows: 40,
	gravity: 0.15,
	iterations: 2,
	damping: 0.995,
	stiffness: 0.5,
	cutRadius: 1,
	dragRadius: 10,
	width: 500,
	height: 800,
};

let cloth;
let pane;

/* ---------------- p5 lifecycle ---------------- */
function setup() {
	const wrap = document.getElementById('canvas-wrap');
	const c = createCanvas(params.width, params.height);
	c.parent(wrap);
	pixelDensity(2);
	cloth = new Cloth(params.cols, params.rows, params.spacing);
	initPane();
}

function windowResized() {
	// Keep canvas at chosen size (pane controls), so do nothing here
}

function draw() {
	clear();
	cloth.update();
	cloth.drawScreen();
}

function mouseDragged() {
	if (!keyIsDown(67)) {
		cloth.drag(mouseX, mouseY, params.dragRadius);
	} else {
		cloth.tear(mouseX, mouseY, params.cutRadius);
	}
}

function keyPressed() {
	if (key === 'r' || key === 'R') {
		resetCloth();
	}
	if (key === 's' || key === 'S') {
		exportSVGSnapshot();
	}
}

/* ---------------- SVG export (off-screen buffer) ---------------- */
function exportSVGSnapshot() {
	if (typeof SVG === 'undefined') {
		saveCanvas('cloth-fallback', 'png');
		return;
	}
	const g = createGraphics(width, height, SVG);
	g.clear();
	cloth.drawToGraphics(g);
	save(g, 'cloth.svg');
	g.remove();
}

/* ---------------- UI (Tweakpane) ---------------- */
function resetCloth() {
	resizeCanvas(params.width, params.height);
	cloth = new Cloth(params.cols, params.rows, params.spacing);
}

function initPane() {
	pane = new Tweakpane.Pane({ container: document.getElementById('pane'), title: 'Cloth Tool' });
	const fSim = pane.addFolder({ title: 'Simulation', expanded: true });
	fSim.addInput(params, 'gravity', { min: 0, max: 1, step: 0.005 });
	fSim.addInput(params, 'iterations', { min: 1, max: 8, step: 1 });
	fSim.addInput(params, 'damping', { min: 0.9, max: 1, step: 0.0005 });
	fSim.addInput(params, 'stiffness', { min: 0.05, max: 1, step: 0.01 });

	const fGeom = pane.addFolder({ title: 'Geometry', expanded: true });
	fGeom.addInput(params, 'cols', { min: 5, max: 200, step: 1 }).on('change', resetCloth);
	fGeom.addInput(params, 'rows', { min: 5, max: 200, step: 1 }).on('change', resetCloth);
	fGeom.addInput(params, 'spacing', { min: 2, max: 20, step: 1 }).on('change', resetCloth);

	const fCanvas = pane.addFolder({ title: 'Canvas', expanded: false });
	fCanvas.addInput(params, 'width', { min: 200, max: 1600, step: 10 }).on('change', resetCloth);
	fCanvas.addInput(params, 'height', { min: 200, max: 1400, step: 10 }).on('change', resetCloth);

	const fUX = pane.addFolder({ title: 'Interaction', expanded: false });
	fUX.addInput(params, 'dragRadius', { min: 1, max: 30, step: 1 });
	fUX.addInput(params, 'cutRadius', { min: 0.2, max: 10, step: 0.2 });

	pane.addButton({ title: 'Reset (R)' }).on('click', resetCloth);
	pane.addButton({ title: 'Export SVG (S)' }).on('click', exportSVGSnapshot);

	const note = document.createElement('div');
	note.className = 'note';
	note.innerHTML = 'Drag to move points. Hold <b>C</b> while dragging to cut. Keys: <b>R</b> reset, <b>S</b> export SVG.';
	pane.element.appendChild(note);
}

/* ---------------- Cloth classes ---------------- */
class Cloth {
	constructor(cols, rows, spacing) {
		this.points = [];
		this.constraints = [];

		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const px = width / 2 - (cols * spacing) / 2 + x * spacing;
				const py = 50 + y * spacing;
				const locked = (y === 0);
				this.points.push(new Point(px, py, locked));
			}
		}

		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const i = y * cols + x;
				if (x < cols - 1) this.constraints.push(new Constraint(this.points[i], this.points[i + 1], spacing));
				if (y < rows - 1) this.constraints.push(new Constraint(this.points[i], this.points[i + cols], spacing));
				  if (x < cols - 1 && y < rows - 1) {
          this.constraints.push(new Constraint(this.points[i], this.points[i + cols + 1], spacing * Math.SQRT2));
        }
        if (x > 0 && y < rows - 1) {
          this.constraints.push(new Constraint(this.points[i], this.points[i + cols - 1], spacing * Math.SQRT2));
        }
			}
		}
	}

	update() {
		for (const p of this.points) {
			if (!p.locked) {
				const vx = (p.pos.x - p.prev.x) * params.damping;
				const vy = (p.pos.y - p.prev.y) * params.damping;
				p.prev.set(p.pos);
				p.pos.x += vx;
				p.pos.y += vy + params.gravity;
			}
		}
		for (let k = 0; k < params.iterations; k++) {
			for (const c of this.constraints) c.solve();
		}
	}

	drawScreen() {
		stroke(50);
		strokeWeight(1);
		noFill();
		for (const c of this.constraints) c.drawScreen();
		noStroke();
		fill(80);
		for (const p of this.points) p.drawScreen();
	}

	drawToGraphics(g) {
		g.stroke(10);
		g.strokeWeight(1);
		g.noFill();
		for (const c of this.constraints) c.drawGraphics(g);
		g.noStroke();
		g.fill(20);
		for (const p of this.points) p.drawGraphics(g);
	}

	drag(mx, my, radius) {
		for (const p of this.points) {
			if (dist(mx, my, p.pos.x, p.pos.y) < radius) {
				p.pos.set(mx, my);
			}
		}
	}

	tear(mx, my, radius) {
		for (let i = this.constraints.length - 1; i >= 0; i--) {
			const c = this.constraints[i];
			const d = distToSegment(mx, my, c.p1.pos.x, c.p1.pos.y, c.p2.pos.x, c.p2.pos.y);
			if (d < radius) this.constraints.splice(i, 1);
		}
	}
}

class Point {
	constructor(x, y, locked = false) {
		this.pos = createVector(x, y);
		this.prev = this.pos.copy();
		this.locked = locked;
	}
	drawScreen() {
		// ellipse(this.pos.x, this.pos.y, 3, 3);
	}
	drawGraphics(g) {
		// g.ellipse(this.pos.x, this.pos.y, 3, 3);
	}
}

class Constraint {
	constructor(p1, p2, restLength) {
		this.p1 = p1;
		this.p2 = p2;
		this.restLength = restLength;
	}
	solve() {
		const delta = p5.Vector.sub(this.p2.pos, this.p1.pos);
		const d = delta.mag();
		if (d === 0) return;
		const diff = ((d - this.restLength) / d) * 0.99;
		delta.mult(0.5 * params.stiffness * diff);
		if (!this.p1.locked) this.p1.pos.add(delta);
		if (!this.p2.locked) this.p2.pos.sub(delta);
	}
	drawScreen() {
		line(this.p1.pos.x, this.p1.pos.y, this.p2.pos.x, this.p2.pos.y);
	}
	drawGraphics(g) {
		g.line(this.p1.pos.x, this.p1.pos.y, this.p2.pos.x, this.p2.pos.y);
	}
}

/* ---------------- Utility ---------------- */
function distToSegment(px, py, x1, y1, x2, y2) {
	const vx = x2 - x1, vy = y2 - y1;
	const wx = px - x1, wy = py - y1;
	const c1 = vx * wx + vy * wy;
	if (c1 <= 0) return dist(px, py, x1, y1);
	const c2 = vx * vx + vy * vy;
	if (c2 <= c1) return dist(px, py, x2, y2);
	const t = c1 / c2;
	const projx = x1 + t * vx;
	const projy = y1 + t * vy;
	return dist(px, py, projx, projy);
} 