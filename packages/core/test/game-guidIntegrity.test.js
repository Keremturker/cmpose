const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { checkGuidIntegrity, readGuidAllowlist } = require('../src/game/guidIntegrity');
const { cloneWithNewGuids } = require('../src/game/guid');
const { G, IDS, meta, writeMiniProject, tmpDir } = require('./support/gameFixtures');

const P = 'Assets/_Project/Features';

test('a clean mini project has no problems, and neither does a feature cloned with new guids', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
    await cloneWithNewGuids(path.join(dir, P, 'Sample'), path.join(dir, P, 'Shop'),
        { seed: 'dev.cmpose.game', rename: [{ from: 'Sample', to: 'Shop' }] });
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('a folder copied without new guids shows up as duplicate guids', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    await fs.copy(path.join(dir, P, 'Sample'), path.join(dir, P, 'Copy'));
    await fs.copy(path.join(dir, P, 'Sample.meta'), path.join(dir, P, 'Copy.meta'));
    const problems = await checkGuidIntegrity(dir);
    assert.ok(problems.includes(`duplicate-guid ${IDS.view}: ${P}/Copy/Presentation/SampleView.cs.meta, ${P}/Sample/Presentation/SampleView.cs.meta`), problems.join('\n'));
    assert.ok(problems.includes(`duplicate-guid ${IDS.sample}: ${P}/Copy.meta, ${P}/Sample.meta`), problems.join('\n'));
});

test('dangling references are reported unless built in or allowlisted', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    const prefab = path.join(dir, P, 'Sample/Presentation/SampleScreen.prefab');
    await fs.appendFile(prefab, `  m_A: {fileID: 1, guid: ${G('ee')}, type: 2}\n  m_B: {fileID: 1, guid: ${G('ef')}, type: 2}\n`);
    assert.deepEqual(await checkGuidIntegrity(dir, { allowlist: [G('ef')] }),
        [`dangling-guid ${G('ee')} in ${P}/Sample/Presentation/SampleScreen.prefab`]);
});

test('orphan and missing metas are reported; files Unity ignores are not', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    await fs.outputFile(path.join(dir, 'Assets/_Project/Gone.png.meta'), meta(G('9a')));
    await fs.outputFile(path.join(dir, 'Assets/_Project/New.png'), 'png');
    await fs.outputFile(path.join(dir, 'Assets/_Project/.DS_Store'), 'x');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Notes~/draft.txt'), 'x');
    await fs.outputFile(path.join(dir, 'Assets/_Project/.hidden'), 'x');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Broken.txt'), 'x');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Broken.txt.meta'), 'fileFormatVersion: 2\n');
    assert.deepEqual(await checkGuidIntegrity(dir), [
        'invalid-meta Assets/_Project/Broken.txt.meta',
        'missing-meta Assets/_Project/New.png',
        'orphan-meta Assets/_Project/Gone.png.meta'
    ]);
});

test('readGuidAllowlist reads one guid per line and skips blanks and comments', async (t) => {
    const dir = await tmpDir(t);
    const file = path.join(dir, 'package-guids.txt');
    await fs.outputFile(file, `# package guids\n${G('aa')}\n\n${G('bb')}\r\n`);
    assert.deepEqual(await readGuidAllowlist(file), [G('aa'), G('bb')]);
});

test('readGuidAllowlist returns an empty list for a missing file and rejects a bad line', async (t) => {
    const dir = await tmpDir(t);
    assert.deepEqual(await readGuidAllowlist(path.join(dir, 'missing.txt')), []);
    const bad = path.join(dir, 'bad.txt');
    await fs.outputFile(bad, `${G('aa')}\nnot-a-guid\n`);
    await assert.rejects(readGuidAllowlist(bad), /invalid guid on line 2/);
});

test('the mini project with its Installer module is consistent, and an allowlist clears package references', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    const ref = path.join(dir, 'Assets', '_Project', 'Settings.asset');
    await fs.outputFile(ref, `%YAML 1.1\n--- !u!114 &1\nMonoBehaviour:\n  m_Shader: {fileID: 4800000, guid: ${G('ee')}, type: 3}\n`);
    await fs.outputFile(`${ref}.meta`, meta(G('ef')));
    assert.deepEqual(await checkGuidIntegrity(dir), [`dangling-guid ${G('ee')} in Assets/_Project/Settings.asset`]);
    assert.deepEqual(await checkGuidIntegrity(dir, { allowlist: [G('ee')] }), []);
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/_Project/Features/Sample/Installer/SampleInstaller.cs')));
});

test('folder assets Unity imports as one plugin (.androidlib, .bundle, .framework) need only their own meta', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    const lib = path.join(dir, 'Assets/Plugins/Android/Bridge.androidlib');
    await fs.outputFile(path.join(lib, 'build.gradle'), "apply plugin: 'com.android.library'\n");
    await fs.outputFile(path.join(lib, 'src/main/java/dev/x/Bridge.java'), 'class Bridge {}\n');
    await fs.outputFile(path.join(dir, 'Assets/Plugins/iOS/Kit.framework/Headers/Kit.h'), '\n');
    await fs.outputFile(path.join(dir, 'Assets/Plugins.meta'), meta(G('d1'), true));
    await fs.outputFile(path.join(dir, 'Assets/Plugins/Android.meta'), meta(G('d2'), true));
    await fs.outputFile(path.join(dir, 'Assets/Plugins/iOS.meta'), meta(G('d3'), true));
    await fs.outputFile(`${lib}.meta`, meta(G('d4')));
    assert.deepEqual(await checkGuidIntegrity(dir), [
        'missing-meta Assets/Plugins/iOS/Kit.framework'
    ]);
    await fs.outputFile(path.join(dir, 'Assets/Plugins/iOS/Kit.framework.meta'), meta(G('d5')));
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});
