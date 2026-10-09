import { CONTROLS, fromWorkshopSeed, workshopState } from './geometry.mjs';

export const SESSION_VERSION = 3;
export const STAGES = ['home', 'build', 'choose', 'download'];
export const MAX_CANDIDATES = 12;

const controlKeys = new Set(CONTROLS.map(control => control.key));

export function candidate(id, state, createdAt = new Date().toISOString()) {
  return { id, state:workshopState(state), createdAt };
}

export function createSession(seed = 42) {
  return {
    version:SESSION_VERSION,
    stage:'home',
    started:false,
    participant:'',
    working:fromWorkshopSeed(seed),
    locks:[],
    candidates:[],
    selectedId:null,
    final:null,
    savedRecordId:null,
    savedAt:null,
  };
}

export function hydrateSession(raw, fallbackSeed = 42) {
  const fallback = createSession(fallbackSeed);
  if (!raw || raw.version !== SESSION_VERSION || !STAGES.includes(raw.stage)) return fallback;
  const cleanCandidate = item => item && typeof item.id === 'string'
    ? candidate(item.id.slice(0, 80), item.state, item.createdAt)
    : null;
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.map(cleanCandidate).filter(Boolean).slice(0, MAX_CANDIDATES)
    : [];
  const final = raw.final && typeof raw.final.id === 'string'
    ? { ...cleanCandidate(raw.final), confirmedAt:raw.final.confirmedAt || raw.final.createdAt }
    : null;
  return {
    ...fallback,
    ...raw,
    started:raw.started === true,
    participant:typeof raw.participant === 'string' ? raw.participant.slice(0, 40) : '',
    working:workshopState(raw.working),
    locks:Array.isArray(raw.locks) ? [...new Set(raw.locks.filter(key => controlKeys.has(key)))] : [],
    candidates,
    selectedId:candidates.some(item => item.id === raw.selectedId) ? raw.selectedId : null,
    final,
    savedRecordId:typeof raw.savedRecordId === 'string' ? raw.savedRecordId : null,
    savedAt:typeof raw.savedAt === 'string' ? raw.savedAt : null,
  };
}

export function startJourney(session, seed) {
  return {
    ...createSession(seed),
    participant:session.participant.trim(),
    started:true,
    stage:'build',
  };
}

export function randomizeWorking(current, incoming, locks = []) {
  const locked = new Set(locks);
  const next = workshopState(incoming);
  for (const { key } of CONTROLS) if (locked.has(key)) next[key] = current[key];
  return workshopState(next);
}

export function setControl(state, key, value) {
  if (!controlKeys.has(key)) return workshopState(state);
  return workshopState({ ...state, [key]:Math.max(0, Math.min(1, Number(value))) });
}

export function addCandidate(session, item) {
  const signature = JSON.stringify(item.state);
  const existing = session.candidates.find(entry => JSON.stringify(entry.state) === signature);
  if (existing) return { ...session, selectedId:existing.id };
  const candidates = [...session.candidates, item].slice(-MAX_CANDIDATES);
  return { ...session, candidates, selectedId:item.id };
}

export function confirmSelection(session, confirmedAt = new Date().toISOString()) {
  const selected = session.candidates.find(item => item.id === session.selectedId);
  if (!selected) return session;
  return {
    ...session,
    stage:'download',
    final:{ ...candidate(selected.id, selected.state, selected.createdAt), confirmedAt },
    working:workshopState(selected.state),
    savedRecordId:null,
    savedAt:null,
  };
}

export function finalState(session) {
  return session.final ? workshopState({ ...session.final.state, color:'black' }) : null;
}

export function filenamePart(value) {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return cleaned || 'participant';
}
