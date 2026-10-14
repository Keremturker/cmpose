const fs = require('fs-extra');
const os = require('os');
const path = require('path');

// A two-character hex pair repeated into a 32-character Unity guid
const G = (pair) => pair.repeat(16);

const IDS = {
    project: G('c0'), features: G('a0'), sample: G('c1'), presentation: G('a1'), view: G('a2'),
    presAsmdef: G('a3'), prefab: G('a4'), domainAsmdef: G('a5'), domain: G('a6'), scenes: G('b0'), scene: G('b1'),
    installer: G('a7'), installerCs: G('a8'), installerAsmdef: G('a9')
};

const meta = (guid, folder = false) => `fileFormatVersion: 2\nguid: ${guid}\n${folder ? 'folderAsset: yes\n' : ''}`;

// A mini Unity project: Features/Sample (Presentation + Domain asmdefs, a view script, a prefab using it)
// and a scene that places the prefab. Every asset has its .meta.
async function writeMiniProject(dir) {
    const f = (rel, content) => fs.outputFile(path.join(dir, rel), content);
    const S = 'Assets/_Project/Features/Sample';
    await f('Assets/_Project.meta', meta(IDS.project, true));
    await f('Assets/_Project/Features.meta', meta(IDS.features, true));
    await f(`${S}.meta`, meta(IDS.sample, true));
    await f(`${S}/Presentation.meta`, meta(IDS.presentation, true));
    await f(`${S}/Presentation/SampleView.cs`,
        'namespace Kturker.UnityBase.Features.Sample.Presentation\n{\n    public sealed class SampleView : UnityEngine.MonoBehaviour { }\n}\n');
    await f(`${S}/Presentation/SampleView.cs.meta`, meta(IDS.view));
    await f(`${S}/Presentation/Kturker.UnityBase.Features.Sample.Presentation.asmdef`, JSON.stringify({
        name: 'Kturker.UnityBase.Features.Sample.Presentation',
        rootNamespace: 'Kturker.UnityBase.Features.Sample.Presentation',
        references: ['Kturker.UnityBase.Features.Sample.Domain', `GUID:${IDS.domainAsmdef}`]
    }, null, 4) + '\n');
    await f(`${S}/Presentation/Kturker.UnityBase.Features.Sample.Presentation.asmdef.meta`, meta(IDS.presAsmdef));
    await f(`${S}/Presentation/SampleScreen.prefab`, [
        '%YAML 1.1', '--- !u!1 &100', 'GameObject:', '  m_Name: SampleScreen', '--- !u!114 &200', 'MonoBehaviour:',
        `  m_Script: {fileID: 11500000, guid: ${IDS.view}, type: 3}`,
        '  m_Font: {fileID: 10102, guid: 0000000000000000e000000000000000, type: 0}', ''
    ].join('\n'));
    await f(`${S}/Presentation/SampleScreen.prefab.meta`, meta(IDS.prefab));
    await f(`${S}/Domain.meta`, meta(IDS.domain, true));
    await f(`${S}/Domain/Kturker.UnityBase.Features.Sample.Domain.asmdef`, JSON.stringify({
        name: 'Kturker.UnityBase.Features.Sample.Domain', rootNamespace: 'Kturker.UnityBase.Features.Sample.Domain'
    }, null, 4) + '\n');
    await f(`${S}/Domain/Kturker.UnityBase.Features.Sample.Domain.asmdef.meta`, meta(IDS.domainAsmdef));
    await f(`${S}/Installer.meta`, meta(IDS.installer, true));
    await f(`${S}/Installer/SampleInstaller.cs`,
        'namespace Kturker.UnityBase.Features.Sample.Installer\n{\n    public sealed class SampleInstaller { }\n}\n');
    await f(`${S}/Installer/SampleInstaller.cs.meta`, meta(IDS.installerCs));
    await f(`${S}/Installer/Kturker.UnityBase.Features.Sample.Installer.asmdef`, JSON.stringify({
        name: 'Kturker.UnityBase.Features.Sample.Installer',
        rootNamespace: 'Kturker.UnityBase.Features.Sample.Installer',
        references: ['Kturker.UnityBase.Features.Sample.Presentation']
    }, null, 4) + '\n');
    await f(`${S}/Installer/Kturker.UnityBase.Features.Sample.Installer.asmdef.meta`, meta(IDS.installerAsmdef));
    await f('Assets/_Project/Scenes.meta', meta(IDS.scenes, true));
    await f('Assets/_Project/Scenes/Menu.unity', [
        '%YAML 1.1', '--- !u!1001 &1', 'PrefabInstance:',
        `  m_SourcePrefab: {fileID: 100100000, guid: ${IDS.prefab}, type: 3}`, ''
    ].join('\n'));
    await f('Assets/_Project/Scenes/Menu.unity.meta', meta(IDS.scene));
}

async function tmpDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-'));
    t.after(() => fs.remove(dir));
    return dir;
}

module.exports = { G, IDS, meta, writeMiniProject, tmpDir };
