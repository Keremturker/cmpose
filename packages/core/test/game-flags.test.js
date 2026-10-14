const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const {
    parseFlagManifest, readFlagManifest, checkRenderLayers, applyFlags, findFlagResidue, flagVariants
} = require('../src/game/flags');
const { checkGuidIntegrity } = require('../src/game/guidIntegrity');
const { getDefines } = require('../src/game/projectSettings');
const { G, IDS, meta, writeMiniProject, tmpDir } = require('./support/gameFixtures');
const { findMissingBuildScenes } = require('../src/game/buildScenes');

const PS = fs.readFileSync(path.join(__dirname, 'fixtures', 'game', 'ProjectSettings.asset'), 'utf8')
    .replace(/CMPOSE_ADS;CMPOSE_PURCHASES/g, 'CMPOSE_ALPHA;CMPOSE_BETA;UNITY_EDM_DISABLED');

const FLAGS = {
    flags: {
        alpha: {
            define: 'CMPOSE_ALPHA',
            paths: ['Assets/_Project/Core/Alpha'],
            asmdefs: ['Kturker.UnityBase.Core.Alpha'],
            packages: ['com.example.shared', 'com.example.alpha']
        },
        beta: {
            define: 'CMPOSE_BETA',
            paths: ['Assets/_Project/Core/Beta', 'Assets/Plugins/iOS/Beta.mm'],
            asmdefs: ['Kturker.UnityBase.Core.Beta'],
            packages: ['com.example.shared']
        }
    },
    renders: { '3d': null, '2d': '.cmpose/layers/render-2d' }
};

const INSTALLER = [
    'using VContainer;',
    '// cmpose:alpha',
    'using Kturker.UnityBase.Core.Alpha;',
    '// /cmpose:alpha',
    '// cmpose:beta',
    'using Kturker.UnityBase.Core.Beta;',
    '// /cmpose:beta',
    '',
    'namespace Kturker.UnityBase.Core.DI',
    '{',
    '    public sealed class RootInstaller',
    '    {',
    '        public void Install()',
    '        {',
    '            // cmpose:alpha',
    '            new Alpha();',
    '            // /cmpose:alpha',
    '            // cmpose:beta',
    '            new Beta();',
    '            // /cmpose:beta',
    '        }',
    '    }',
    '}',
    ''
].join('\n');

const asmdef = (name, references = []) => `${JSON.stringify({ name, rootNamespace: name, references }, null, 4)}\n`;
const RIG = '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: GameRig\n';

// The mini project of gameFixtures plus two flags, an installer with marked blocks, packages, defines and a
// render overlay. Every asset has its .meta, so checkGuidIntegrity is clean before and after.
async function writeFlagProject(dir) {
    await writeMiniProject(dir);
    const f = (rel, content) => fs.outputFile(path.join(dir, rel), content);
    await f('.cmpose/flags.json', `${JSON.stringify(FLAGS, null, 2)}\n`);
    await f('Assets/_Project/Core.meta', meta(G('d0'), true));
    await f('Assets/_Project/Core/Alpha.meta', meta(G('d1'), true));
    await f('Assets/_Project/Core/Alpha/Alpha.cs', 'namespace Kturker.UnityBase.Core.Alpha\n{\n    public sealed class Alpha { }\n}\n');
    await f('Assets/_Project/Core/Alpha/Alpha.cs.meta', meta(G('d2')));
    await f('Assets/_Project/Core/Alpha/Kturker.UnityBase.Core.Alpha.asmdef', asmdef('Kturker.UnityBase.Core.Alpha'));
    await f('Assets/_Project/Core/Alpha/Kturker.UnityBase.Core.Alpha.asmdef.meta', meta(G('d3')));
    await f('Assets/_Project/Core/Beta.meta', meta(G('d4'), true));
    await f('Assets/_Project/Core/Beta/Beta.cs', 'namespace Kturker.UnityBase.Core.Beta\n{\n    public sealed class Beta { }\n}\n');
    await f('Assets/_Project/Core/Beta/Beta.cs.meta', meta(G('d5')));
    await f('Assets/_Project/Core/Beta/Kturker.UnityBase.Core.Beta.asmdef', asmdef('Kturker.UnityBase.Core.Beta'));
    await f('Assets/_Project/Core/Beta/Kturker.UnityBase.Core.Beta.asmdef.meta', meta(G('d6')));
    await f('Assets/Plugins.meta', meta(G('e0'), true));
    await f('Assets/Plugins/iOS.meta', meta(G('e1'), true));
    await f('Assets/Plugins/iOS/Beta.mm', 'extern "C" int CmposeBeta(void) { return 1; }\n');
    await f('Assets/Plugins/iOS/Beta.mm.meta', meta(G('e2')));
    await f('Assets/_Project/Core/DI.meta', meta(G('e3'), true));
    await f('Assets/_Project/Core/DI/RootInstaller.cs', INSTALLER);
    await f('Assets/_Project/Core/DI/RootInstaller.cs.meta', meta(G('e4')));
    await f('Assets/_Project/Core/DI/Kturker.UnityBase.Core.DI.asmdef',
        asmdef('Kturker.UnityBase.Core.DI', ['Kturker.UnityBase.Core.Alpha', 'Kturker.UnityBase.Core.Beta', 'VContainer']));
    await f('Assets/_Project/Core/DI/Kturker.UnityBase.Core.DI.asmdef.meta', meta(G('e5')));
    await f('Assets/_Project/Render.meta', meta(G('e6'), true));
    await f('Assets/_Project/Render/GameRig.prefab', `${RIG}  m_Layer: 3\n`);
    await f('Assets/_Project/Render/GameRig.prefab.meta', meta(G('e7')));
    await f('.cmpose/layers/render-2d/Assets/_Project/Render/GameRig.prefab', `${RIG}  m_Layer: 2\n`);
    await f('.cmpose/layers/render-2d/Assets/_Project/Render/GameRig.prefab.meta', meta(G('e7')));
    await f('Packages/manifest.json', `${JSON.stringify({
        dependencies: { 'com.example.shared': '1.0.0', 'com.example.alpha': '1.0.0', 'com.unity.ugui': '2.0.0' },
        scopedRegistries: [{ name: 'Example', url: 'https://example.invalid', scopes: ['com.example'] }]
    }, null, 2)}\n`);
    await f('Packages/packages-lock.json', '{}\n');
    await f('ProjectSettings/ProjectSettings.asset', PS);
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));

test('parseFlagManifest reads flags and renders and rejects unsafe or incomplete entries', () => {
    const m = parseFlagManifest(JSON.stringify(FLAGS));
    assert.deepEqual(Object.keys(m.flags), ['alpha', 'beta']);
    assert.equal(m.flags.beta.paths[1], 'Assets/Plugins/iOS/Beta.mm');
    assert.equal(m.renders['3d'], null);
    const bad = (mutate) => {
        const copy = JSON.parse(JSON.stringify(FLAGS));
        mutate(copy);
        return JSON.stringify(copy);
    };
    assert.throws(() => parseFlagManifest('{'), /flags\.json/);
    assert.throws(() => parseFlagManifest(bad((c) => { c.flags.alpha.define = 'NOT VALID'; })), /alpha needs a valid "define"/);
    assert.throws(() => parseFlagManifest(bad((c) => { c.flags.alpha.paths = ['/abs/path']; })), /relative path/);
    assert.throws(() => parseFlagManifest(bad((c) => { c.flags.alpha.paths = ['Assets/../x']; })), /relative path/);
    assert.throws(() => parseFlagManifest(bad((c) => { c.flags.alpha.asmdefs = 'x'; })), /list of names/);
    assert.throws(() => parseFlagManifest(bad((c) => { c.renders['3d'] = '.cmpose/layers/x'; })), /upstream one \(null\)/);
    assert.throws(() => parseFlagManifest(bad((c) => { delete c.renders; })), /"flags" and "renders"/);
});

test('applyFlags with one flag off removes its files, blocks, references, define and own package only', async (t) => {
    const dir = await tmpDir(t);
    await writeFlagProject(dir);
    const result = await applyFlags(dir, { off: ['alpha'] });

    assert.deepEqual(result, { off: ['alpha'], render: '3d', removedPackages: ['com.example.alpha'] });
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha.meta'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Beta/Beta.cs'), true);
    const installer = await read(dir, 'Assets/_Project/Core/DI/RootInstaller.cs');
    assert.equal(installer.includes('Alpha'), false);
    assert.equal(installer.includes('cmpose:'), false);
    assert.ok(installer.includes('using Kturker.UnityBase.Core.Beta;'));
    assert.ok(installer.includes('            new Beta();'));
    const di = JSON.parse(await read(dir, 'Assets/_Project/Core/DI/Kturker.UnityBase.Core.DI.asmdef'));
    assert.deepEqual(di.references, ['Kturker.UnityBase.Core.Beta', 'VContainer']);
    const ps = await read(dir, 'ProjectSettings/ProjectSettings.asset');
    assert.deepEqual(getDefines(ps, 'Android'), ['CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(getDefines(ps, 'iPhone'), ['CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
    const manifest = JSON.parse(await read(dir, 'Packages/manifest.json'));
    assert.deepEqual(Object.keys(manifest.dependencies), ['com.example.shared', 'com.unity.ugui']);
    assert.deepEqual(manifest.scopedRegistries[0].scopes, ['com.example']);
    assert.equal(await exists(dir, 'Packages/packages-lock.json'), false);
    assert.equal(await exists(dir, '.cmpose/flags.json'), false);
    assert.equal(await exists(dir, '.cmpose/layers'), false);
    assert.ok((await read(dir, 'Assets/_Project/Render/GameRig.prefab')).includes('m_Layer: 3'));
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('applyFlags with every flag off and the 2d render leaves a consistent project without residue', async (t) => {
    const dir = await tmpDir(t);
    await writeFlagProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { off: ['alpha', 'beta'], render: '2d' });

    assert.deepEqual(result, { off: ['alpha', 'beta'], render: '2d', removedPackages: ['com.example.shared', 'com.example.alpha'] });
    assert.equal(await exists(dir, 'Assets/Plugins/iOS/Beta.mm'), false);
    assert.equal(await exists(dir, 'Assets/Plugins/iOS/Beta.mm.meta'), false);
    const packages = JSON.parse(await read(dir, 'Packages/manifest.json'));
    assert.deepEqual(Object.keys(packages.dependencies), ['com.unity.ugui']);
    assert.equal('scopedRegistries' in packages, false);
    const ps = await read(dir, 'ProjectSettings/ProjectSettings.asset');
    assert.deepEqual(getDefines(ps, 'Android'), ['UNITY_EDM_DISABLED']);
    assert.ok((await read(dir, 'Assets/_Project/Render/GameRig.prefab')).includes('m_Layer: 2'));
    assert.equal(await read(dir, 'Assets/_Project/Render/GameRig.prefab.meta'), meta(G('e7')));
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('applyFlags with nothing off strips every marker and keeps all files and defines', async (t) => {
    const dir = await tmpDir(t);
    await writeFlagProject(dir);
    const result = await applyFlags(dir);

    assert.deepEqual(result, { off: [], render: '3d', removedPackages: [] });
    const installer = await read(dir, 'Assets/_Project/Core/DI/RootInstaller.cs');
    assert.equal(installer.includes('cmpose:'), false);
    assert.ok(installer.includes('new Alpha();') && installer.includes('new Beta();'));
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
    assert.equal(await exists(dir, 'Packages/packages-lock.json'), true);
});

test('applyFlags refuses unknown flags and renders, missing paths, unbalanced markers and missing defines', async (t) => {
    const fresh = async () => {
        const dir = await tmpDir(t);
        await writeFlagProject(dir);
        return dir;
    };
    await assert.rejects(applyFlags(await fresh(), { off: ['gamma'] }), /unknown flag: gamma/);
    await assert.rejects(applyFlags(await fresh(), { render: '4d' }), /unknown render: 4d/);

    let dir = await fresh();
    await fs.remove(path.join(dir, 'Assets/Plugins/iOS/Beta.mm'));
    await assert.rejects(applyFlags(dir, { off: ['beta'] }), /beta: path not found: Assets\/Plugins\/iOS\/Beta\.mm/);

    dir = await fresh();
    const file = path.join(dir, 'Assets/_Project/Core/DI/RootInstaller.cs');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('            // /cmpose:alpha\n', ''));
    await assert.rejects(applyFlags(dir, { off: ['alpha'] }), /Assets\/_Project\/Core\/DI\/RootInstaller\.cs: cmpose:alpha/);

    dir = await fresh();
    const settings = path.join(dir, 'ProjectSettings/ProjectSettings.asset');
    await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace('    iPhone: CMPOSE_ALPHA;', '    iPhone: '));
    await assert.rejects(applyFlags(dir, { off: ['alpha'] }), /alpha: define CMPOSE_ALPHA missing for iPhone/);
});

test('checkRenderLayers reports an overlay whose guid or target differs, and applyFlags refuses it', async (t) => {
    const dir = await tmpDir(t);
    await writeFlagProject(dir);
    const manifest = await readFlagManifest(dir);
    assert.deepEqual(await checkRenderLayers(dir, manifest), []);

    const layer = path.join(dir, '.cmpose/layers/render-2d');
    await fs.outputFile(path.join(layer, 'Assets/_Project/Render/GameRig.prefab.meta'), meta(G('f9')));
    await fs.outputFile(path.join(layer, 'Assets/Settings/Extra.asset'), 'x\n');
    assert.deepEqual(await checkRenderLayers(dir, manifest), [
        'render 2d: Assets/Settings/Extra.asset has no .meta',
        'render 2d: Assets/Settings/Extra.asset replaces nothing',
        `render 2d: Assets/_Project/Render/GameRig.prefab.meta guid ${G('f9')} differs from the project's ${G('e7')}`
    ]);
    await assert.rejects(applyFlags(dir, { render: '2d' }), /render layers: /);
});

test('findFlagResidue reports a namespace left outside the markers', async (t) => {
    const dir = await tmpDir(t);
    await writeFlagProject(dir);
    const manifest = await readFlagManifest(dir);
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/DI/Extra.cs'), 'using Kturker.UnityBase.Core.Alpha;\n');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/DI/Extra.cs.meta'), meta(G('f1')));
    const result = await applyFlags(dir, { off: ['alpha'] });
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off),
        ['flag alpha: Kturker.UnityBase.Core.Alpha in Assets/_Project/Core/DI/Extra.cs']);
});

test('flagVariants lists one variant per flag, per overlay render and all flags off', () => {
    assert.deepEqual(flagVariants(parseFlagManifest(JSON.stringify(FLAGS))), [
        { name: 'no-alpha', off: ['alpha'], render: undefined, kind: 'blank' },
        { name: 'no-beta', off: ['beta'], render: undefined, kind: 'blank' },
        { name: 'render-2d', off: [], render: '2d', kind: 'blank' },
        { name: 'all-off-2d', off: ['alpha', 'beta'], render: '2d', kind: 'blank' }
    ]);
    assert.deepEqual(flagVariants({ flags: {}, renders: { '3d': null }, kinds: { blank: { off: [], games: {} } } }), []);
});

// writeFlagProject plus a third flag 'gamma' that requires 'alpha' and owns a file inside alpha's folder
async function writeRequiresProject(dir) {
    await writeFlagProject(dir);
    const flags = JSON.parse(JSON.stringify(FLAGS));
    flags.flags.gamma = {
        define: 'CMPOSE_GAMMA',
        paths: ['Assets/_Project/Core/Alpha/Gamma.cs'],
        asmdefs: [],
        packages: [],
        requires: ['alpha']
    };
    await fs.outputFile(path.join(dir, '.cmpose/flags.json'), `${JSON.stringify(flags, null, 2)}\n`);
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/Alpha/Gamma.cs'),
        'namespace Kturker.UnityBase.Core.Alpha\n{\n    public sealed class Gamma { }\n}\n');
    await fs.outputFile(path.join(dir, 'Assets/_Project/Core/Alpha/Gamma.cs.meta'), meta(G('d7')));
    const settings = path.join(dir, 'ProjectSettings/ProjectSettings.asset');
    await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace(/CMPOSE_BETA;/g, 'CMPOSE_BETA;CMPOSE_GAMMA;'));
}

test('parseFlagManifest reads requires and rejects an unknown or malformed one', () => {
    const copy = JSON.parse(JSON.stringify(FLAGS));
    copy.flags.beta.requires = ['alpha'];
    const m = parseFlagManifest(JSON.stringify(copy));
    assert.deepEqual(m.flags.beta.requires, ['alpha']);
    assert.deepEqual(m.flags.alpha.requires, []);
    copy.flags.beta.requires = ['delta'];
    assert.throws(() => parseFlagManifest(JSON.stringify(copy)), /flag beta requires unknown flag delta/);
    copy.flags.beta.requires = 'alpha';
    assert.throws(() => parseFlagManifest(JSON.stringify(copy)), /flag beta requires must be a list of names/);
});

test('applyFlags turns off the flags that require a turned-off flag', async (t) => {
    const dir = await tmpDir(t);
    await writeRequiresProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { off: ['alpha'] });

    assert.deepEqual(result.off, ['alpha', 'gamma']);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha'), false);
    const ps = await read(dir, 'ProjectSettings/ProjectSettings.asset');
    assert.deepEqual(getDefines(ps, 'Android'), ['CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(getDefines(ps, 'iPhone'), ['CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('a nested path of a turned-off flag inside another\'s folder is not an error, in either order', async (t) => {
    for (const off of [['alpha', 'gamma'], ['gamma', 'alpha']]) {
        const dir = await tmpDir(t);
        await writeRequiresProject(dir);
        const result = await applyFlags(dir, { off });
        assert.deepEqual([...result.off].sort(), ['alpha', 'gamma'], off.join(','));
        assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha'), false, off.join(','));
    }
    const dir = await tmpDir(t);
    await writeRequiresProject(dir);
    const kept = await applyFlags(dir, { off: ['gamma'] });
    assert.deepEqual(kept.off, ['gamma']);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha/Gamma.cs'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha/Gamma.cs.meta'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha/Alpha.cs'), true);
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'UNITY_EDM_DISABLED']);
});

test('a path that is really missing still fails before anything is removed', async (t) => {
    const dir = await tmpDir(t);
    await writeRequiresProject(dir);
    await fs.remove(path.join(dir, 'Assets/Plugins/iOS/Beta.mm'));
    await assert.rejects(applyFlags(dir, { off: ['alpha', 'beta'] }), /beta: path not found: Assets\/Plugins\/iOS\/Beta\.mm/);
    assert.equal(await exists(dir, 'Assets/_Project/Core/Alpha/Alpha.cs'), true);
});

// writeFlagProject plus the 2f kinds: internal flags 'sample' (Features/Sample and the Menu scene), 'showcase'
// (Features/Showcase) and 'runner' (requires showcase; its scene inside Features/Showcase/Runner), the kinds
// blank and showcase (game 'runner' for the 2d render) and an EditorBuildSettings.asset listing both scenes
const RUNNER_SCENE = 'Assets/_Project/Features/Showcase/Runner/Runner.unity';

async function writeKindsProject(dir) {
    await writeFlagProject(dir);
    const f = (rel, content) => fs.outputFile(path.join(dir, rel), content);
    const flags = JSON.parse(JSON.stringify(FLAGS));
    flags.flags.sample = {
        define: 'CMPOSE_SAMPLE',
        paths: ['Assets/_Project/Features/Sample', 'Assets/_Project/Scenes/Menu.unity'],
        asmdefs: ['Kturker.UnityBase.Features.Sample.Presentation', 'Kturker.UnityBase.Features.Sample.Domain',
            'Kturker.UnityBase.Features.Sample.Installer'],
        internal: true
    };
    flags.flags.showcase = {
        define: 'CMPOSE_SHOWCASE',
        paths: ['Assets/_Project/Features/Showcase'],
        asmdefs: ['Kturker.UnityBase.Features.Showcase'],
        internal: true
    };
    flags.flags.runner = {
        define: 'CMPOSE_RUNNER',
        paths: ['Assets/_Project/Features/Showcase/Runner'],
        asmdefs: ['Kturker.UnityBase.Features.Showcase.Runner'],
        requires: ['showcase'],
        internal: true
    };
    flags.kinds = { blank: { off: ['showcase'] }, showcase: { off: ['sample'], games: { '2d': 'runner' } } };
    await f('.cmpose/flags.json', `${JSON.stringify(flags, null, 2)}\n`);
    await f('Assets/_Project/Features/Showcase.meta', meta(G('f2'), true));
    await f('Assets/_Project/Features/Showcase/Showcase.cs',
        'namespace Kturker.UnityBase.Features.Showcase\n{\n    public sealed class Showcase { }\n}\n');
    await f('Assets/_Project/Features/Showcase/Showcase.cs.meta', meta(G('f3')));
    await f('Assets/_Project/Features/Showcase/Kturker.UnityBase.Features.Showcase.asmdef', asmdef('Kturker.UnityBase.Features.Showcase'));
    await f('Assets/_Project/Features/Showcase/Kturker.UnityBase.Features.Showcase.asmdef.meta', meta(G('f4')));
    await f('Assets/_Project/Features/Showcase/Runner.meta', meta(G('f5'), true));
    await f('Assets/_Project/Features/Showcase/Runner/Runner.cs',
        'namespace Kturker.UnityBase.Features.Showcase.Runner\n{\n    public sealed class Runner { }\n}\n');
    await f('Assets/_Project/Features/Showcase/Runner/Runner.cs.meta', meta(G('f6')));
    await f('Assets/_Project/Features/Showcase/Runner/Kturker.UnityBase.Features.Showcase.Runner.asmdef',
        asmdef('Kturker.UnityBase.Features.Showcase.Runner', ['Kturker.UnityBase.Features.Showcase']));
    await f('Assets/_Project/Features/Showcase/Runner/Kturker.UnityBase.Features.Showcase.Runner.asmdef.meta', meta(G('f7')));
    await f(RUNNER_SCENE, '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Runner\n');
    await f(`${RUNNER_SCENE}.meta`, meta(G('f8')));
    // The installer composes both kinds, nested inside the flags' own blocks
    await f('Assets/_Project/Core/DI/Kinds.cs', [
        'namespace Kturker.UnityBase.Core.DI',
        '{',
        '    public static class Kinds',
        '    {',
        '        public static string[] Games() => new[]',
        '        {',
        '            // cmpose:sample',
        '            "sample",',
        '            // cmpose:alpha',
        '            "sample-alpha",',
        '            // /cmpose:alpha',
        '            // /cmpose:sample',
        '            // cmpose:runner',
        '            "runner",',
        '            // /cmpose:runner',
        '        };',
        '    }',
        '}',
        ''
    ].join('\n'));
    await f('Assets/_Project/Core/DI/Kinds.cs.meta', meta(G('f9')));
    await f('ProjectSettings/EditorBuildSettings.asset', [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:', '--- !u!1045 &1', 'EditorBuildSettings:', '  m_Scenes:',
        '  - enabled: 1', '    path: Assets/_Project/Scenes/Menu.unity', `    guid: ${IDS.scene}`,
        '  - enabled: 1', `    path: ${RUNNER_SCENE}`, `    guid: ${G('f8')}`,
        '  m_configObjects: {}', ''
    ].join('\n'));
    const settings = path.join(dir, 'ProjectSettings/ProjectSettings.asset');
    await fs.writeFile(settings, (await fs.readFile(settings, 'utf8'))
        .replace(/CMPOSE_BETA;/g, 'CMPOSE_BETA;CMPOSE_SAMPLE;CMPOSE_SHOWCASE;CMPOSE_RUNNER;'));
}

const buildScenes = async (dir) => [...(await read(dir, 'ProjectSettings/EditorBuildSettings.asset')).matchAll(/path: (.*)/g)]
    .map((m) => m[1]);

// writeKindsProject plus a second game: internal flag 'track' (requires showcase; its scene inside
// Features/Showcase/Track) as the showcase kind's 3d game, with its own block in Kinds.cs and its scene listed
const TRACK_SCENE = 'Assets/_Project/Features/Showcase/Track/Track.unity';

async function writeTwoGamesProject(dir) {
    await writeKindsProject(dir);
    const f = (rel, content) => fs.outputFile(path.join(dir, rel), content);
    const flags = JSON.parse(await read(dir, '.cmpose/flags.json'));
    flags.flags.track = {
        define: 'CMPOSE_TRACK',
        paths: ['Assets/_Project/Features/Showcase/Track'],
        asmdefs: ['Kturker.UnityBase.Features.Showcase.Track'],
        requires: ['showcase'],
        internal: true
    };
    flags.kinds.showcase.games = { '2d': 'runner', '3d': 'track' };
    await f('.cmpose/flags.json', `${JSON.stringify(flags, null, 2)}\n`);
    await f('Assets/_Project/Features/Showcase/Track.meta', meta(G('fb'), true));
    await f('Assets/_Project/Features/Showcase/Track/Track.cs',
        'namespace Kturker.UnityBase.Features.Showcase.Track\n{\n    public sealed class Track { }\n}\n');
    await f('Assets/_Project/Features/Showcase/Track/Track.cs.meta', meta(G('fc')));
    await f('Assets/_Project/Features/Showcase/Track/Kturker.UnityBase.Features.Showcase.Track.asmdef',
        asmdef('Kturker.UnityBase.Features.Showcase.Track', ['Kturker.UnityBase.Features.Showcase']));
    await f('Assets/_Project/Features/Showcase/Track/Kturker.UnityBase.Features.Showcase.Track.asmdef.meta', meta(G('fd')));
    await f(TRACK_SCENE, '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Track\n');
    await f(`${TRACK_SCENE}.meta`, meta(G('fe')));
    const kinds = path.join(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    await fs.writeFile(kinds, (await fs.readFile(kinds, 'utf8')).replace('            // /cmpose:runner\n',
        '            // /cmpose:runner\n            // cmpose:track\n            "track",\n            // /cmpose:track\n'));
    const scenes = path.join(dir, 'ProjectSettings/EditorBuildSettings.asset');
    await fs.writeFile(scenes, (await fs.readFile(scenes, 'utf8')).replace('  m_configObjects',
        `  - enabled: 1\n    path: ${TRACK_SCENE}\n    guid: ${G('fe')}\n  m_configObjects`));
    const settings = path.join(dir, 'ProjectSettings/ProjectSettings.asset');
    await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace(/CMPOSE_RUNNER;/g, 'CMPOSE_RUNNER;CMPOSE_TRACK;'));
}

test('parseFlagManifest reads internal flags and kinds and rejects malformed ones', () => {
    const base = () => {
        const copy = JSON.parse(JSON.stringify(FLAGS));
        copy.flags.sample = { define: 'CMPOSE_SAMPLE', paths: ['Assets/_Project/Features/Sample'], internal: true };
        copy.flags.game = { define: 'CMPOSE_GAME', paths: ['Assets/_Project/Features/Game'], internal: true };
        copy.kinds = { blank: { off: ['game'] }, showcase: { off: ['sample'], games: { '2d': 'game' } } };
        return copy;
    };
    const m = parseFlagManifest(JSON.stringify(base()));
    assert.equal(m.flags.sample.internal, true);
    assert.equal(m.flags.alpha.internal, false);
    assert.deepEqual(m.kinds, { blank: { off: ['game'], games: {} }, showcase: { off: ['sample'], games: { '2d': 'game' } } });
    assert.deepEqual(parseFlagManifest(JSON.stringify(FLAGS)).kinds, { blank: { off: [], games: {} } });
    const bad = (mutate) => {
        const copy = base();
        mutate(copy);
        return () => parseFlagManifest(JSON.stringify(copy));
    };
    assert.throws(bad((c) => { c.flags.alpha.internal = 'yes'; }), /flag alpha "internal" must be true or false/);
    assert.throws(bad((c) => { delete c.kinds.blank; }), /"kinds" needs a "blank" kind/);
    assert.throws(bad((c) => { c.kinds.Show = { off: [] }; }), /'Show' is not a valid kind name/);
    assert.throws(bad((c) => { c.kinds.blank.off = ['delta']; }), /kind blank turns off unknown flag delta/);
    assert.throws(bad((c) => { c.kinds.blank.off = ['alpha']; }), /kind blank turns off alpha, which is not internal/);
    assert.throws(bad((c) => { c.kinds.showcase.games = { '4d': 'game' }; }), /kind showcase has a game for unknown render 4d/);
    assert.throws(bad((c) => { c.kinds.showcase.games = { '2d': 'alpha' }; }), /kind showcase game alpha must be an internal flag/);
});

test('the blank kind turns off the showcase and its game, drops its scene and leaves no residue', async (t) => {
    const dir = await tmpDir(t);
    await writeKindsProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { kind: 'blank' });

    assert.deepEqual(result.off, ['showcase', 'runner']);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase.meta'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Sample/Presentation/SampleView.cs'), true);
    assert.deepEqual(await buildScenes(dir), ['Assets/_Project/Scenes/Menu.unity']);
    const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    assert.ok(kinds.includes('"sample-alpha"') && !kinds.includes('"runner"') && !kinds.includes('cmpose:'));
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'CMPOSE_SAMPLE', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('the showcase kind turns off the sample, keeps the render\'s game and nested blocks of other flags', async (t) => {
    for (const off of [[], ['alpha']]) {
        const dir = await tmpDir(t);
        await writeKindsProject(dir);
        const manifest = await readFlagManifest(dir);
        const result = await applyFlags(dir, { kind: 'showcase', render: '2d', off });

        assert.deepEqual(result.off, [...off, 'sample'], off.join(','));
        assert.equal(await exists(dir, 'Assets/_Project/Features/Sample'), false);
        assert.equal(await exists(dir, 'Assets/_Project/Scenes/Menu.unity'), false);
        assert.equal(await exists(dir, RUNNER_SCENE), true);
        assert.deepEqual(await buildScenes(dir), [RUNNER_SCENE]);
        const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
        assert.ok(!kinds.includes('"sample') && kinds.includes('"runner"') && !kinds.includes('cmpose:'), off.join(','));
        assert.deepEqual(await findFlagResidue(dir, manifest, result.off), [], off.join(','));
        assert.deepEqual(await findMissingBuildScenes(dir), []);
        assert.deepEqual(await checkGuidIntegrity(dir), [], off.join(','));
    }
});

test('kinds refuse internal flags in off, unknown kinds and a render without a game', async (t) => {
    const fresh = async () => {
        const dir = await tmpDir(t);
        await writeKindsProject(dir);
        return dir;
    };
    await assert.rejects(applyFlags(await fresh(), { off: ['sample'] }), /flag sample is internal: pick a kind instead/);
    await assert.rejects(applyFlags(await fresh(), { kind: 'arcade' }), /unknown kind: arcade/);
    await assert.rejects(applyFlags(await fresh(), { kind: 'showcase' }), /showcase has no game for render 3d/);
    const plain = await tmpDir(t);
    await writeFlagProject(plain);
    await assert.rejects(applyFlags(plain, { kind: 'showcase', render: '2d' }), /unknown kind: showcase/);
});

test('flagVariants skips internal flags and adds a full and an all-off showcase variant per game render', async (t) => {
    const dir = await tmpDir(t);
    await writeKindsProject(dir);
    assert.deepEqual(flagVariants(await readFlagManifest(dir)), [
        { name: 'no-alpha', off: ['alpha'], render: undefined, kind: 'blank' },
        { name: 'no-beta', off: ['beta'], render: undefined, kind: 'blank' },
        { name: 'render-2d', off: [], render: '2d', kind: 'blank' },
        { name: 'all-off-2d', off: ['alpha', 'beta'], render: '2d', kind: 'blank' },
        { name: 'showcase-2d', off: [], render: '2d', kind: 'showcase' },
        { name: 'showcase-all-off-2d', off: ['alpha', 'beta'], render: '2d', kind: 'showcase' }
    ]);
});

test('a flag block nested in a kind block goes when the inner flag is off and the outer one stays', async (t) => {
    const dir = await tmpDir(t);
    await writeKindsProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { kind: 'blank', off: ['alpha'] });
    assert.deepEqual(result.off, ['alpha', 'showcase', 'runner']);
    const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    assert.ok(kinds.includes('"sample",') && !kinds.includes('"sample-alpha"') && !kinds.includes('cmpose:'));
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
});

test('with two games, the showcase kind on the upstream render keeps the track and drops the sample and the runner', async (t) => {
    const dir = await tmpDir(t);
    await writeTwoGamesProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { kind: 'showcase' });

    assert.deepEqual(result.off, ['sample', 'runner']);
    assert.equal(result.render, '3d');
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase/Track/Track.cs'), true);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase/Runner'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase/Runner.meta'), false);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Sample'), false);
    assert.deepEqual(await buildScenes(dir), [TRACK_SCENE]);
    const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    assert.ok(kinds.includes('"track"') && !kinds.includes('"runner"') && !kinds.includes('"sample') && !kinds.includes('cmpose:'));
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'CMPOSE_SHOWCASE', 'CMPOSE_TRACK', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('with two games, the showcase kind on the 2d render keeps the runner and drops the track', async (t) => {
    const dir = await tmpDir(t);
    await writeTwoGamesProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { kind: 'showcase', render: '2d' });

    assert.deepEqual(result.off, ['sample', 'track']);
    assert.equal(await exists(dir, RUNNER_SCENE), true);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase/Track'), false);
    assert.deepEqual(await buildScenes(dir), [RUNNER_SCENE]);
    const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    assert.ok(kinds.includes('"runner"') && !kinds.includes('"track"') && !kinds.includes('cmpose:'));
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'CMPOSE_SHOWCASE', 'CMPOSE_RUNNER', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('with two games, the blank kind drops the showcase and both games', async (t) => {
    const dir = await tmpDir(t);
    await writeTwoGamesProject(dir);
    const manifest = await readFlagManifest(dir);
    const result = await applyFlags(dir, { kind: 'blank' });

    assert.deepEqual(result.off, ['showcase', 'runner', 'track']);
    assert.equal(await exists(dir, 'Assets/_Project/Features/Showcase'), false);
    assert.deepEqual(await buildScenes(dir), ['Assets/_Project/Scenes/Menu.unity']);
    const kinds = await read(dir, 'Assets/_Project/Core/DI/Kinds.cs');
    assert.ok(kinds.includes('"sample",') && !kinds.includes('"runner"') && !kinds.includes('"track"') && !kinds.includes('cmpose:'));
    assert.deepEqual(getDefines(await read(dir, 'ProjectSettings/ProjectSettings.asset'), 'Android'),
        ['CMPOSE_ALPHA', 'CMPOSE_BETA', 'CMPOSE_SAMPLE', 'UNITY_EDM_DISABLED']);
    assert.deepEqual(await findFlagResidue(dir, manifest, result.off), []);
    assert.deepEqual(await findMissingBuildScenes(dir), []);
    assert.deepEqual(await checkGuidIntegrity(dir), []);
});

test('flagVariants with two games adds a full and an all-off showcase variant for each render', async (t) => {
    const dir = await tmpDir(t);
    await writeTwoGamesProject(dir);
    assert.deepEqual(flagVariants(await readFlagManifest(dir)), [
        { name: 'no-alpha', off: ['alpha'], render: undefined, kind: 'blank' },
        { name: 'no-beta', off: ['beta'], render: undefined, kind: 'blank' },
        { name: 'render-2d', off: [], render: '2d', kind: 'blank' },
        { name: 'all-off-2d', off: ['alpha', 'beta'], render: '2d', kind: 'blank' },
        { name: 'showcase-2d', off: [], render: '2d', kind: 'showcase' },
        { name: 'showcase-all-off-2d', off: ['alpha', 'beta'], render: '2d', kind: 'showcase' },
        { name: 'showcase-3d', off: [], render: '3d', kind: 'showcase' },
        { name: 'showcase-all-off-3d', off: ['alpha', 'beta'], render: '3d', kind: 'showcase' }
    ]);
});
