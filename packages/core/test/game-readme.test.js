const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { applyGameReadme } = require('../src/game/readme');
const { tmpDir } = require('./support/gameFixtures');

const README = `# Game

<!-- cmpose:ads -->
## Ads
<!-- /cmpose:ads -->

<!-- cmpose:network -->
## Network
<!-- /cmpose:network -->

<!-- cmpose:ci -->
**CI** runs the tests.
<!-- /cmpose:ci -->
`;

test('applyGameReadme removes the sections of flags that are off and an older template\'s CI section', async (t) => {
    const dir = await tmpDir(t);
    await fs.outputFile(path.join(dir, 'README.md'), README);
    assert.equal(await applyGameReadme(dir, { flags: ['ads'] }), true);
    const text = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.match(text, /<!-- cmpose:ads -->\n## Ads\n<!-- \/cmpose:ads -->/);
    assert.doesNotMatch(text, /Network|cmpose:network/);
    assert.doesNotMatch(text, /CI|cmpose:ci/);
});

test('applyGameReadme works when the README has no CI section', async (t) => {
    const dir = await tmpDir(t);
    const noCi = README.replace(/\n<!-- cmpose:ci -->[\s\S]*<!-- \/cmpose:ci -->\n/, '');
    assert.doesNotMatch(noCi, /cmpose:ci/);
    await fs.outputFile(path.join(dir, 'README.md'), noCi);
    assert.equal(await applyGameReadme(dir, { flags: ['ads', 'network'] }), true);
    assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), noCi);
});

test('applyGameReadme returns false when there is no README', async (t) => {
    const dir = await tmpDir(t);
    assert.equal(await applyGameReadme(dir, { flags: [] }), false);
});
