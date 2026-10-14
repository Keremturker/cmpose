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

test('applyGameReadme removes the sections of flags that are off and leaves the rest', async (t) => {
    const dir = await tmpDir(t);
    await fs.outputFile(path.join(dir, 'README.md'), README);
    assert.equal(await applyGameReadme(dir, { flags: ['ads'] }), true);
    const text = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.match(text, /<!-- cmpose:ads -->\n## Ads\n<!-- \/cmpose:ads -->/);
    assert.doesNotMatch(text, /Network|cmpose:network/);
    assert.match(text, /<!-- cmpose:ci -->\n\*\*CI\*\* runs the tests\.\n<!-- \/cmpose:ci -->/);
});

test('applyGameReadme returns false when there is no README', async (t) => {
    const dir = await tmpDir(t);
    assert.equal(await applyGameReadme(dir, { flags: [] }), false);
});
