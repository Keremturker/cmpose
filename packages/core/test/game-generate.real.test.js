const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { tmpDir } = require('./support/gameFixtures');
const { validateGame } = require('../src/game/validate');
const { generateGame } = require('../src/game/generate');
const { verifyGameProject } = require('../src/game/verifier');
const { GAME_SCHEMA } = require('../src/game/contract');

// The whole pipeline against the REAL Unity template (CMP_GAME_TEMPLATE_DIR, a copy without Unity's local state).
// Skipped, not failed, when it is unset.
const REAL = process.env.CMP_GAME_TEMPLATE_DIR;
const LOCAL = new Set(['Library', 'Temp', 'Logs', 'UserSettings', 'Builds', 'obj', '.git']);

test('the real template generates blank with every flag, two modules, and verifies clean', REAL ? {} : { skip: 'CMP_GAME_TEMPLATE_DIR not set' }, async (t) => {
    const dir = await tmpDir(t);
    await fs.copy(REAL, dir, { filter: (src) => !LOCAL.has(path.relative(REAL, src).split(path.sep)[0]) });
    const r = validateGame({
        projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper',
        templateType: 'blank', flags: GAME_SCHEMA.flags.slice(), features: ['shop', 'quests']
    });
    assert.ok(r.ok, r.error);
    const result = await generateGame(r.value, {
        projectDir: dir, template: { repo: 'real', ref: 'local', commit: null }, coreVersion: 'test', now: new Date(0)
    });
    // generateGame verified the project before dropping the package guid allowlist (step 8); verify again with it put back
    const allowlist = path.join(dir, '.cmpose/package-guids.txt');
    assert.equal(await fs.pathExists(allowlist), false);
    await fs.copy(path.join(REAL, '.cmpose/package-guids.txt'), allowlist);
    assert.deepEqual(await verifyGameProject(dir), []);
    assert.deepEqual(result.features, ['shop', 'quests']);
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/_Project/Features/Shop')));
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/_Project/Features/Quests')));
    assert.ok(await fs.pathExists(path.join(dir, '.cmpose/generation.json')));
    assert.equal(await fs.pathExists(path.join(dir, '.github')), false);
});
