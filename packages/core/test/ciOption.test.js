const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { applyCiOption } = require('../src/ciOption');

const README = [
    '## Checks',
    '',
    '- `./gradlew allTests`: unit tests.',
    '<!-- cmpose:ci -->',
    '- `.github/workflows/ci.yml` runs these on every pull request.',
    '<!-- /cmpose:ci -->',
    '',
    '## Logging',
    ''
].join('\n');

async function project(t, { readme = README, extra = [] } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-option-'));
    t.after(() => fs.remove(dir));
    await fs.outputFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'on:\n  pull_request:\n  workflow_dispatch:\n');
    for (const rel of extra) await fs.outputFile(path.join(dir, rel), 'x\n');
    if (readme !== null) await fs.outputFile(path.join(dir, 'README.md'), readme);
    return dir;
}

test('ci off: the workflow, the empty .github/ and the README CI block go', async (t) => {
    t.mock.method(console, 'log', () => { });
    const dir = await project(t);
    await applyCiOption(dir, false);
    assert.equal(await fs.pathExists(path.join(dir, '.github')), false);
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.ok(!readme.includes('cmpose:ci'), readme);
    assert.ok(!readme.includes('ci.yml'), readme);
    assert.ok(readme.includes('- `./gradlew allTests`: unit tests.\n\n## Logging'), readme);
});

test('ci on: the workflow and the README line stay (markers stay, like the other cmpose sections)', async (t) => {
    const dir = await project(t);
    await applyCiOption(dir, true);
    assert.ok(await fs.pathExists(path.join(dir, '.github', 'workflows', 'ci.yml')));
    assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), README);
});

test('ci off keeps other .github files and only drops directories left empty', async (t) => {
    t.mock.method(console, 'log', () => { });
    const dir = await project(t, { extra: ['.github/dependabot.yml', '.github/workflows/release.yml'] });
    await applyCiOption(dir, false);
    assert.equal(await fs.pathExists(path.join(dir, '.github', 'workflows', 'ci.yml')), false);
    assert.ok(await fs.pathExists(path.join(dir, '.github', 'dependabot.yml')));
    assert.ok(await fs.pathExists(path.join(dir, '.github', 'workflows', 'release.yml')));
});

test('ci off on an older template: README without the marker and no README are left alone', async (t) => {
    t.mock.method(console, 'log', () => { });
    const old = '## Checks\n\n- `.github/workflows/ci.yml` runs these on every push to `main`.\n';
    const dir = await project(t, { readme: old });
    await applyCiOption(dir, false);
    assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), old);
    const bare = await project(t, { readme: null });
    await applyCiOption(bare, false);
    assert.equal(await fs.pathExists(path.join(bare, 'README.md')), false);
});

test('ci off without any workflow is a no-op', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-option-'));
    t.after(() => fs.remove(dir));
    await applyCiOption(dir, false);
    assert.deepEqual(await fs.readdir(dir), []);
});
