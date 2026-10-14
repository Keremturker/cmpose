const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { pruneBuildScenes, findMissingBuildScenes } = require('../src/game/buildScenes');
const { G, tmpDir } = require('./support/gameFixtures');

const settings = (...scenes) => [
    '%YAML 1.1',
    '%TAG !u! tag:unity3d.com,2011:',
    '--- !u!1045 &1',
    'EditorBuildSettings:',
    '  m_ObjectHideFlags: 0',
    '  serializedVersion: 2',
    '  m_Scenes:',
    ...scenes.flatMap(([scene, guid]) => ['  - enabled: 1', `    path: ${scene}`, `    guid: ${guid}`]),
    '  m_configObjects:',
    '    com.unity.input.settings.actions: {fileID: -944628639613478452, guid: 052faaac586de48259a63d0c4782560b, type: 3}',
    '  m_UseUCBPForAssetBundles: 0',
    ''
].join('\n');

const BOOT = ['Assets/_Project/Scenes/Boot.unity', G('b1')];
const GAME = ['Assets/_Project/Scenes/Game.unity', G('b2')];
const RUNNER = ['Assets/_Project/Features/Showcase/Runner/Runner.unity', G('b3')];

async function project(t, onDisk) {
    const dir = await tmpDir(t);
    await fs.outputFile(path.join(dir, 'ProjectSettings/EditorBuildSettings.asset'), settings(BOOT, GAME, RUNNER));
    for (const [scene] of onDisk) await fs.outputFile(path.join(dir, scene), '%YAML 1.1\n');
    return dir;
}

test('pruneBuildScenes drops the entries whose scene file is gone and keeps the rest byte for byte', async (t) => {
    const dir = await project(t, [BOOT, RUNNER]);
    assert.deepEqual(await pruneBuildScenes(dir), ['Assets/_Project/Scenes/Game.unity']);
    assert.equal(await fs.readFile(path.join(dir, 'ProjectSettings/EditorBuildSettings.asset'), 'utf8'), settings(BOOT, RUNNER));
    assert.deepEqual(await pruneBuildScenes(dir), []);
});

test('findMissingBuildScenes reports listed scenes without a file', async (t) => {
    const dir = await project(t, [BOOT]);
    assert.deepEqual(await findMissingBuildScenes(dir), [
        'build scene missing: Assets/_Project/Scenes/Game.unity',
        'build scene missing: Assets/_Project/Features/Showcase/Runner/Runner.unity'
    ]);
    await pruneBuildScenes(dir);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
});

test('a project without EditorBuildSettings.asset has nothing to prune or report', async (t) => {
    const dir = await tmpDir(t);
    assert.deepEqual(await pruneBuildScenes(dir), []);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
});
