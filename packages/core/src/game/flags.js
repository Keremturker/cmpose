const path = require('path');
const fs = require('fs-extra');
const { removeLineMarkedBlock, stripLineMarkers } = require('./markers');
const { removePackagesInProject } = require('./packages');
const { getDefines, setDefines } = require('./projectSettings');
const { readMetaGuid } = require('./guid');
const { findResidue } = require('./residue');
const { pruneBuildScenes } = require('./buildScenes');

// cmpose.dev/game: a feature flag is folders + marked C# blocks ('// cmpose:<flag>' … '// /cmpose:<flag>') +
// asmdef references + packages + a scripting define, all listed in the template's .cmpose/flags.json. A flag may
// require others ("requires"); turning one off turns off the flags that require it. A render
// other than the upstream one is an overlay under .cmpose/layers/ whose files replace the project's (same guids).
// Turning flags off and picking the render only edits files; Unity never runs here.
// Internal flags (Faz 2f: sample, showcase and its games) are never turned off by name: a project kind does it
// ("kinds": blank turns the showcase off, showcase turns the sample off and keeps the render's game). Scenes whose
// file a flag removes are dropped from Build Settings.
const MANIFEST = '.cmpose/flags.json';
const LAYERS = '.cmpose/layers';
const DEFINE_TARGETS = ['Android', 'iPhone'];
const SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FLAG_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const RENDER_NAME = /^[a-z0-9]+$/;
const KIND_NAME = /^[a-z]+$/;
// Files only the upstream repo or Unity's local state carry; never scanned for residue
const RESIDUE_IGNORE = ['README.md', 'MAINTAINING.md', 'tools/', 'Builds/', 'Assets/Editor/Maintainer/', '.cmpose/'];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function safeRel(p, what) {
    if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
        throw new Error(`${MANIFEST}: ${what}: '${p}' must be a relative path inside the project`);
    }
    return p;
}

function nameList(value, what) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) {
        throw new Error(`${MANIFEST}: ${what} must be a list of names`);
    }
    return [...value];
}

function readInternal(value, name) {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw new Error(`${MANIFEST}: flag ${name} "internal" must be true or false`);
    return value;
}

// A manifest from before Faz 2f has no "kinds": it only knows blank, which turns nothing off
function parseKinds(value, flags, renders) {
    if (value === undefined) return { blank: { off: [], games: {} } };
    if (!isObject(value) || !isObject(value.blank)) throw new Error(`${MANIFEST}: "kinds" needs a "blank" kind`);
    const kinds = {};
    for (const [name, kind] of Object.entries(value)) {
        if (!KIND_NAME.test(name)) throw new Error(`${MANIFEST}: '${name}' is not a valid kind name`);
        if (!isObject(kind)) throw new Error(`${MANIFEST}: kind ${name} must be an object`);
        const off = nameList(kind.off, `kind ${name} off`);
        for (const flag of off) {
            if (!flags[flag]) throw new Error(`${MANIFEST}: kind ${name} turns off unknown flag ${flag}`);
            if (!flags[flag].internal) throw new Error(`${MANIFEST}: kind ${name} turns off ${flag}, which is not internal`);
        }
        const games = {};
        if (kind.games !== undefined) {
            if (!isObject(kind.games)) throw new Error(`${MANIFEST}: kind ${name} games must map renders to flags`);
            for (const [render, game] of Object.entries(kind.games)) {
                if (!Object.prototype.hasOwnProperty.call(renders, render)) {
                    throw new Error(`${MANIFEST}: kind ${name} has a game for unknown render ${render}`);
                }
                if (!flags[game] || !flags[game].internal) {
                    throw new Error(`${MANIFEST}: kind ${name} game ${game} must be an internal flag`);
                }
                games[render] = game;
            }
        }
        kinds[name] = { off, games };
    }
    return kinds;
}

function parseFlagManifest(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new Error(`${MANIFEST}: ${error.message}`);
    }
    if (!isObject(raw) || !isObject(raw.flags) || !isObject(raw.renders)) {
        throw new Error(`${MANIFEST}: needs "flags" and "renders" objects`);
    }
    const flags = {};
    for (const [name, flag] of Object.entries(raw.flags)) {
        if (!FLAG_NAME.test(name)) throw new Error(`${MANIFEST}: '${name}' is not a valid flag name`);
        if (!isObject(flag) || !SYMBOL.test(flag.define || '')) throw new Error(`${MANIFEST}: flag ${name} needs a valid "define"`);
        flags[name] = {
            define: flag.define,
            paths: nameList(flag.paths, `flag ${name} paths`).map((p) => safeRel(p, `flag ${name}`)),
            asmdefs: nameList(flag.asmdefs, `flag ${name} asmdefs`),
            packages: nameList(flag.packages, `flag ${name} packages`),
            requires: nameList(flag.requires, `flag ${name} requires`),
            internal: readInternal(flag.internal, name)
        };
    }
    for (const [name, flag] of Object.entries(flags)) {
        for (const required of flag.requires) {
            if (!flags[required]) throw new Error(`${MANIFEST}: flag ${name} requires unknown flag ${required}`);
        }
    }
    const renders = {};
    for (const [name, dir] of Object.entries(raw.renders)) {
        if (!RENDER_NAME.test(name)) throw new Error(`${MANIFEST}: '${name}' is not a valid render name`);
        renders[name] = dir === null ? null : safeRel(dir, `render ${name}`);
    }
    if (Object.values(renders).filter((d) => d === null).length !== 1) {
        throw new Error(`${MANIFEST}: exactly one render must be the upstream one (null)`);
    }
    return { flags, renders, kinds: parseKinds(raw.kinds, flags, renders) };
}

async function readFlagManifest(projectDir) {
    const file = path.join(projectDir, MANIFEST);
    if (!(await fs.pathExists(file))) throw new Error(`${MANIFEST} not found in ${projectDir}`);
    return parseFlagManifest(await fs.readFile(file, 'utf8'));
}

// Every file under dir (relative, '/'-separated, sorted); with extensions, only those
async function listFiles(dir, extensions) {
    const out = [];
    async function walk(abs, rel) {
        const entries = (await fs.readdir(abs, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
        for (const entry of entries) {
            const r = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(path.join(abs, entry.name), r);
            else if (!extensions || extensions.has(path.extname(entry.name))) out.push(r);
        }
    }
    if (await fs.pathExists(dir)) await walk(dir, '');
    return out;
}

async function checkRenderLayers(projectDir, manifest) {
    const problems = [];
    for (const [name, rel] of Object.entries(manifest.renders)) {
        if (rel === null) continue;
        const layer = path.join(projectDir, rel);
        const files = await listFiles(layer);
        if (files.length === 0) {
            problems.push(`render ${name}: ${rel} is missing or empty`);
            continue;
        }
        for (const file of files) {
            const target = path.join(projectDir, file);
            const targetExists = await fs.pathExists(target);
            if (!file.endsWith('.meta')) {
                if (!files.includes(`${file}.meta`)) problems.push(`render ${name}: ${file} has no .meta`);
                if (!targetExists) problems.push(`render ${name}: ${file} replaces nothing`);
                continue;
            }
            if (!targetExists) {
                problems.push(`render ${name}: ${file} replaces nothing`);
                continue;
            }
            let own;
            let theirs;
            try {
                own = readMetaGuid(await fs.readFile(path.join(layer, file), 'utf8'));
                theirs = readMetaGuid(await fs.readFile(target, 'utf8'));
            } catch (error) {
                problems.push(`render ${name}: ${file}: ${error.message}`);
                continue;
            }
            if (own !== theirs) problems.push(`render ${name}: ${file} guid ${own} differs from the project's ${theirs}`);
        }
    }
    return problems.sort();
}

// A flag that requires a turned-off flag goes off with it (networkInspector without network), chains included
function withRequirers(manifest, off) {
    const out = [...new Set(off)];
    let grown = true;
    while (grown) {
        grown = false;
        for (const [name, flag] of Object.entries(manifest.flags)) {
            if (!out.includes(name) && flag.requires.some((r) => out.includes(r))) {
                out.push(name);
                grown = true;
            }
        }
    }
    return out;
}

function resolveOptions(manifest, { kind = 'blank', off = [], render } = {}) {
    const chosenKind = manifest.kinds[kind];
    if (!chosenKind) throw new Error(`unknown kind: ${kind}`);
    for (const flag of off) {
        if (!manifest.flags[flag]) throw new Error(`unknown flag: ${flag}`);
        if (manifest.flags[flag].internal) throw new Error(`flag ${flag} is internal: pick a kind instead`);
    }
    const upstream = Object.keys(manifest.renders).find((r) => manifest.renders[r] === null);
    const chosen = render === undefined ? upstream : render;
    if (!Object.prototype.hasOwnProperty.call(manifest.renders, chosen)) throw new Error(`unknown render: ${chosen}`);
    const games = Object.values(chosenKind.games);
    if (games.length && !chosenKind.games[chosen]) throw new Error(`${kind} has no game for render ${chosen}`);
    const otherGames = games.filter((g) => g !== chosenKind.games[chosen]);
    return { off: withRequirers(manifest, [...off, ...chosenKind.off, ...otherGames]), render: chosen };
}

async function applyFlags(projectDir, options = {}) {
    const manifest = await readFlagManifest(projectDir);
    const { off, render } = resolveOptions(manifest, options);
    const offSet = new Set(off);
    const on = Object.keys(manifest.flags).filter((f) => !offSet.has(f));

    const layerProblems = await checkRenderLayers(projectDir, manifest);
    if (layerProblems.length) throw new Error(`render layers: ${layerProblems.join('; ')}`);
    if (manifest.renders[render] !== null) {
        await fs.copy(path.join(projectDir, manifest.renders[render]), projectDir, { overwrite: true });
    }

    // Every path is checked before anything is removed, so a path inside another turned-off flag's folder (multiLang's
    // tables inside network's folder) is simply gone by its turn; a path missing from the template still fails
    const removals = off.flatMap((flag) => manifest.flags[flag].paths.map((rel) => ({ flag, rel })));
    for (const { flag, rel } of removals) {
        if (!(await fs.pathExists(path.join(projectDir, rel)))) throw new Error(`${flag}: path not found: ${rel}`);
    }
    for (const { rel } of removals) {
        const abs = path.join(projectDir, rel);
        await fs.remove(abs);
        await fs.remove(`${abs}.meta`);
    }
    await pruneBuildScenes(projectDir);

    for (const rel of await listFiles(path.join(projectDir, 'Assets'), new Set(['.cs']))) {
        const abs = path.join(projectDir, 'Assets', rel);
        const before = await fs.readFile(abs, 'utf8');
        let text = before;
        try {
            for (const flag of off) text = removeLineMarkedBlock(text, flag);
            for (const flag of on) text = stripLineMarkers(text, flag);
        } catch (error) {
            throw new Error(`Assets/${rel}: ${error.message}`);
        }
        if (text !== before) await fs.writeFile(abs, text);
    }

    const dropped = new Set(off.flatMap((f) => manifest.flags[f].asmdefs));
    for (const rel of await listFiles(path.join(projectDir, 'Assets'), new Set(['.asmdef']))) {
        const abs = path.join(projectDir, 'Assets', rel);
        const asmdef = JSON.parse(await fs.readFile(abs, 'utf8'));
        if (!Array.isArray(asmdef.references)) continue;
        const kept = asmdef.references.filter((r) => !dropped.has(r));
        if (kept.length === asmdef.references.length) continue;
        asmdef.references = kept;
        await fs.writeFile(abs, `${JSON.stringify(asmdef, null, 4)}\n`);
    }

    if (off.length) {
        const settingsPath = path.join(projectDir, 'ProjectSettings', 'ProjectSettings.asset');
        let settings = await fs.readFile(settingsPath, 'utf8');
        const drop = new Set(off.map((f) => manifest.flags[f].define));
        for (const target of DEFINE_TARGETS) {
            const current = getDefines(settings, target);
            for (const flag of off) {
                const define = manifest.flags[flag].define;
                if (!current.includes(define)) throw new Error(`${flag}: define ${define} missing for ${target}`);
            }
            settings = setDefines(settings, target, current.filter((d) => !drop.has(d)));
        }
        await fs.writeFile(settingsPath, settings);
    }

    const keep = new Set(on.flatMap((f) => manifest.flags[f].packages));
    const removedPackages = [...new Set(off.flatMap((f) => manifest.flags[f].packages))].filter((p) => !keep.has(p));
    if (removedPackages.length) await removePackagesInProject(projectDir, removedPackages);

    await fs.remove(path.join(projectDir, MANIFEST));
    await fs.remove(path.join(projectDir, LAYERS));
    return { off, render, removedPackages };
}

// What a turned-off flag must not leave behind: its define, its assembly names (which also cover 'using'
// lines, namespaces being the assembly names) and, for every flag, the markers themselves
async function findFlagResidue(projectDir, manifest, off) {
    const rules = off.map((flag) => ({
        name: `flag ${flag}:`,
        tokens: [manifest.flags[flag].define, ...manifest.flags[flag].asmdefs]
    }));
    rules.push({ name: 'marker', tokens: Object.keys(manifest.flags).map((f) => `cmpose:${f}`), extensions: ['.cs'] });
    return findResidue(projectDir, rules, { ignore: RESIDUE_IGNORE });
}

function flagVariants(manifest) {
    const flags = Object.keys(manifest.flags).filter((f) => !manifest.flags[f].internal);
    const overlays = Object.keys(manifest.renders).filter((r) => manifest.renders[r] !== null);
    const variants = flags.map((f) => ({ name: `no-${f}`, off: [f], render: undefined, kind: 'blank' }));
    for (const r of overlays) variants.push({ name: `render-${r}`, off: [], render: r, kind: 'blank' });
    if (flags.length) {
        const r = overlays[0];
        variants.push({ name: r ? `all-off-${r}` : 'all-off', off: flags, render: r, kind: 'blank' });
    }
    const showcase = manifest.kinds.showcase;
    for (const render of Object.keys(showcase ? showcase.games : {})) {
        variants.push({ name: `showcase-${render}`, off: [], render, kind: 'showcase' });
        variants.push({ name: `showcase-all-off-${render}`, off: flags, render, kind: 'showcase' });
    }
    return variants;
}

module.exports = {
    MANIFEST, LAYERS, parseFlagManifest, readFlagManifest, checkRenderLayers, applyFlags, findFlagResidue, flagVariants
};
