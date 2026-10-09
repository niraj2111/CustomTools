import assert from 'node:assert/strict';
import { WORKSHOP, fromWorkshopSeed, resolve } from './geometry.mjs';
import {
  addCandidate, candidate, confirmSelection, createSession, filenamePart,
  finalState, hydrateSession, randomizeWorking, setControl, startJourney,
} from './workshop.mjs';

let session = createSession(12);
assert.equal(session.stage, 'home');
assert.equal(session.started, false);
session.participant = 'Niraj P12';
session = startJourney(session, 100);
assert.equal(session.stage, 'build');
assert.equal(session.started, true);
assert.equal(session.participant, 'Niraj P12');
assert.equal(session.working.growth, true);
assert.equal(resolve(session.working).vaseLines, WORKSHOP.vaseIntervals);

const current = session.working;
const incoming = fromWorkshopSeed(200);
const randomized = randomizeWorking(current, incoming, ['presence', 'curiosity']);
assert.equal(randomized.presence, current.presence, 'Locked body width survives randomise');
assert.equal(randomized.curiosity, current.curiosity, 'Locked branch spread survives randomise');
assert.ok(randomized.openness !== current.openness, 'Unlocked control changes');
assert.equal(randomized.growth, true);

const lineSetting = randomized.complexity;
session.working = setControl(randomized, 'openness', 0.82);
session.working = setControl(session.working, 'complexity', 1);
assert.equal(session.working.openness, 0.82);
assert.equal(session.working.complexity, lineSetting, 'Hidden line count stays fixed');

session = addCandidate(session, candidate('one', current, '2026-10-09T10:00:00Z'));
session = addCandidate(session, candidate('two', session.working, '2026-10-09T10:01:00Z'));
assert.equal(session.candidates.length, 2);
assert.equal(session.selectedId, 'two');
session.selectedId = 'one';
session = confirmSelection(session, '2026-10-09T10:02:00Z');
assert.equal(session.stage, 'download');
assert.equal(session.final.id, 'one');
assert.deepEqual(finalState(session), current);

assert.equal(filenamePart('Niraj P12'), 'Niraj-P12');
assert.equal(filenamePart('  participant / 07  '), 'participant-07');

const hydrated = hydrateSession(JSON.parse(JSON.stringify(session)), 9);
assert.equal(hydrated.participant, 'Niraj P12');
assert.equal(hydrated.candidates.length, 2);
assert.equal(hydrated.final.state.growth, true);

console.log('Passed: journeys, step state, parameter locks, candidate choice, fixed workshop settings, and participant filenames.');
