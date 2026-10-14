const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { applyGameIdentity } = require('../src/game/identity');

const SETTINGS = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!129 &1
PlayerSettings:
  companyName: Kturker
  productName: UnityBase
  bundleVersion: 0.1.0
  overrideDefaultApplicationIdentifier: 0
  applicationIdentifier: {}
  AndroidMinSdkVersion: 25
  iOSTargetOSVersionString: 15.0
  iOSURLSchemes:
  - unitybase
`;

async function fixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gid-'));
    await fs.outputFile(path.join(dir, 'ProjectSettings/ProjectSettings.asset'), SETTINGS);
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/Log/Kturker.UnityBase.Core.Log.asmdef'),
        '{\n    "name": "Kturker.UnityBase.Core.Log",\n    "rootNamespace": "Kturker.UnityBase.Core.Log",\n    "references": ["Kturker.UnityBase.Core.Domain"]\n}\n');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/Log/Kturker.UnityBase.Core.Log.asmdef.meta'), 'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\n');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/Log/UnityLog.cs'),
        'namespace Kturker.UnityBase.Core.Log\n{\n    class UnityLog { const string Prefix = "[UnityBase] "; string s = "unitybase://game"; UnityEngine.Object o; }\n}\n');
    await fs.outputFile(path.join(dir, 'Assets/_Project/App/Panel.prefab'),
        '  m_EditorClassIdentifier: Kturker.UnityBase.App::Kturker.UnityBase.App.Panel\n');
    await fs.outputFile(path.join(dir, 'README.md'), '# UnityBase\n');
    await fs.outputFile(path.join(dir, 'Library/keep.asset'), 'Kturker.UnityBase');
    return dir;
}
const ARGS = { companyName: 'Acme', projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper', minSdk: 26, iosVersion: '16.0' };

test('renames namespaces, asmdefs, YAML type names, files and ProjectSettings', async () => {
    const dir = await fixture();
    await applyGameIdentity(dir, ARGS);
    const asmdefPath = path.join(dir, 'Assets/_Project/Core/Log/Acme.SkyHopper.Core.Log.asmdef');
    const asmdef = JSON.parse(await fs.readFile(asmdefPath, 'utf8'));
    assert.deepStrictEqual([asmdef.name, asmdef.rootNamespace, asmdef.references], ['Acme.SkyHopper.Core.Log', 'Acme.SkyHopper.Core.Log', ['Acme.SkyHopper.Core.Domain']]);
    assert.ok(await fs.pathExists(`${asmdefPath}.meta`));
    assert.ok(!(await fs.pathExists(path.join(dir, 'Assets/_Project/Core/Log/Kturker.UnityBase.Core.Log.asmdef'))));
    const cs = await fs.readFile(path.join(dir, 'Assets/_Project/Core/Log/UnityLog.cs'), 'utf8');
    assert.match(cs, /namespace Acme\.SkyHopper\.Core\.Log/);
    assert.match(cs, /"\[SkyHopper\] "/);
    assert.match(cs, /"skyhopper:\/\/game"/);
    assert.match(cs, /UnityEngine\.Object/);
    assert.match(await fs.readFile(path.join(dir, 'Assets/_Project/App/Panel.prefab'), 'utf8'), /Acme\.SkyHopper\.App::Acme\.SkyHopper\.App\.Panel/);
    assert.strictEqual(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), '# SkyHopper\n');
    assert.strictEqual(await fs.readFile(path.join(dir, 'Library/keep.asset'), 'utf8'), 'Kturker.UnityBase');
    const settings = await fs.readFile(path.join(dir, 'ProjectSettings/ProjectSettings.asset'), 'utf8');
    for (const line of ['companyName: Acme', 'productName: Sky Hopper', 'AndroidMinSdkVersion: 26', 'iOSTargetOSVersionString: 16.0', '  - skyhopper', 'Android: com.acme.skyhopper', 'iPhone: com.acme.skyhopper']) assert.ok(settings.includes(line), line);
});

test('a project named Unity keeps other Unity words', async () => {
    const dir = await fixture();
    await applyGameIdentity(dir, { ...ARGS, projectName: 'Unity' });
    const cs = await fs.readFile(path.join(dir, 'Assets/_Project/Core/Log/UnityLog.cs'), 'utf8');
    assert.match(cs, /class UnityLog/);
    assert.match(cs, /UnityEngine\.Object/);
    assert.match(cs, /namespace Acme\.Unity\.Core\.Log/);
});

test('renames folders deepest first and keeps their .meta', async () => {
    const dir = await fixture();
    await fs.outputFile(path.join(dir, 'Assets/Kturker.UnityBase.Mods/Kturker.UnityBase.Mods.Foo.cs'), 'class Foo {}\n');
    await fs.outputFile(path.join(dir, 'Assets/Kturker.UnityBase.Mods.meta'), 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    const { renamedFiles } = await applyGameIdentity(dir, ARGS);
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/Acme.SkyHopper.Mods/Acme.SkyHopper.Mods.Foo.cs')));
    assert.ok(await fs.pathExists(path.join(dir, 'Assets/Acme.SkyHopper.Mods.meta')));
    assert.ok(renamedFiles >= 4);
});

test('every applicationIdentifier entry the template has gets the package, Standalone included', async () => {
    const dir = await fixture();
    const file = path.join(dir, 'ProjectSettings/ProjectSettings.asset');
    await fs.writeFile(file, SETTINGS.replace('  applicationIdentifier: {}\n',
        '  applicationIdentifier:\n    Android: com.kturker.unitybase\n    Standalone: com.kturker.unitybase\n    iPhone: com.kturker.unitybase\n    tvOS: com.kturker.unitybase\n'));
    await applyGameIdentity(dir, ARGS);
    const settings = await fs.readFile(file, 'utf8');
    assert.match(settings, /  applicationIdentifier:\n    Android: com\.acme\.skyhopper\n    Standalone: com\.acme\.skyhopper\n    iPhone: com\.acme\.skyhopper\n    tvOS: com\.acme\.skyhopper\n/);
    assert.ok(!settings.includes('com.kturker'));
});
