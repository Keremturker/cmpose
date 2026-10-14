'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const { seedTemplate } = require('./seedTemplate');

// A local git repository holding the seed template at `tag`; clone it by its directory path
async function makeGitTemplateRepo(tag = 'template-test') {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-repo-'));
    await seedTemplate(dir);
    for (const marker of ['.template-commit', '.template-ref']) await fs.remove(path.join(dir, marker));
    // No background gc/maintenance: a detached git process could still be writing while a test clones or removes the repo
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
    git('tag', tag);
    return { url: dir, commit: git('rev-parse', 'HEAD'), cleanup: () => fs.remove(dir) };
}

module.exports = { makeGitTemplateRepo };
