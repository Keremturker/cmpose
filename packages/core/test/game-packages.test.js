const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { removePackages, removePackagesInProject } = require('../src/game/packages');
const { tmpDir } = require('./support/gameFixtures');

const MANIFEST = {
    dependencies: {
        'com.google.ads.mobile': '11.5.0',
        'com.google.play.review': '1.8.4',
        'com.revenuecat.purchases-unity': '9.12.0',
        'jp.hadashikick.vcontainer': '1.19.0',
        'com.cysharp.unitask': '2.5.11',
        'com.unity.render-pipelines.universal': '17.3.0'
    },
    scopedRegistries: [
        { name: 'package.openupm.com', url: 'https://package.openupm.com', scopes: ['com.google.ads.mobile', 'com.revenuecat', 'jp.hadashikick', 'com.cysharp'] },
        { name: 'Game Package Registry by Google', url: 'https://unityregistry-pa.googleapis.com/', scopes: ['com.google'] }
    ]
};

test('removing ads drops its dependency and its now unused scope, keeps scopes still in use', () => {
    const before = JSON.parse(JSON.stringify(MANIFEST));
    const out = removePackages(MANIFEST, ['com.google.ads.mobile']);
    assert.deepEqual(MANIFEST, before, 'the input is not changed');
    assert.equal(out.dependencies['com.google.ads.mobile'], undefined);
    assert.deepEqual(out.scopedRegistries[0].scopes, ['com.revenuecat', 'jp.hadashikick', 'com.cysharp']);
    assert.deepEqual(out.scopedRegistries[1].scopes, ['com.google'], 'play.review still needs the Google registry');
});

test('a registry whose scopes are all unused goes, and so does an empty scopedRegistries', () => {
    const out = removePackages(MANIFEST, ['com.google.ads.mobile', 'com.google.play.review', 'com.revenuecat.purchases-unity']);
    assert.deepEqual(out.scopedRegistries.map((r) => r.name), ['package.openupm.com']);
    assert.deepEqual(out.scopedRegistries[0].scopes, ['jp.hadashikick', 'com.cysharp']);
    const bare = removePackages(MANIFEST, Object.keys(MANIFEST.dependencies).filter((k) => !k.startsWith('com.unity.')));
    assert.equal(bare.scopedRegistries, undefined);
    assert.deepEqual(Object.keys(bare.dependencies), ['com.unity.render-pipelines.universal']);
});

test('removePackagesInProject rewrites manifest.json and deletes packages-lock.json', async (t) => {
    const dir = await tmpDir(t);
    await fs.outputJson(path.join(dir, 'Packages/manifest.json'), MANIFEST);
    await fs.outputFile(path.join(dir, 'Packages/packages-lock.json'), '{}\n');
    await removePackagesInProject(dir, ['com.google.ads.mobile']);
    const text = await fs.readFile(path.join(dir, 'Packages/manifest.json'), 'utf8');
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('\n  "dependencies": {\n'));
    assert.equal(JSON.parse(text).dependencies['com.google.ads.mobile'], undefined);
    assert.equal(await fs.pathExists(path.join(dir, 'Packages/packages-lock.json')), false);
    await removePackagesInProject(dir, ['com.cysharp.unitask']);
});
