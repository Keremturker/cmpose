const path = require('path');
const fs = require('fs-extra');
const { readMetaGuid } = require('./guid');

// Unity's own resources (default font, built-in materials) are referenced with these guids
const BUILTIN_GUIDS = ['0000000000000000e000000000000000', '0000000000000000f000000000000000'];
// Serialized YAML that may point at other assets
const YAML_EXTENSIONS = new Set(['.unity', '.prefab', '.asset', '.mat', '.controller', '.anim', '.asmdef', '.asmref', '.meta']);

// Unity skips hidden files/folders and anything ending in '~'
function ignoredByUnity(name) {
    return name.startsWith('.') || name.endsWith('~');
}

// Folders Unity imports as a single plugin asset: one .meta for the folder, nothing inside is imported
const FOLDER_ASSET_EXTENSIONS = new Set(['.androidlib', '.bundle', '.framework', '.xcframework', '.plugin']);

async function walk(abs, rel, out) {
    const entries = (await fs.readdir(abs, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        if (ignoredByUnity(entry.name)) continue;
        const r = `${rel}/${entry.name}`;
        out.push({ rel: r, dir: entry.isDirectory() });
        if (entry.isDirectory() && !FOLDER_ASSET_EXTENSIONS.has(path.extname(entry.name))) await walk(path.join(abs, entry.name), r, out);
    }
}

async function checkGuidIntegrity(dir, { allowlist = [], roots = ['Assets'] } = {}) {
    const entries = [];
    for (const root of roots) {
        if (await fs.pathExists(path.join(dir, root))) await walk(path.join(dir, root), root, entries);
    }
    const present = new Set(entries.map((e) => e.rel));
    const problems = [];
    const owners = new Map();

    for (const e of entries.filter((x) => !x.dir)) {
        if (!e.rel.endsWith('.meta')) continue;
        if (!present.has(e.rel.slice(0, -'.meta'.length))) problems.push(`orphan-meta ${e.rel}`);
        let guid;
        try {
            guid = readMetaGuid(await fs.readFile(path.join(dir, e.rel), 'utf8'));
        } catch (error) {
            problems.push(`invalid-meta ${e.rel}`);
            continue;
        }
        owners.set(guid, [...(owners.get(guid) || []), e.rel]);
    }
    for (const e of entries) {
        if (!e.rel.endsWith('.meta') && !present.has(`${e.rel}.meta`)) problems.push(`missing-meta ${e.rel}`);
    }
    for (const [guid, paths] of owners) {
        if (paths.length > 1) problems.push(`duplicate-guid ${guid}: ${[...paths].sort().join(', ')}`);
    }

    const known = new Set([...owners.keys(), ...BUILTIN_GUIDS, ...allowlist]);
    for (const e of entries.filter((x) => !x.dir && YAML_EXTENSIONS.has(path.extname(x.rel)))) {
        let text = await fs.readFile(path.join(dir, e.rel), 'utf8');
        // A .meta's own 'guid:' line defines the asset; only the rest are references
        if (e.rel.endsWith('.meta')) text = text.replace(/^guid: [0-9a-f]{32}\r?$/m, '');
        for (const m of text.matchAll(/(?:guid: |GUID:)([0-9a-f]{32})(?![0-9a-f])/g)) {
            if (!known.has(m[1])) problems.push(`dangling-guid ${m[1]} in ${e.rel}`);
        }
    }
    return [...new Set(problems)].sort();
}

// The template's .cmpose/package-guids.txt: guids of assets inside packages, which template assets may reference
async function readGuidAllowlist(file) {
    if (!(await fs.pathExists(file))) return [];
    const guids = [];
    (await fs.readFile(file, 'utf8')).split('\n').forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        if (!/^[0-9a-f]{32}$/.test(line)) throw new Error(`invalid guid on line ${i + 1} of ${file}`);
        guids.push(line);
    });
    return guids;
}

module.exports = { BUILTIN_GUIDS, checkGuidIntegrity, readGuidAllowlist };
