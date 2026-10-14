const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { seedGameTemplate, SEED_GUIDS } = require('./support/seedGameTemplate');
const { applyFlags } = require('../src/game/flags');
const { applyGameIdentity } = require('../src/game/identity');
const { verifyGameProject } = require('../src/game/verifier');
const { tmpDir } = require('./support/gameFixtures');

const IDENTITY = { companyName: 'Acme', projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper', minSdk: 26, iosVersion: '16.0' };
const P = 'Assets/_Project';
const meta = (guid) => `fileFormatVersion: 2\nguid: ${guid}\n`;

async function generated(t, off = []) {
    const dir = await tmpDir(t);
    await seedGameTemplate(dir);
    await applyFlags(dir, { kind: 'blank', off });
    await applyGameIdentity(dir, IDENTITY);
    return dir;
}

test('a generated project is clean, with every flag on or with ads off', async (t) => {
    assert.deepEqual(await verifyGameProject(await generated(t)), []);
    assert.deepEqual(await verifyGameProject(await generated(t, ['ads'])), []);
});

test('the features markers stay in generated scripts without being reported', async (t) => {
    const dir = await generated(t);
    const installer = await fs.readFile(path.join(dir, `${P}/App/Game/GameInstaller.cs`), 'utf8');
    assert.match(installer, /\/\/ cmpose:features:start\n[\s\S]*\/\/ cmpose:features:end/);
    assert.deepEqual(await verifyGameProject(dir), []);
});

test('a leftover template namespace is reported', async (t) => {
    const dir = await generated(t);
    await fs.appendFile(path.join(dir, `${P}/Core/Ads/AdsConfig.cs`), '// see Kturker.UnityBase.Core.Ads\n');
    assert.deepEqual(await verifyGameProject(dir), [
        'old identity Kturker.UnityBase in Assets/_Project/Core/Ads/AdsConfig.cs',
        'old identity UnityBase in Assets/_Project/Core/Ads/AdsConfig.cs'
    ]);
});

test('the old identity is reported in README.md too, but not under .cmpose/', async (t) => {
    const dir = await generated(t);
    await fs.appendFile(path.join(dir, 'README.md'), 'Package: com.kturker.unitybase\n');
    await fs.outputFile(path.join(dir, '.cmpose/notes.txt'), 'UnityBase\n');
    assert.deepEqual(await verifyGameProject(dir), [
        'old identity com.kturker in README.md',
        'old identity unitybase in README.md'
    ]);
});

test('a leftover flag marker in a script is reported; README markers may stay', async (t) => {
    const dir = await generated(t);
    await fs.appendFile(path.join(dir, `${P}/Core/Ads/AdsConfig.cs`), '// cmpose:ads\n// /cmpose:ads\n');
    await fs.appendFile(path.join(dir, `${P}/App/Game/GameInstaller.cs`), '// cmpose:features:middle\n');
    assert.deepEqual(await verifyGameProject(dir), [
        'marker // /cmpose: in Assets/_Project/Core/Ads/AdsConfig.cs',
        'marker // cmpose: in Assets/_Project/App/Game/GameInstaller.cs',
        'marker // cmpose: in Assets/_Project/Core/Ads/AdsConfig.cs'
    ]);
});

test('a duplicated .meta guid is reported', async (t) => {
    const dir = await generated(t);
    await fs.outputFile(path.join(dir, `${P}/Core/Ads/Copy.cs`), 'namespace Acme.SkyHopper.Core.Ads { }\n');
    await fs.outputFile(path.join(dir, `${P}/Core/Ads/Copy.cs.meta`), meta(SEED_GUIDS.adsConfig));
    assert.deepEqual(await verifyGameProject(dir), [
        `duplicate-guid ${SEED_GUIDS.adsConfig}: Assets/_Project/Core/Ads/AdsConfig.cs.meta, Assets/_Project/Core/Ads/Copy.cs.meta`
    ]);
});

test('a prefab pointing at an unknown guid is reported, unless the package allowlist names it', async (t) => {
    const dir = await generated(t);
    const unknown = 'ab'.repeat(16);
    await fs.outputFile(path.join(dir, `${P}/Core/Ads/Banner.prefab`),
        `%YAML 1.1\n--- !u!114 &1\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: ${unknown}, type: 3}\n`);
    await fs.outputFile(path.join(dir, `${P}/Core/Ads/Banner.prefab.meta`), meta('ac'.repeat(16)));
    assert.deepEqual(await verifyGameProject(dir), [`dangling-guid ${unknown} in Assets/_Project/Core/Ads/Banner.prefab`]);
    await fs.outputFile(path.join(dir, '.cmpose/package-guids.txt'), `# package assets\n${unknown}\n`);
    assert.deepEqual(await verifyGameProject(dir), []);
});

test('every whole-line extension marker (name:start / name:end) stays; flag markers and other names are reported', async (t) => {
    const dir = await generated(t);
    await fs.outputFile(path.join(dir, `${P}/App/Boot/BootInstaller.cs`), [
        'namespace Acme.SkyHopper.App.Boot', '{', '    public sealed class BootInstaller', '    {', '        void Install()', '        {',
        '            // cmpose:boot-steps:start', '            // cmpose:boot-steps:end', '        }', '    }', '}', ''
    ].join('\n'));
    await fs.outputFile(path.join(dir, `${P}/App/Boot/BootInstaller.cs.meta`), meta('b8'.repeat(16)));
    await fs.outputFile(path.join(dir, `${P}/App/Boot.meta`), `fileFormatVersion: 2\nguid: ${'b9'.repeat(16)}\nfolderAsset: yes\n`);
    assert.deepEqual(await verifyGameProject(dir), []);

    await fs.appendFile(path.join(dir, `${P}/App/Boot/BootInstaller.cs`), '// cmpose:ads\n');
    await fs.appendFile(path.join(dir, `${P}/Core/Ads/AdsConfig.cs`), '// /cmpose:ads\n');
    await fs.appendFile(path.join(dir, `${P}/App/Game/GameInstaller.cs`), '    // cmpose:features:middle\n');
    assert.deepEqual(await verifyGameProject(dir), [
        'marker // /cmpose: in Assets/_Project/Core/Ads/AdsConfig.cs',
        'marker // cmpose: in Assets/_Project/App/Boot/BootInstaller.cs',
        'marker // cmpose: in Assets/_Project/App/Game/GameInstaller.cs'
    ]);
});

test('a marker in a folder whose name holds " in " is read from the right file', async (t) => {
    const dir = await generated(t);
    const folder = `${P}/Fun in Space`;
    await fs.outputFile(`${path.join(dir, folder)}.meta`, `fileFormatVersion: 2\nguid: ${'ba'.repeat(16)}\nfolderAsset: yes\n`);
    await fs.outputFile(path.join(dir, folder, 'Rocket.cs'), '// cmpose:launch:start\n// cmpose:launch:end\n');
    await fs.outputFile(path.join(dir, folder, 'Rocket.cs.meta'), meta('bb'.repeat(16)));
    assert.deepEqual(await verifyGameProject(dir), []);
    await fs.appendFile(path.join(dir, folder, 'Rocket.cs'), '// cmpose:ads\n');
    assert.deepEqual(await verifyGameProject(dir), ['marker // cmpose: in Assets/_Project/Fun in Space/Rocket.cs']);
});
