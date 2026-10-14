const path = require('path');
const fs = require('fs-extra');
const { getMapKeys, setMapEntry } = require('./unityYaml');
const { renamer } = require('./guid');
const { PLAYER, applyIdentity } = require('./projectSettings');

const TEXT_EXTENSIONS = new Set(['.cs', '.asmdef', '.asmref', '.prefab', '.unity', '.asset', '.mat', '.json', '.md', '.txt',
    '.xml', '.ruleset', '.yml', '.uss', '.uxml']);
const SKIPPED = new Set(['Library', 'Temp', 'Logs', 'UserSettings', '.git', '.cmpose']);
const TEMPLATE_NAMESPACE = 'Kturker.UnityBase';

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

    // Names, deepest first; a .meta carries the template namespace in its name too, so it follows its asset.
    // Every target is checked before anything changes, so a collision leaves the project as it was.
    const namePart = renamer([{ from: TEMPLATE_NAMESPACE, to: `${companyName}.${projectName}` }]);
    const moves = entries.filter((e) => path.posix.basename(e.rel).includes(TEMPLATE_NAMESPACE))
        .sort((a, b) => b.rel.split('/').length - a.rel.split('/').length)
        .map((e) => {
            const from = path.join(projectDir, e.rel);
            return { rel: e.rel, from, to: path.join(path.dirname(from), namePart(path.basename(from))) };
        });
    const targets = new Set();
    for (const m of moves) {
        if (targets.has(m.to) || (await fs.pathExists(m.to))) throw new Error(`cannot rename ${m.rel}: target exists`);
        targets.add(m.to);
    }

    // 1. content
    for (const e of entries) {
        if (e.dir || !TEXT_EXTENSIONS.has(path.extname(e.rel))) continue;
        const file = path.join(projectDir, e.rel);
        const text = await fs.readFile(file, 'utf8');
        const next = rename(text);
        if (next !== text) await fs.writeFile(file, next);
    }

    // 2. names, in the order checked above
    for (const m of moves) await fs.move(m.from, m.to);
    const renamedFiles = moves.length;

    // 3. PlayerSettings
    const settingsFile = path.join(projectDir, 'ProjectSettings', 'ProjectSettings.asset');
    const settings = await fs.readFile(settingsFile, 'utf8');
    let identified = applyIdentity(settings, {
        companyName, productName: appName, bundleId: packageName, version: '1.0.0',
        androidMinSdk: minSdk, iosTarget: iosVersion, urlScheme: projectName.toLowerCase()
    });
    // applyIdentity sets Android and iPhone; any other platform the template lists (Standalone …) gets the package too
    for (const platform of getMapKeys(identified, 'applicationIdentifier', { doc: PLAYER })) {
        if (platform !== 'Android' && platform !== 'iPhone') {
            identified = setMapEntry(identified, 'applicationIdentifier', platform, packageName, { doc: PLAYER });
        }
    }
    await fs.writeFile(settingsFile, identified);
    return { renamedFiles };
}

module.exports = { applyGameIdentity };
