const path = require('path');
const fs = require('fs-extra');
const { escapeRe } = require('./unityYaml');
const { applyIdentity } = require('./projectSettings');

const TEXT_EXTENSIONS = new Set(['.cs', '.asmdef', '.asmref', '.prefab', '.unity', '.asset', '.mat', '.json', '.md', '.txt',
    '.xml', '.ruleset', '.yml', '.uss', '.uxml']);
const SKIPPED = new Set(['Library', 'Temp', 'Logs', 'UserSettings', '.git', '.cmpose']);
const TEMPLATE_NAMESPACE = 'Kturker.UnityBase';

// One pass, longest 'from' first, so a replacement is never replaced again
function renamer(pairs) {
    const sorted = [...pairs].sort((a, b) => b.from.length - a.from.length);
    const lookup = new Map(sorted.map((p) => [p.from, p.to]));
    const re = new RegExp(sorted.map((p) => escapeRe(p.from)).join('|'), 'g');
    return (s) => s.replace(re, (m) => lookup.get(m));
}

// Every file and folder below dir outside the skipped top-level folders; folders are listed too
async function walk(abs, rel, out) {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
        if (!rel && SKIPPED.has(entry.name)) continue;
        if (entry.name === '.git') continue;
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        out.push({ rel: r, dir: entry.isDirectory() });
        if (entry.isDirectory()) await walk(path.join(abs, entry.name), r, out);
    }
}

async function applyGameIdentity(projectDir, { companyName, projectName, appName, packageName, minSdk, iosVersion }) {
    const rename = renamer([
        { from: TEMPLATE_NAMESPACE, to: `${companyName}.${projectName}` },
        { from: 'UnityBase', to: projectName },
        { from: 'unitybase', to: projectName.toLowerCase() }
    ]);
    const entries = [];
    await walk(projectDir, '', entries);

    // 1. content
    for (const e of entries) {
        if (e.dir || !TEXT_EXTENSIONS.has(path.extname(e.rel))) continue;
        const file = path.join(projectDir, e.rel);
        const text = await fs.readFile(file, 'utf8');
        const next = rename(text);
        if (next !== text) await fs.writeFile(file, next);
    }

    // 2. names, deepest first; a .meta carries the template namespace in its name too, so it follows its asset
    const namePart = renamer([{ from: TEMPLATE_NAMESPACE, to: `${companyName}.${projectName}` }]);
    let renamedFiles = 0;
    const named = entries.filter((e) => path.posix.basename(e.rel).includes(TEMPLATE_NAMESPACE))
        .sort((a, b) => b.rel.split('/').length - a.rel.split('/').length);
    for (const e of named) {
        const from = path.join(projectDir, e.rel);
        const to = path.join(path.dirname(from), namePart(path.basename(from)));
        if (await fs.pathExists(to)) throw new Error(`cannot rename ${e.rel}: target exists`);
        await fs.move(from, to);
        renamedFiles += 1;
    }

    // 3. PlayerSettings
    const settingsFile = path.join(projectDir, 'ProjectSettings', 'ProjectSettings.asset');
    const settings = await fs.readFile(settingsFile, 'utf8');
    await fs.writeFile(settingsFile, applyIdentity(settings, {
        companyName, productName: appName, bundleId: packageName, version: '1.0.0',
        androidMinSdk: minSdk, iosTarget: iosVersion, urlScheme: projectName.toLowerCase()
    }));
    return { renamedFiles };
}

module.exports = { applyGameIdentity };
