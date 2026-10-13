const { log } = require('./log');
const fs = require('fs-extra');
const path = require('path');
const { removeMarkedBlock } = require('./readmeService');

// ci-optin: GitHub Actions CI is an opt-in for both templates. The template ships
// .github/workflows/ci.yml and marks its README line <!-- cmpose:ci -->; without the option both go.
const CI_WORKFLOW = path.join('.github', 'workflows', 'ci.yml');

async function removeIfEmpty(dir) {
    if (await fs.pathExists(dir) && (await fs.readdir(dir)).length === 0) await fs.remove(dir);
}

async function applyCiOption(projectPath, ci) {
    if (ci === true) return;
    const workflow = path.join(projectPath, CI_WORKFLOW);
    if (await fs.pathExists(workflow)) {
        await fs.remove(workflow);
        await removeIfEmpty(path.dirname(workflow));
        await removeIfEmpty(path.join(projectPath, '.github'));
        log.info('✅ Removed the CI workflow (ci option off)');
    }
    const readmePath = path.join(projectPath, 'README.md');
    if (await fs.pathExists(readmePath)) {
        const readme = await fs.readFile(readmePath, 'utf8');
        const updated = removeMarkedBlock(readme, 'cmpose:ci');
        if (updated !== readme) await fs.writeFile(readmePath, updated);
    }
}

module.exports = { CI_WORKFLOW, applyCiOption };
