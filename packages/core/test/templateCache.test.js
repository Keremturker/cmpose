'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { ensure, defaultCacheDir, TemplateFetchError } = require('../src/templateCache');
const { makeGitTemplateRepo } = require('./support/gitTemplateRepo');

const REPO = 'Owner/Template';

async function tmpCache() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-cache-'));
}

test('clones a tag once and serves it from the cache afterwards', async () => {
    const remote = await makeGitTemplateRepo('template-test');
    const cacheDir = await tmpCache();
    const first = await ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url });
    assert.strictEqual(first.commit, remote.commit);
    assert.strictEqual(await fs.pathExists(path.join(first.dir, '.git')), false);
    assert.strictEqual((await fs.readFile(path.join(first.dir, '.template-ref'), 'utf8')).trim(), 'refs/tags/template-test');
    await remote.cleanup(); // a second ensure must not need the remote
    const second = await ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url });
    assert.deepStrictEqual(second, first);
    await fs.remove(cacheDir);
});

test('two first-time calls at once both succeed and leave one directory', async () => {
    const remote = await makeGitTemplateRepo('template-test');
    const cacheDir = await tmpCache();
    const [a, b] = await Promise.all([
        ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url }),
        ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url })
    ]);
    assert.strictEqual(a.dir, b.dir);
    const entries = await fs.readdir(path.dirname(a.dir));
    assert.deepStrictEqual(entries, ['template-test']);
    await remote.cleanup();
    await fs.remove(cacheDir);
});

test('a missing tag is a TemplateFetchError and leaves no cache behind', async () => {
    const remote = await makeGitTemplateRepo('template-test');
    const cacheDir = await tmpCache();
    await assert.rejects(
        ensure({ repo: REPO, ref: 'template-nope', cacheDir, remoteUrl: remote.url }),
        (err) => err instanceof TemplateFetchError && /Owner\/Template@template-nope/.test(err.message)
    );
    const parent = path.join(cacheDir, 'templates', 'Owner__Template');
    assert.deepStrictEqual(await fs.readdir(parent).catch(() => []), []);
    await remote.cleanup();
    await fs.remove(cacheDir);
});

test('a cache directory without its commit record is cloned again', async () => {
    const remote = await makeGitTemplateRepo('template-test');
    const cacheDir = await tmpCache();
    const { dir } = await ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url });
    await fs.remove(path.join(dir, '.template-commit'));
    const again = await ensure({ repo: REPO, ref: 'template-test', cacheDir, remoteUrl: remote.url });
    assert.strictEqual(again.commit, remote.commit);
    await remote.cleanup();
    await fs.remove(cacheDir);
});

test('rejects repo and ref values that could escape the cache', async () => {
    await assert.rejects(ensure({ repo: '../x', ref: 'a', cacheDir: os.tmpdir() }), TypeError);
    await assert.rejects(ensure({ repo: 'a/b', ref: '../../x', cacheDir: os.tmpdir() }), TypeError);
});

test('cache dir honours CMPOSE_CACHE_DIR, then XDG_CACHE_HOME', () => {
    assert.strictEqual(defaultCacheDir({ CMPOSE_CACHE_DIR: '/c' }), '/c');
    assert.strictEqual(defaultCacheDir({ XDG_CACHE_HOME: '/x' }), path.join('/x', 'cmpose'));
    assert.strictEqual(defaultCacheDir({}), path.join(os.homedir(), '.cache', 'cmpose'));
});

test('isCached is false before the first clone and true after it', async () => {
    const { isCached } = require('../src/templateCache');
    const remote = await makeGitTemplateRepo('template-x');
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-iscached-'));
    const target = { repo: 'owner/name', ref: 'template-x', cacheDir };
    assert.strictEqual(await isCached(target), false);
    await ensure({ ...target, remoteUrl: remote.url });
    assert.strictEqual(await isCached(target), true);
    await assert.rejects(isCached({ ...target, ref: '../x' }), TypeError);
    await remote.cleanup(); await fs.remove(cacheDir);
});
