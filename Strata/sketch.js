/* ---------------- Parameters (Tweakpane) ---------------- */
const params = {
	canvasW: 500,
	canvasH: 500,
	leftMargin: 20,
	rightMargin: 20,
	topMargin: 20,
	bottomMargin: 20,
	numLines: 150,
	numPoints: 100,
	noiseScaleX: 0.01,
	noiseScaleY: 0.005,
	noiseOctaves: 7,
	noiseFalloff: 0.5,
	jitter: 40,
	strokeW: 1,
	palette: ['#2b2d42', '#8d99ae', '#ef233c', '#edae49'],
	colorNoiseScaleY: 0.07,
	colorSeed: 10,
	seed: 1115,
	background: 250,
};

let pane;

/* ---------------- p5 lifecycle ---------------- */
function setup() {
	const wrap = document.getElementById('canvas-wrap');
	const c = createCanvas(params.canvasW, params.canvasH);
	c.parent(wrap);
	pixelDensity(2);
	noFill();
	strokeWeight(params.strokeW);
	noiseDetail(params.noiseOctaves, params.noiseFalloff);

	randomSeed(params.seed);
	noiseSeed(params.seed);
	drawField();
	initPane();
}

function draw() {
	// no continuous draw; render on param changes
}

function keyPressed() {
	if (key === 'r' || key === 'R') reroll();
	if (key === 's' || key === 'S') saveCurrent();
}

/* ---------------- Render ---------------- */
function drawField() {
	clear();
	// background(params.background);

	const usableW = width - params.leftMargin - params.rightMargin;
	const usableH = height - params.topMargin - params.bottomMargin;
	const stepY = (params.numLines <= 1) ? 0 : usableH / (params.numLines - 1);

	for (let i = 0; i < params.numLines; i++) {
		const baseY = params.topMargin + i * stepY;

		const cNoise = noise(0.0, baseY * params.colorNoiseScaleY + params.colorSeed) + 0.24;
		let idx = floor(cNoise * params.palette.length);
		if (idx >= params.palette.length) idx = params.palette.length - 1;
		stroke(params.palette[idx]);

		beginShape();
		for (let p = 0; p < params.numPoints; p++) {
			const t = (params.numPoints <= 1) ? 0 : p / (params.numPoints - 1);
			const x = params.leftMargin + t * usableW;
			const n = noise(x * params.noiseScaleX, baseY * params.noiseScaleY);
			const y = baseY + map(n, 0, 1, -params.jitter, params.jitter);
			curveVertex(x, y);
		}
		endShape();
	}
}

function drawFieldToGraphics(g) {
	g.clear();
	// g.background(params.background);
	g.noFill();
	g.strokeWeight(params.strokeW);

	const usableW = params.canvasW - params.leftMargin - params.rightMargin;
	const usableH = params.canvasH - params.topMargin - params.bottomMargin;
	const stepY = (params.numLines <= 1) ? 0 : usableH / (params.numLines - 1);

	for (let i = 0; i < params.numLines; i++) {
		const baseY = params.topMargin + i * stepY;
		const cNoise = noise(0.0, baseY * params.colorNoiseScaleY + params.colorSeed) + 0.24;
		let idx = floor(cNoise * params.palette.length);
		if (idx >= params.palette.length) idx = params.palette.length - 1;
		g.stroke(params.palette[idx]);

		g.beginShape();
		for (let p = 0; p < params.numPoints; p++) {
			const t = (params.numPoints <= 1) ? 0 : p / (params.numPoints - 1);
			const x = params.leftMargin + t * usableW;
			const n = noise(x * params.noiseScaleX, baseY * params.noiseScaleY);
			const y = baseY + map(n, 0, 1, -params.jitter, params.jitter);
			g.curveVertex(x, y);
		}
		g.endShape();
	}
}

/* ---------------- Actions ---------------- */
function reroll() {
	params.seed = floor(random(1e9));
	randomSeed(params.seed);
	noiseSeed(params.seed);
	drawField();
}

function saveCurrent() {
	const filename = `Mountain-${params.seed}-${params.colorSeed}`;
	if (typeof SVG === 'undefined') {
		// Fallback: save PNG of on-screen canvas
		saveCanvas(filename, 'png');
		return;
	}
	const g = createGraphics(params.canvasW, params.canvasH, SVG);
	// match noise and random seeds so offscreen matches onscreen
	randomSeed(params.seed);
	noiseSeed(params.seed);
	noiseDetail(params.noiseOctaves, params.noiseFalloff);
	drawFieldToGraphics(g);
	save(g, filename + '.svg');
	g.remove();
}

/* ---------------- UI (Tweakpane) ---------------- */
function initPane() {
	pane = new Tweakpane.Pane({ container: document.getElementById('pane'), title: 'Strata Tool' });

	const fCanvas = pane.addFolder({ title: 'Canvas', expanded: true });
	fCanvas.addInput(params, 'canvasW', { min: 200, max: 1600, step: 10, label: 'width' }).on('change', () => { resizeCanvas(params.canvasW, params.canvasH); drawField(); });
	fCanvas.addInput(params, 'canvasH', { min: 200, max: 1400, step: 10, label: 'height' }).on('change', () => { resizeCanvas(params.canvasW, params.canvasH); drawField(); });
	fCanvas.addInput(params, 'strokeW', { min: 0.5, max: 8, step: 0.5 }).on('change', () => { strokeWeight(params.strokeW); drawField(); });

	const fLayout = pane.addFolder({ title: 'Layout', expanded: true });
	fLayout.addInput(params, 'leftMargin', { min: 0, max: 200, step: 1 }).on('change', drawField);
	fLayout.addInput(params, 'rightMargin', { min: 0, max: 200, step: 1 }).on('change', drawField);
	fLayout.addInput(params, 'topMargin', { min: 0, max: 200, step: 1 }).on('change', drawField);
	fLayout.addInput(params, 'bottomMargin', { min: 0, max: 200, step: 1 }).on('change', drawField);

	const fGeom = pane.addFolder({ title: 'Geometry', expanded: true });
	fGeom.addInput(params, 'numLines', { min: 1, max: 800, step: 1 }).on('change', drawField);
	fGeom.addInput(params, 'numPoints', { min: 2, max: 800, step: 1 }).on('change', drawField);
	fGeom.addInput(params, 'jitter', { min: 0, max: 200, step: 1 }).on('change', drawField);

	const fNoise = pane.addFolder({ title: 'Noise', expanded: true });
	fNoise.addInput(params, 'noiseScaleX', { min: 0.001, max: 0.1, step: 0.001 }).on('change', drawField);
	fNoise.addInput(params, 'noiseScaleY', { min: 0.001, max: 0.1, step: 0.001 }).on('change', drawField);
	fNoise.addInput(params, 'noiseOctaves', { min: 1, max: 12, step: 1 }).on('change', (ev) => { noiseDetail(params.noiseOctaves, params.noiseFalloff); drawField(); });
	fNoise.addInput(params, 'noiseFalloff', { min: 0.1, max: 1.0, step: 0.01 }).on('change', (ev) => { noiseDetail(params.noiseOctaves, params.noiseFalloff); drawField(); });
	fNoise.addInput(params, 'colorNoiseScaleY', { min: 0.001, max: 0.3, step: 0.001 }).on('change', drawField);
	fNoise.addInput(params, 'colorSeed', { min: 0, max: 100, step: 1 }).on('change', drawField);

	const fPalette = pane.addFolder({ title: 'Palette', expanded: false });
	for (let i = 0; i < params.palette.length; i++) {
		fPalette.addInput(params.palette, i, { view: 'color', color: { type: 'string' }, label: `Color ${i + 1}` }).on('change', drawField);
	}

	pane.addSeparator();
	pane.addButton({ title: 'Reroll Seed (R)' }).on('click', reroll);
	pane.addButton({ title: 'Save SVG (S)' }).on('click', saveCurrent);

	const note = document.createElement('div');
	note.className = 'note';
	note.innerHTML = 'Keys: <b>R</b> reroll seed, <b>S</b> export SVG (off-screen).';
	pane.element.appendChild(note);
} 