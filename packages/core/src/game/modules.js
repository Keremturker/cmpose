const path = require('path');
const fs = require('fs-extra');
const { cloneWithNewGuids } = require('./guid');
const { MANIFEST } = require('./flags');

// cmpose.dev/game blank modules: each one is a copy of Features/Sample with fresh guids and the Sample names
// renamed, registered in the Game scope (one guarded installer line inside the cmpose:features markers, its using
// line, the App asmdef reference). A copy carries the Sample's flag parts (Sample/Ads …), so the flag manifest gets
// their twins and turning a flag off removes them from every copy. Only files are edited; Unity never runs here.
const FEATURES = 'Assets/_Project/Features';
const SAMPLE_DIR = `${FEATURES}/Sample`;
const GAME_DIR = 'Assets/_Project/App/Game';
const GAME_INSTALLER = `${GAME_DIR}/GameInstaller.cs`;
const SAMPLE_ASSEMBLY = 'Kturker.UnityBase.Features.Sample.';
const SAMPLE_INSTALLER_ASSEMBLY = `${SAMPLE_ASSEMBLY}Installer`;
const SAMPLE_USING = `using ${SAMPLE_INSTALLER_ASSEMBLY};`;
const FEATURES_START = '// cmpose:features:start';
const FEATURES_END = '// cmpose:features:end';
const SAMPLE_INSTALLER_LINE = 'new SampleInstaller(';
const MODULE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// The asmdef nearest to dir, walking up to (not past) Assets
async function owningAsmdef(projectDir, rel) {
    for (let dir = rel; dir && dir !== '.' && dir !== 'Assets'; dir = path.posix.dirname(dir)) {
        const abs = path.join(projectDir, dir);
        if (!(await fs.pathExists(abs))) continue;
        const found = (await fs.readdir(abs)).filter((n) => n.endsWith('.asmdef')).sort();
        if (found.length) return `${dir}/${found[0]}`;
    }
    return null;
}

// Reads every file the wiring edits and checks its anchors before anything is written
async function readAnchors(projectDir, fail) {
    if (!(await fs.pathExists(path.join(projectDir, SAMPLE_DIR)))) throw fail(SAMPLE_DIR);
    const manifestFile = path.join(projectDir, MANIFEST);
    if (!(await fs.pathExists(manifestFile))) throw fail(MANIFEST);
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    if (!manifest || typeof manifest.flags !== 'object') throw fail(`${MANIFEST} "flags"`);

    const installerFile = path.join(projectDir, GAME_INSTALLER);
    if (!(await fs.pathExists(installerFile))) throw fail(GAME_INSTALLER);
    const installer = await fs.readFile(installerFile, 'utf8');
    const eol = installer.includes('\r\n') ? '\r\n' : '\n';
    const lines = installer.split(eol);
    const start = lines.findIndex((l) => l.trim() === FEATURES_START);
    const end = lines.findIndex((l) => l.trim() === FEATURES_END);
    if (start < 0 || end < start) throw fail(`${FEATURES_START} … ${FEATURES_END} in ${GAME_INSTALLER}`);
    const sampleLine = lines.slice(start + 1, end).find((l) => l.includes(SAMPLE_INSTALLER_LINE));
    if (!sampleLine) throw fail(`the SampleInstaller line in ${GAME_INSTALLER}`);
    const usingAt = lines.findIndex((l) => l.trim() === SAMPLE_USING);
    if (usingAt < 0) throw fail(`'${SAMPLE_USING}' in ${GAME_INSTALLER}`);

    const asmdefRel = await owningAsmdef(projectDir, GAME_DIR);
    if (!asmdefRel) throw fail(`the asmdef owning ${GAME_INSTALLER}`);
    const asmdef = JSON.parse(await fs.readFile(path.join(projectDir, asmdefRel), 'utf8'));
    const refAt = Array.isArray(asmdef.references) ? asmdef.references.indexOf(SAMPLE_INSTALLER_ASSEMBLY) : -1;
    if (refAt < 0) throw fail(`the ${SAMPLE_INSTALLER_ASSEMBLY} reference in ${asmdefRel}`);

    return {
        manifest, manifestFile, installerFile, lines, eol, end, usingAt,
        indent: /^\s*/.exec(sampleLine)[0], asmdefRel, asmdef, refAt
    };
}

// Every Sample part a flag (other than sample itself) removes gets the copy's twin
function addFlagTwins(manifest, names) {
    for (const [flagName, flag] of Object.entries(manifest.flags)) {
        if (flagName === 'sample' || !flag || typeof flag !== 'object') continue;
        for (const name of names) {
            const p = pascal(name);
            if (Array.isArray(flag.paths)) {
                const twins = flag.paths.filter((x) => x.startsWith(`${SAMPLE_DIR}/`))
                    .map((x) => `${FEATURES}/${p}/${x.slice(SAMPLE_DIR.length + 1)}`);
                flag.paths.push(...twins.filter((t) => !flag.paths.includes(t)));
            }
            if (Array.isArray(flag.asmdefs)) {
                const twins = flag.asmdefs.filter((x) => x.startsWith(SAMPLE_ASSEMBLY))
                    .map((x) => `Kturker.UnityBase.Features.${p}.${x.slice(SAMPLE_ASSEMBLY.length)}`);
                flag.asmdefs.push(...twins.filter((t) => !flag.asmdefs.includes(t)));
            }
        }
    }
}

async function cloneModules(projectDir, features, { seed }) {
    const names = [...features];
    if (!names.length) return [];
    for (const name of names) {
        if (typeof name !== 'string' || !MODULE_NAME.test(name)) throw new Error(`module ${name}: not a valid module name`);
        if (pascal(name) === 'Sample') throw new Error(`module ${name}: clashes with the template's Sample`);
        if (await fs.pathExists(path.join(projectDir, FEATURES, pascal(name)))) {
            throw new Error(`module ${name}: ${FEATURES}/${pascal(name)} already exists`);
        }
    }
    let anchors;
    try {
        anchors = await readAnchors(projectDir, (what) => new Error(`module ${names[0]}: ${what} not found in the template`));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`module ${names[0]}: ${error.message}`);
        throw error;
    }

    const created = [];
    for (const name of names) {
        const p = pascal(name);
        // Localization keys ('sample.x') are renamed only where they are keys: string literals and JSON keys
        // ("sample.x") and the prefabs' 'key: sample.x'; a C# member named sample ('sample.Clicked') stays
        await cloneWithNewGuids(path.join(projectDir, SAMPLE_DIR), path.join(projectDir, FEATURES, p), {
            seed: `${seed}:${name}`,
            rename: [{ from: 'Sample', to: p }, { from: 'sample.json', to: `${name}.json` },
                { from: '"sample.', to: `"${name}.` }, { from: 'key: sample.', to: `key: ${name}.` }]
        });
        created.push(`${FEATURES}/${p}`);
    }

    const { manifest, manifestFile, lines, eol, end, usingAt, indent, asmdef, refAt } = anchors;
    addFlagTwins(manifest, names);
    await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    // Installer lines go before the end marker (in order), using lines right after the Sample one
    const installs = names.map((n) => `${indent}if (registerViews) new ${pascal(n)}Installer(registerViews).Install(builder);`);
    const usings = names.map((n) => `using Kturker.UnityBase.Features.${pascal(n)}.Installer;`);
    const next = [...lines];
    next.splice(end, 0, ...installs);
    next.splice(usingAt + 1, 0, ...usings);
    await fs.writeFile(anchors.installerFile, next.join(eol));

    asmdef.references.splice(refAt + 1, 0, ...names.map((n) => `Kturker.UnityBase.Features.${pascal(n)}.Installer`));
    await fs.writeFile(path.join(projectDir, anchors.asmdefRel), `${JSON.stringify(asmdef, null, 4)}\n`);
    return created;
}

module.exports = { cloneModules };
