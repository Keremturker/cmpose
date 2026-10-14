const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { seedGameTemplate } = require('./support/seedGameTemplate');
const { cloneModules } = require('../src/game/modules');
const { applyFlags } = require('../src/game/flags');

async function project() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'gmod-')); await seedGameTemplate(d); return d; }
const read = (d, rel) => fs.readFile(path.join(d, rel), 'utf8');

test('clones Sample with new guids, renamed names, keys and string files', async () => {
    const d = await project();
    assert.deepStrictEqual(await cloneModules(d, ['shop'], { seed: 'com.acme.game' }), ['Assets/_Project/Features/Shop']);
    const inst = await read(d, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs');
    assert.match(inst, /namespace Kturker\.UnityBase\.Features\.Shop\.Installer/);
    assert.ok(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Resources/Strings/en/shop.json')));
    assert.match(await read(d, 'Assets/_Project/Features/Shop/Resources/Strings/en/shop.json'), /"shop\.greeting"/);
    const oldGuid = /guid: (\w+)/.exec(await read(d, 'Assets/_Project/Features/Sample/Installer/SampleInstaller.cs.meta'))[1];
    const newGuid = /guid: (\w+)/.exec(await read(d, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'))[1];
    assert.notStrictEqual(newGuid, oldGuid);
});

test('renames only the Sample localization keys, not C# members named sample', async () => {
    const d = await project();
    await cloneModules(d, ['shop'], { seed: 's' });
    const cs = await read(d, 'Assets/_Project/Features/Shop/Ads/ShopAdsPresenter.cs');
    assert.match(cs, /"shop\.title"/);
    assert.match(cs, /private readonly IShopView sample;/);
    assert.match(cs, / sample\.CompleteClicked \+= OnComplete;/);
    assert.ok(!cs.includes('shop.CompleteClicked'));
    assert.match(await read(d, 'Assets/_Project/Features/Shop/Ads/Bonus.prefab'), /^ {2}key: shop\.back$/m);
});

test('wires the installer, its using line and the App asmdef reference', async () => {
    const d = await project();
    await cloneModules(d, ['shop', 'quests'], { seed: 's' });
    const gi = await read(d, 'Assets/_Project/App/Game/GameInstaller.cs');
    assert.match(gi, /using Kturker\.UnityBase\.Features\.Shop\.Installer;/);
    assert.match(gi, /if \(registerViews\) new ShopInstaller\(registerViews\)\.Install\(builder\);\n\s*if \(registerViews\) new QuestsInstaller\(registerViews\)\.Install\(builder\);\n\s*\/\/ cmpose:features:end/);
    const app = JSON.parse(await read(d, 'Assets/_Project/App/Kturker.UnityBase.App.asmdef'));
    assert.ok(app.references.includes('Kturker.UnityBase.Features.Shop.Installer'));
    assert.ok(app.references.includes('Kturker.UnityBase.Features.Quests.Installer'));
});

test('clones lose the parts of turned-off flags', async () => {
    const d = await project();
    await cloneModules(d, ['shop'], { seed: 's' });
    const manifest = JSON.parse(await read(d, '.cmpose/flags.json'));
    assert.ok(manifest.flags.ads.paths.includes('Assets/_Project/Features/Shop/Ads'));
    assert.ok(manifest.flags.ads.asmdefs.includes('Kturker.UnityBase.Features.Shop.Ads'));
    assert.ok(!manifest.flags.sample.paths.some((p) => p.includes('/Shop')));
    await applyFlags(d, { kind: 'blank', off: ['ads'] });
    assert.ok(!(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Ads'))));
    assert.ok(await fs.pathExists(path.join(d, 'Assets/_Project/Features/Shop/Installer')));
});

test('same seed, same guids; missing anchors fail clearly', async () => {
    const a = await project(); const b = await project();
    await cloneModules(a, ['shop'], { seed: 'x' }); await cloneModules(b, ['shop'], { seed: 'x' });
    assert.strictEqual(await read(a, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'), await read(b, 'Assets/_Project/Features/Shop/Installer/ShopInstaller.cs.meta'));
    const c = await project();
    await fs.remove(path.join(c, 'Assets/_Project/App/Game/GameInstaller.cs'));
    await assert.rejects(cloneModules(c, ['shop'], { seed: 'x' }), /module shop: .*GameInstaller/);
});
