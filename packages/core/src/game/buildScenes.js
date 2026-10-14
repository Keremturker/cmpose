const path = require('path');
const fs = require('fs-extra');

// ProjectSettings/EditorBuildSettings.asset lists the scenes a build contains, three lines each:
//   - enabled: 1
//     path: Assets/…/Name.unity
//     guid: <32 hex>
// A flag that deletes a scene file must drop its entry too, or the build skips it and its guid dangles.
const FILE = 'ProjectSettings/EditorBuildSettings.asset';
const ENTRY = /^ {2}- enabled: [01]\r?\n {4}path: (.*?)\r?\n {4}guid: [0-9a-f]{32}\r?\n/gm;

async function readSettings(projectDir) {
    const file = path.join(projectDir, FILE);
    return (await fs.pathExists(file)) ? { file, text: await fs.readFile(file, 'utf8') } : null;
}

async function pruneBuildScenes(projectDir) {
    const settings = await readSettings(projectDir);
    if (!settings) return [];
    const dropped = [];
    const next = settings.text.replace(ENTRY, (entry, scene) => {
        if (fs.existsSync(path.join(projectDir, scene))) return entry;
        dropped.push(scene);
        return '';
    });
    if (dropped.length) await fs.writeFile(settings.file, next);
    return dropped;
}

async function findMissingBuildScenes(projectDir) {
    const settings = await readSettings(projectDir);
    if (!settings) return [];
    const problems = [];
    for (const [, scene] of settings.text.matchAll(ENTRY)) {
        if (!(await fs.pathExists(path.join(projectDir, scene)))) problems.push(`build scene missing: ${scene}`);
    }
    return problems;
}

module.exports = { pruneBuildScenes, findMissingBuildScenes };
