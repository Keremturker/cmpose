const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { readFlagManifest, checkRenderLayers, applyFlags, findFlagResidue, flagVariants } = require('../src/game/flags');
const { checkGuidIntegrity, readGuidAllowlist } = require('../src/game/guidIntegrity');
const { tmpDir } = require('./support/gameFixtures');
const { findMissingBuildScenes } = require('../src/game/buildScenes');

// Drives every gate variant against the REAL Unity template (CMP_GAME_TEMPLATE_DIR). Skipped, not failed, when the template predates Faz 2a (no .cmpose/flags.json).
const REAL = process.env.CMP_GAME_TEMPLATE_DIR;
const HAS_FLAGS = Boolean(REAL) && fs.existsSync(path.join(REAL, '.cmpose', 'flags.json'));
const SKIP = !REAL ? 'CMP_GAME_TEMPLATE_DIR not set' : `no .cmpose/flags.json in ${REAL}: set CMP_GAME_TEMPLATE_DIR to a Unity template from Faz 2a on`;
const LOCAL = new Set(['Library', 'Temp', 'Logs', 'UserSettings', 'Builds', 'obj', '.git']);

async function copyTemplate(t) {
    const dir = await tmpDir(t);
    await fs.copy(REAL, dir, { filter: (src) => !LOCAL.has(path.relative(REAL, src).split(path.sep)[0]) });
    return dir;
}

test('every gate variant of the real template applies without residue or dangling guids', HAS_FLAGS ? {} : { skip: SKIP }, async (t) => {
    const manifest = await readFlagManifest(REAL);
    assert.deepEqual(await checkRenderLayers(REAL, manifest), []);
    const variants = flagVariants(manifest);
    assert.ok(variants.length > 0);
    const names = variants.map((v) => v.name);
    const games = manifest.kinds.showcase ? manifest.kinds.showcase.games : {};
    for (const render of Object.keys(games)) {
        assert.ok(names.includes(`showcase-${render}`) && names.includes(`showcase-all-off-${render}`), render);
    }
    t.diagnostic(`${variants.length} variants: ${names.join(', ')}`);
    for (const variant of variants) {
        const dir = await copyTemplate(t);
        const result = await applyFlags(dir, { kind: variant.kind, off: variant.off, render: variant.render });
        const allowlist = await readGuidAllowlist(path.join(dir, '.cmpose', 'package-guids.txt'));
        assert.deepEqual(await findFlagResidue(dir, manifest, result.off), [], variant.name);
        assert.deepEqual(await checkGuidIntegrity(dir, { allowlist }), [], variant.name);
        assert.deepEqual(await findMissingBuildScenes(dir), [], variant.name);
        if (variant.kind === 'showcase') {
            for (const [render, game] of Object.entries(games)) {
                const kept = await fs.pathExists(path.join(dir, manifest.flags[game].paths[0]));
                assert.equal(kept, render === variant.render, `${variant.name}: ${game}`);
            }
        }
    }
});
