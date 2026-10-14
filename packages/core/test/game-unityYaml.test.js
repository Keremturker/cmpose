const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    UnityYamlError, findDocument, setScalar, getScalar, setMapEntry, getMapEntry, removeMapEntry, setList
} = require('../src/game/unityYaml');

const PS = fs.readFileSync(path.join(__dirname, 'fixtures', 'game', 'ProjectSettings.asset'), 'utf8');
const PLAYER = { classId: 129, fileId: 1 };

test('findDocument bounds the PlayerSettings document', () => {
    const { start, end } = findDocument(PS, 129, 1);
    const seg = PS.slice(start, end);
    assert.ok(seg.startsWith('--- !u!129 &1'));
    assert.ok(!seg.includes('MonoBehaviour'));
    assert.throws(() => findDocument(PS, 999), UnityYamlError);
});

test('setScalar changes only the PlayerSettings key', () => {
    const out = setScalar(PS, 'companyName', 'Acme', { doc: PLAYER });
    assert.equal(getScalar(out, 'companyName', { doc: PLAYER }), 'Acme');
    assert.ok(out.includes('  companyName: NotPlayerSettings'));
    assert.equal(out.length - PS.length, 'Acme'.length - 'Kturker'.length);
});

test('setScalar throws on zero or duplicate matches', () => {
    assert.throws(() => setScalar(PS, 'noSuchKey', 'x', { doc: PLAYER }),
        (e) => e instanceof UnityYamlError && e.matches === 0);
    assert.throws(() => setScalar(PS, 'companyName', 'x'),
        (e) => e instanceof UnityYamlError && e.matches === 2);
});

test('setScalar does not touch keys that only share a prefix', () => {
    const out = setScalar(PS, 'AndroidMinSdkVersion', '26', { doc: PLAYER });
    assert.equal(getScalar(out, 'AndroidMinSdkVersion', { doc: PLAYER }), '26');
    assert.equal(getScalar(out, 'AndroidTargetSdkVersion', { doc: PLAYER }), '0');
});

test('CRLF line endings are kept by every editor', () => {
    const crlf = PS.replace(/\n/g, '\r\n');
    let out = setScalar(crlf, 'companyName', 'Acme', { doc: PLAYER });
    out = setMapEntry(out, 'applicationIdentifier', 'Android', 'dev.cmpose.x', { doc: PLAYER });
    out = setMapEntry(out, 'applicationIdentifier', 'Standalone', 'dev.cmpose.pc', { doc: PLAYER });
    out = setMapEntry(out, 'additionalCompilerArguments', 'Android', '-x', { doc: PLAYER });
    out = removeMapEntry(out, 'scriptingBackend', 'Android', { doc: PLAYER });
    out = setList(out, 'iOSURLSchemes', ['a', 'b'], { doc: PLAYER });
    assert.ok(!/[^\r]\n/.test(out), 'every newline stays CRLF');
    assert.equal(getMapEntry(out, 'applicationIdentifier', 'Android', { doc: PLAYER }), 'dev.cmpose.x');
    assert.equal(getScalar(out, 'companyName', { doc: PLAYER }), 'Acme');
});

test('setMapEntry replaces, appends, and expands an inline empty map', () => {
    let out = setMapEntry(PS, 'applicationIdentifier', 'iPhone', 'dev.cmpose.ios', { doc: PLAYER });
    assert.equal(getMapEntry(out, 'applicationIdentifier', 'iPhone', { doc: PLAYER }), 'dev.cmpose.ios');
    out = setMapEntry(out, 'applicationIdentifier', 'Standalone', 'dev.cmpose.pc', { doc: PLAYER });
    assert.match(out, /  applicationIdentifier:\n    Android: com\.kturker\.unitybase\n    iPhone: dev\.cmpose\.ios\n    Standalone: dev\.cmpose\.pc\n  iOSURLSchemes/);
    out = setMapEntry(out, 'additionalCompilerArguments', 'Android', '-warnaserror+', { doc: PLAYER });
    assert.match(out, /  additionalCompilerArguments:\n    Android: -warnaserror\+\n  scriptingBackend:/);
});

test('removeMapEntry drops an entry and collapses an emptied map to {}', () => {
    const out = removeMapEntry(PS, 'scriptingBackend', 'Android', { doc: PLAYER });
    assert.match(out, /  scriptingBackend: \{\}\n  AndroidTargetArchitectures/);
    assert.equal(getMapEntry(out, 'scriptingBackend', 'Android', { doc: PLAYER }), undefined);
    assert.equal(removeMapEntry(out, 'scriptingBackend', 'Android', { doc: PLAYER }), out);
});

test('setList writes a block list and an empty list as []', () => {
    let out = setList(PS, 'iOSURLSchemes', ['mygame'], { doc: PLAYER });
    assert.match(out, /  iOSURLSchemes:\n  - mygame\n  scriptingDefineSymbols:/);
    out = setList(out, 'iOSURLSchemes', ['a', 'b'], { doc: PLAYER });
    assert.match(out, /  iOSURLSchemes:\n  - a\n  - b\n  scriptingDefineSymbols:/);
    out = setList(out, 'iOSURLSchemes', [], { doc: PLAYER });
    assert.match(out, /  iOSURLSchemes: \[\]\n  scriptingDefineSymbols:/);
});

test('setMapEntry refuses a non-empty inline map', () => {
    const t = PS.replace('  additionalCompilerArguments: {}', '  additionalCompilerArguments: {Android: x}');
    assert.throws(() => setMapEntry(t, 'additionalCompilerArguments', 'iPhone', 'y', { doc: PLAYER }), UnityYamlError);
});
