const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { applyIdentity, setDefines, getDefines, PLAYER } = require('../src/game/projectSettings');
const { getScalar, getMapEntry, UnityYamlError } = require('../src/game/unityYaml');

const PS = fs.readFileSync(path.join(__dirname, 'fixtures', 'game', 'ProjectSettings.asset'), 'utf8');
const ID = {
    companyName: 'Acme Games', productName: 'Sky Hopper', bundleId: 'dev.cmpose.skyhopper', version: '1.2.0',
    androidMinSdk: 25, iosTarget: '15.0', urlScheme: 'skyhopper'
};

test('applyIdentity writes every identity key of PlayerSettings and nothing else', () => {
    const out = applyIdentity(PS, ID);
    const s = (k) => getScalar(out, k, { doc: PLAYER });
    assert.equal(s('companyName'), 'Acme Games');
    assert.equal(s('productName'), 'Sky Hopper');
    assert.equal(s('bundleVersion'), '1.2.0');
    assert.equal(s('overrideDefaultApplicationIdentifier'), '1');
    assert.equal(s('AndroidMinSdkVersion'), '25');
    assert.equal(s('iOSTargetOSVersionString'), '15.0');
    assert.equal(getMapEntry(out, 'applicationIdentifier', 'Android', { doc: PLAYER }), 'dev.cmpose.skyhopper');
    assert.equal(getMapEntry(out, 'applicationIdentifier', 'iPhone', { doc: PLAYER }), 'dev.cmpose.skyhopper');
    assert.match(out, /  iOSURLSchemes:\n  - skyhopper\n/);
    assert.ok(out.includes('  companyName: NotPlayerSettings'));
    assert.ok(out.includes('    Android: CMPOSE_ADS;CMPOSE_PURCHASES'));
});

test('applyIdentity without a URL scheme leaves an empty list', () => {
    const out = applyIdentity(PS, { ...ID, urlScheme: undefined });
    assert.match(out, /  iOSURLSchemes: \[\]\n/);
});

test('applyIdentity rejects values that would break the YAML', () => {
    for (const bad of ['a\nb', ': x', 'a: b', 'a #b', "'quoted", '#x', '', ' lead', 'trail ']) {
        assert.throws(() => applyIdentity(PS, { ...ID, productName: bad }), UnityYamlError, JSON.stringify(bad));
    }
    assert.throws(() => applyIdentity(PS, { ...ID, androidMinSdk: '25' }), UnityYamlError);
});

test('setDefines sets, replaces and removes per target; getDefines reads them', () => {
    assert.deepEqual(getDefines(PS, 'Android'), ['CMPOSE_ADS', 'CMPOSE_PURCHASES']);
    let out = setDefines(PS, 'Android', ['CMPOSE_ADS']);
    assert.deepEqual(getDefines(out, 'Android'), ['CMPOSE_ADS']);
    assert.deepEqual(getDefines(out, 'iPhone'), ['CMPOSE_ADS', 'CMPOSE_PURCHASES']);
    out = setDefines(out, 'Android', []);
    out = setDefines(out, 'iPhone', []);
    assert.match(out, /  scriptingDefineSymbols: \{\}\n/);
    assert.deepEqual(getDefines(out, 'Android'), []);
    out = setDefines(out, 'iPhone', ['X']);
    assert.match(out, /  scriptingDefineSymbols:\n    iPhone: X\n  additionalCompilerArguments/);
    assert.throws(() => setDefines(PS, 'Android', ['BAD;X']), UnityYamlError);
});
