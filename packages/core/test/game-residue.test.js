const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { findResidue } = require('../src/game/residue');
const { tmpDir } = require('./support/gameFixtures');

const RULES = [{ name: 'ads', tokens: ['CMPOSE_ADS', '.Core.Ads', 'com.google.ads.mobile', 'GADApplicationIdentifier'], ignore: ['README.md'] }];

async function project(t) {
    const dir = await tmpDir(t);
    const f = (rel, c) => fs.outputFile(path.join(dir, rel), c);
    await f('Assets/_Project/Core/DI/ProjectLifetimeScope.cs', 'using Acme.Core.Ads;\n');
    await f('Packages/manifest.json', '{"dependencies":{"com.google.ads.mobile":"11.5.0"}}\n');
    await f('Library/Bee/cache.cs', 'CMPOSE_ADS\n');
    await f('README.md', 'Define CMPOSE_ADS to ...\n');
    await f('Assets/_Project/Art/logo.png', 'CMPOSE_ADS');
    return dir;
}

test('findResidue reports each token per file, skipping Unity caches, ignored paths and non-text files', async (t) => {
    const dir = await project(t);
    assert.deepEqual(await findResidue(dir, RULES), [
        'ads .Core.Ads in Assets/_Project/Core/DI/ProjectLifetimeScope.cs',
        'ads com.google.ads.mobile in Packages/manifest.json'
    ]);
});

test('a rule can be limited to extensions, and the call can ignore whole folders', async (t) => {
    const dir = await project(t);
    assert.deepEqual(await findResidue(dir, [{ name: 'x', tokens: ['com.google'], extensions: ['.cs'] }]), []);
    assert.deepEqual(await findResidue(dir, RULES, { ignore: ['Packages/'] }),
        ['ads .Core.Ads in Assets/_Project/Core/DI/ProjectLifetimeScope.cs']);
});
