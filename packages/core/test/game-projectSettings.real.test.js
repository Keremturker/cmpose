const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { applyIdentity, setDefines, getDefines } = require('../src/game/projectSettings');

// ProjectSettings.asset as Unity 6000.3.25f1 wrote it (Universal 3D template, GMA + EDM resolved, after a build).
// The Faz 0 spike checked that Unity reads these edits back unchanged and builds both platforms with them.
const REAL = fs.readFileSync(path.join(__dirname, 'fixtures', 'game', 'ProjectSettings.unity-6000.3.asset'), 'utf8');

function changedLines(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    const removed = a.filter((l) => !b.includes(l));
    const added = b.filter((l) => !a.includes(l));
    return { removed, added };
}

test('applyIdentity on a real Unity 6000.3 file changes only the identity lines', () => {
    const out = applyIdentity(REAL, {
        companyName: 'Acme Games', productName: 'Sky Runner', bundleId: 'com.acmegames.skyrunner',
        version: '1.2.0', androidMinSdk: 25, iosTarget: '15.0', urlScheme: 'skyrunner'
    });
    const { removed, added } = changedLines(REAL, out);
    assert.deepEqual(removed.sort(), [
        '    Android: com.UnityTechnologies.com.unity.template.urpblank',
        '    iPhone: com.Unity-Technologies.com.unity.template.urp-blank',
        '  bundleVersion: 0.1.0',
        '  companyName: DefaultCompany',
        '  iOSURLSchemes: []',
        '  productName: CmposeSpike'
    ]);
    assert.deepEqual(added.sort(), [
        '    Android: com.acmegames.skyrunner',
        '    iPhone: com.acmegames.skyrunner',
        '  - skyrunner',
        '  bundleVersion: 1.2.0',
        '  companyName: Acme Games',
        '  iOSURLSchemes:',
        '  productName: Sky Runner'
    ]);
    assert.equal(out.split('\n').length, REAL.split('\n').length + 1);
});

test('the real file carries UNITY_EDM_DISABLED; adding a define must keep it', () => {
    // Unity EDM 2.1.0 turns itself off with this define when GMA pulls in Google EDM4U; dropping it runs both resolvers
    for (const target of ['Android', 'iPhone']) {
        assert.deepEqual(getDefines(REAL, target), ['UNITY_EDM_DISABLED']);
    }
    let out = REAL;
    for (const target of ['Android', 'iPhone']) {
        const merged = [...new Set([...getDefines(out, target), 'CMPOSE_ADS'])];
        out = setDefines(out, target, merged);
    }
    assert.deepEqual(getDefines(out, 'Android'), ['UNITY_EDM_DISABLED', 'CMPOSE_ADS']);
    assert.deepEqual(getDefines(out, 'iPhone'), ['UNITY_EDM_DISABLED', 'CMPOSE_ADS']);
    assert.deepEqual(changedLines(REAL, out), {
        removed: ['    Android: UNITY_EDM_DISABLED', '    iPhone: UNITY_EDM_DISABLED'],
        added: ['    Android: UNITY_EDM_DISABLED;CMPOSE_ADS', '    iPhone: UNITY_EDM_DISABLED;CMPOSE_ADS']
    });
});
