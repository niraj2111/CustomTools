import {
  APP_VERSION, GEOMETRY_VERSION, PALETTE, PAPER, WORKSHOP,
  fromWorkshopSeed, resolve, svg, workshopState,
} from './geometry.mjs?v=3.8.0';
import {
  STAGES, addCandidate, candidate, confirmSelection, createSession,
  filenamePart, finalState, hydrateSession, randomizeWorking,
  setControl, startJourney,
} from './workshop.mjs?v=3.8.0';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const STORAGE_KEY = 'vase3-guided-session-v2';
const RECORDS_KEY = 'vase3-workshop-records';
const RANDOM_DURATION_MS = 720;
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };

const UI_CONTROLS = [
  { key:'presence', group:'proportion', name:'Body width', low:'Narrow', high:'Wide' },
  { key:'openness', group:'proportion', name:'Neck opening', low:'Narrow', high:'Open' },
  { key:'expression', group:'proportion', name:'Rim flare', low:'Straight', high:'Flared' },
  { key:'center', group:'proportion', name:'Center of volume', low:'High', high:'Low' },
  { key:'reserve', group:'proportion', name:'Neck length', low:'Short', high:'Long' },
  { key:'foundation', group:'proportion', name:'Base height', low:'Low', high:'Tall' },
  { key:'approach', group:'curve', name:'Upper curve', low:'Inward', high:'Outward' },
  { key:'release', group:'curve', name:'Lower curve', low:'Inward', high:'Outward' },
  { key:'stance', group:'curve', name:'Lower stance', low:'Tapered', high:'Broad' },
  { key:'grounding', group:'curve', name:'Base width', low:'Narrow', high:'Wide' },
  { key:'curiosity', group:'branch', name:'Branch spread', low:'Focused', high:'Open' },
  { key:'variation', group:'branch', name:'Branch variation', low:'Ordered', high:'Irregular' },
];
const UI_GROUPS = [
  { id:'proportion', name:'Proportion' },
  { id:'curve', name:'Posture and curve' },
  { id:'branch', name:'Branch' },
];

let session = hydrateSession(readLocal(STORAGE_KEY, null), randomSeed());
let records = [];
let server = false;
let toastTimer;
let randomAnimation = 0;

function persist() {
  session.working = workshopState(session.working);
  writeLocal(STORAGE_KEY, session);
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(`api/${path}`, { ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'The workshop archive is unavailable.');
  }
  return response.json();
}

function canVisit(stage) {
  if (stage === 'home') return true;
  if (stage === 'build') return session.started;
  if (stage === 'choose') return session.candidates.length > 0;
  return Boolean(session.final);
}

function progress(active) {
  const labels = { home:'Home', build:'Build', choose:'Choose', download:'Download' };
  const activeIndex = STAGES.indexOf(active);
  return `<nav class="progress" aria-label="Workshop steps">${STAGES.map((stage, index) => `<button data-step="${stage}" ${canVisit(stage) ? '' : 'disabled'} class="${stage === active ? 'active' : ''} ${index < activeIndex ? 'done' : ''}" ${stage === active ? 'aria-current="step"' : ''}><i>${index + 1}</i><span>${labels[stage]}</span></button>`).join('')}</nav>`;
}

function paper(state, label = 'Vase portrait', compact = false) {
  return `<div class="paper ${compact ? 'compact' : ''}"><div class="paper-art">${svg(workshopState(state), { title:label })}</div></div>`;
}

function stageCopy(step, title, instruction) {
  return `<div class="stage-copy"><span class="eyebrow">${step}</span><h1>${title}</h1><p>${instruction}</p></div>`;
}

function canvas(state, label) {
  return `<div class="canvas" id="live-canvas">${paper(state, label)}</div>`;
}

function landingBackground() {
  const heights = [214, 252, 228, 274, 238, 262, 220, 246, 282, 232, 268, 224];
  const placements = Array.from({ length:36 }, (_, index) => [107 + index * 113, index % 5, heights[index % heights.length]]);
  return `<div class="landing-vases" aria-hidden="true">${placements.map(([seed, color, height]) => {
    const state = { ...fromWorkshopSeed(seed), color:PALETTE[color].id };
    return `<div class="landing-vase" style="--card-height:${height}px;--mobile-height:${Math.round(height * 0.68)}px">${svg(state, { title:'Decorative generative vase' })}</div>`;
  }).join('')}</div>`;
}

function lockIcon(locked) {
  const shackle = locked ? 'M3 6V4a3 3 0 0 1 6 0v2' : 'M4 6V4a3 3 0 0 1 5.6-1.5';
  return `<svg viewBox="0 0 12 14" aria-hidden="true"><path d="${shackle}"/><rect x="2" y="6" width="8" height="7" rx="1"/></svg>`;
}

function renderHome() {
  app.innerHTML = `<section class="experience home-page">${landingBackground()}<div class="home-content"><span class="eyebrow">GENERATIVE PORTRAITS</span><h1>Vases</h1><p>Think of someone—their posture, presence and way of holding themselves. Shape a vase that feels like a portrait, without using a face.</p><label for="participant">Your name or participant code</label><input id="participant" maxlength="40" value="${escape(session.participant)}" placeholder="" autocomplete="off"><small>Used in the downloaded filename.</small><button class="primary-button" data-action="begin">${session.started ? 'Begin a new journey' : 'Begin'} <span>→</span></button></div></section>`;
}

function controlMarkup(control) {
  const locked = session.locks.includes(control.key);
  return `<div class="control"><div class="control-head"><label for="control-${control.key}">${control.name}</label><button class="lock ${locked ? 'locked' : ''}" data-lock="${control.key}" aria-pressed="${locked}" aria-label="${locked ? 'Unlock' : 'Lock'} ${control.name}">${lockIcon(locked)}</button></div><input id="control-${control.key}" data-control="${control.key}" type="range" min="0" max="100" value="${Math.round(session.working[control.key] * 100)}" style="--value:${session.working[control.key] * 100}%"><p><span>${control.low}</span><span>${control.high}</span></p></div>`;
}

function renderBuild() {
  app.innerHTML = `<section class="experience build-page">${progress('build')}${stageCopy('STEP 2 OF 4', 'Build the portrait.', 'Lock what feels right. Randomise changes everything else.')}${canvas(session.working, `${session.participant} working vase`)}<aside class="control-overlay" aria-label="Vase controls">${UI_GROUPS.map(group => `<section class="control-group"><h2>${group.name}</h2>${UI_CONTROLS.filter(control => control.group === group.id).map(controlMarkup).join('')}</section>`).join('')}</aside><div class="canvas-actions"><button class="secondary-button" data-action="randomise">Randomise <span>↻</span></button><button class="icon-button" data-action="shortlist" aria-label="Shortlist this vase" title="Shortlist this vase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 3.75h10.5v16.5L12 16.5l-5.25 3.75V3.75Z"/></svg>${session.candidates.length ? `<b>${session.candidates.length}</b>` : ''}</button><button class="primary-button" data-action="keep-candidate">Choose this <span>→</span></button></div></section>`;
}

function renderChoose() {
  app.innerHTML = `<section class="experience choose-page">${progress('choose')}${stageCopy('STEP 3 OF 4', 'Choose one form.', 'Select the vase that best corresponds to the person you had in mind, or return to Build and create another.')}
    <div class="candidate-area"><div class="candidate-grid">${session.candidates.map((item, index) => `<button class="candidate-card ${session.selectedId === item.id ? 'selected' : ''}" data-candidate="${escape(item.id)}"><span>FORM ${String(index + 1).padStart(2, '0')}</span>${paper(item.state, `Candidate ${index + 1}`, true)}${session.selectedId === item.id ? '<b>Selected</b>' : '<b>Select</b>'}</button>`).join('')}</div></div>
    <div class="choice-actions"><button class="secondary-button" data-action="create-more">Create more <span>←</span></button><button class="primary-button" data-action="proceed" ${session.selectedId ? '' : 'disabled'}>Proceed <span>→</span></button></div>
  </section>`;
}

function renderDownload() {
  if (!session.final) { session.stage = 'choose'; persist(); return renderChoose(); }
  const state = finalState(session);
  app.innerHTML = `<section class="experience download-page">${progress('download')}${stageCopy('STEP 4 OF 4', 'Ready to plot.', `Download the selected vase as an SVG. <span class="download-filename">${escape(filenamePart(session.participant))}-vase.svg</span>`)}${canvas(state, `${session.participant} vase portrait`)}<div class="canvas-actions download-actions"><button class="primary-button" data-action="save-download">${session.savedRecordId ? 'Download again' : 'Save & download SVG'} <span>↓</span></button><button class="quiet-link" data-action="new-journey">Start a new journey</button></div></section>`;
}

function render() {
  cancelRandomAnimation();
  if (session.stage === 'home') renderHome();
  else if (session.stage === 'build') renderBuild();
  else if (session.stage === 'choose') renderChoose();
  else renderDownload();
}

function go(stage) {
  if (!canVisit(stage)) return;
  session.stage = stage;
  persist();
  render();
}

function updateCanvas(state = session.working) {
  const target = $('#live-canvas');
  if (target) target.innerHTML = paper(state, `${session.participant} vase portrait`);
}

function cancelRandomAnimation() {
  if (randomAnimation) cancelAnimationFrame(randomAnimation);
  randomAnimation = 0;
}

function easeInOut(value) {
  return value * value * (3 - 2 * value);
}

function animateRandomise(target) {
  cancelRandomAnimation();
  const start = workshopState(session.working);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    session.working = target;
    persist();
    render();
    return;
  }
  const startedAt = performance.now();
  const tick = now => {
    const progressValue = Math.min(1, (now - startedAt) / RANDOM_DURATION_MS);
    const amount = easeInOut(progressValue);
    const intermediate = { ...start, seed:target.seed, variation:target.variation };
    for (const control of UI_CONTROLS) {
      if (control.key === 'variation') continue;
      intermediate[control.key] = start[control.key] + (target[control.key] - start[control.key]) * amount;
    }
    updateCanvas(workshopState(intermediate));
    if (progressValue < 1) randomAnimation = requestAnimationFrame(tick);
    else {
      randomAnimation = 0;
      session.working = workshopState(target);
      persist();
      render();
    }
  };
  randomAnimation = requestAnimationFrame(tick);
}

function makeRecord() {
  const state = finalState(session);
  const params = resolve(state);
  if (!state || !state.growth || params.vaseLines !== WORKSHOP.vaseIntervals || Math.abs(params.vaseHeightMM - WORKSHOP.vaseHeightMM) > 0.001) throw new Error('The vase does not meet the fixed workshop settings.');
  const participant = session.participant.trim();
  const record = {
    schemaVersion:2,
    appVersion:APP_VERSION,
    geometryVersion:GEOMETRY_VERSION,
    exerciseVersion:WORKSHOP.id,
    id:`V3-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name:`${participant} — Vase`,
    participant,
    filenameParticipant:filenamePart(participant),
    createdAt:new Date().toISOString(),
    status:'saved',
    final:true,
    state,
    workshop:{ fixedVaseHeightMM:WORKSHOP.vaseHeightMM, fixedCompositionHeightMM:WORKSHOP.compositionHeightMM, vaseLines:WORKSHOP.vaseLines, selectedAt:session.final.confirmedAt, candidateId:session.final.id },
    resolved:params,
    paper:{ ...PAPER },
  };
  record.svg = svg(state, { title:record.name });
  return record;
}

function downloadSVG(record) {
  const url = URL.createObjectURL(new Blob([record.svg], { type:'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${record.filenameParticipant}-vase.svg`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveRecord(record) {
  if (session.savedRecordId) return records.find(item => item.id === session.savedRecordId) || record;
  let saved = record;
  if (server) saved = await api('vases', { method:'POST', body:JSON.stringify(record) });
  else {
    records = [record, ...records];
    if (!writeLocal(RECORDS_KEY, records)) throw new Error('Browser storage is full.');
  }
  if (server) records.unshift(saved);
  session.savedRecordId = saved.id;
  session.savedAt = saved.createdAt;
  persist();
  return saved;
}

const actions = {
  help:() => $('#help-dialog').showModal(),
  'close-help':() => $('#help-dialog').close(),
  home:() => go('home'),
  begin:() => {
    if (!session.participant.trim()) { $('#participant').focus(); return toast('Enter your name or participant code.'); }
    session = startJourney(session, randomSeed());
    persist();
    render();
  },
  randomise:() => {
    const target = randomizeWorking(session.working, fromWorkshopSeed(randomSeed()), session.locks);
    animateRandomise(target);
  },
  shortlist:() => {
    cancelRandomAnimation();
    const count = session.candidates.length;
    session = addCandidate(session, candidate(crypto.randomUUID(), session.working));
    persist();
    render();
    toast(session.candidates.length > count ? `Form shortlisted · ${session.candidates.length}` : 'This form is already shortlisted.');
  },
  'keep-candidate':() => {
    cancelRandomAnimation();
    session = addCandidate(session, candidate(crypto.randomUUID(), session.working));
    session.stage = 'choose';
    persist();
    render();
  },
  'create-more':() => go('build'),
  proceed:() => {
    session = confirmSelection(session);
    persist();
    render();
  },
  'new-journey':() => {
    const participant = session.participant;
    session = createSession(randomSeed());
    session.participant = participant;
    persist();
    render();
  },
  'save-download':async() => {
    await storageReady;
    try {
      const existing = session.savedRecordId ? records.find(item => item.id === session.savedRecordId) : null;
      const record = existing || makeRecord();
      downloadSVG(record);
      toast(`${record.filenameParticipant}-vase.svg downloaded`);
      if (!existing) {
        await saveRecord(record);
        render();
      }
    } catch (error) { toast(error.message); }
  },
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.action && actions[button.dataset.action]) actions[button.dataset.action]();
  if (button.dataset.step) go(button.dataset.step);
  if (button.dataset.lock) {
    const key = button.dataset.lock;
    session.locks = session.locks.includes(key) ? session.locks.filter(item => item !== key) : [...session.locks, key];
    persist();
    render();
  }
  if (button.dataset.candidate) {
    session.selectedId = button.dataset.candidate;
    persist();
    render();
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'participant') {
    session.participant = event.target.value.slice(0, 40);
    persist();
  }
  if (event.target.dataset.control) {
    cancelRandomAnimation();
    const key = event.target.dataset.control;
    session.working = setControl(session.working, key, Number(event.target.value) / 100);
    event.target.style.setProperty('--value', `${event.target.value}%`);
    persist();
    updateCanvas();
  }
});

$('#help-dialog').addEventListener('click', event => {
  if (event.target === $('#help-dialog')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  }
});

render();

const storageReady = (async() => {
  try { const health = await api('health'); server = health.service === 'vase3-workshop'; } catch { server = false; }
  if (server) { try { records = await api('vases'); } catch (error) { toast(error.message); } }
  else { records = readLocal(RECORDS_KEY, []); if (!Array.isArray(records)) records = []; }
})();
