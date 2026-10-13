'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { runGenerate } = require('../src/generate');
const { makeGitTemplateRepo } = require('../../core/test/support/gitTemplateRepo');
const core = require('@cmpose/core');

const args = (outputDir, extra = {}) => ({
    projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', outputDir, ...extra
});

async function setup() {
    const remote = await makeGitTemplateRepo(core.pins.cmp.ref);
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-mcp-cache-'));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-mcp-out-'));
    const opts = { cacheDir, remoteUrl: remote.url, generatorVersion: 'mcp@test' };
    const cleanup = async () => { await remote.cleanup(); await fs.remove(cacheDir); await fs.remove(outputDir); };
    return { opts, outputDir, cleanup };
}

const leftovers = async (dir) => (await fs.readdir(dir)).filter((n) => n.startsWith('.cmpose-'));

test('generates into <outputDir>/<projectName> and reports the summary', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const progress = [];
    const r = await runGenerate(args(outputDir), { ...opts, onProgress: (m) => progress.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const projectDir = path.join(outputDir, 'Demo');
    assert.strictEqual(r.structuredContent.projectDir, projectDir);
    assert.strictEqual(r.structuredContent.template.ref, core.pins.cmp.ref);
    assert.ok(await fs.pathExists(path.join(projectDir, 'settings.gradle.kts')));
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.ok(progress.length >= 2);
    await cleanup();
});

test('a relative outputDir is refused', async () => {
    const r = await runGenerate(args('some/dir'), {});
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /absolute/);
});

test('invalid input is refused before anything is downloaded or written', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { projectName: 'Bad Name' }), opts);
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(opts.cacheDir, 'templates')), false);
    await cleanup();
});

test('an existing non-empty target or a file is never overwritten; an empty directory is used', async () => {
    const { opts, outputDir, cleanup } = await setup();
    await fs.outputFile(path.join(outputDir, 'Demo', 'keep.txt'), 'mine');
    let r = await runGenerate(args(outputDir), opts);
    assert.strictEqual(r.isError, true);
    assert.strictEqual(await fs.readFile(path.join(outputDir, 'Demo', 'keep.txt'), 'utf8'), 'mine');
    await fs.remove(path.join(outputDir, 'Demo'));
    await fs.outputFile(path.join(outputDir, 'Demo'), 'a file');
    r = await runGenerate(args(outputDir), opts);
    assert.strictEqual(r.isError, true);
    await fs.remove(path.join(outputDir, 'Demo'));
    await fs.ensureDir(path.join(outputDir, 'Demo'));
    r = await runGenerate(args(outputDir), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    await cleanup();
});

test('a template download failure is reported and leaves nothing behind', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateRef: 'template-missing' }), opts);
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /template-missing/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});

test('a generation failure removes its working directory', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateType: 'blank', featuresConfig: { purchases: true } }), opts);
    // The seed template has no monetization modules: the capability check fails
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'Demo')), false);
    await cleanup();
});

test('content appearing at the target during generation is never deleted', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const original = core.generateCmpProject;
    core.generateCmpProject = async (...a) => {
        const summary = await original(...a);
        await fs.outputFile(path.join(outputDir, 'Demo', 'theirs.txt'), 'other run');
        return summary;
    };
    let r;
    try {
        r = await runGenerate(args(outputDir), opts);
    } finally {
        core.generateCmpProject = original;
    }
    assert.strictEqual(r.isError, true);
    assert.strictEqual(await fs.readFile(path.join(outputDir, 'Demo', 'theirs.txt'), 'utf8'), 'other run');
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('removeEmptyDir removes only an empty directory and tolerates a missing one', async () => {
    const { removeEmptyDir } = require('../src/generate');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-rmdir-'));
    const full = path.join(dir, 'full');
    await fs.outputFile(path.join(full, 'keep.txt'), 'mine');
    await assert.rejects(removeEmptyDir(full));
    assert.strictEqual(await fs.readFile(path.join(full, 'keep.txt'), 'utf8'), 'mine');
    await fs.ensureDir(path.join(dir, 'empty'));
    await removeEmptyDir(path.join(dir, 'empty'));
    assert.strictEqual(await fs.pathExists(path.join(dir, 'empty')), false);
    await removeEmptyDir(path.join(dir, 'missing'));
    await fs.remove(dir);
});

test('unknown featuresConfig keys are refused by name, with the valid keys listed', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { templateType: 'blank', featuresConfig: { netwrk: true, theming: true, roomz: false } }), opts);
    assert.strictEqual(r.isError, true);
    const text = r.content[0].text;
    assert.match(text, /netwrk/);
    assert.match(text, /roomz/);
    for (const key of core.SCHEMA.featuresConfigKeys) assert.ok(text.includes(key), `valid key ${key} listed`);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(opts.cacheDir, 'templates')), false);
    await cleanup();
});

test('featuresConfig on a showcase project is reported as ignored', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { featuresConfig: { network: true } }), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const warning = r.structuredContent.warnings.find((w) => /featuresConfig/.test(w));
    assert.ok(warning, 'a featuresConfig warning');
    assert.match(warning, /showcase/);
    assert.match(r.content[0].text, /Warning: featuresConfig/);
    assert.strictEqual(r.structuredContent.featuresConfig, null);
    await cleanup();
});

test('no featuresConfig warning when showcase is generated without one', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(!r.structuredContent.warnings.some((w) => /featuresConfig/.test(w)));
    await cleanup();
});

test('minSdk and iosVersion may be numbers', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const r = await runGenerate(args(outputDir, { minSdk: 26, iosVersion: 16.4 }), opts);
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(await fs.pathExists(path.join(outputDir, 'Demo', 'settings.gradle.kts')));
    await cleanup();
});

test('the download progress message is sent only while the template is not cached yet', async () => {
    const { opts, outputDir, cleanup } = await setup();
    const first = [];
    let r = await runGenerate(args(outputDir), { ...opts, onProgress: (m) => first.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(first.some((m) => /Downloading/.test(m)), first.join(' | '));
    const second = [];
    r = await runGenerate(args(outputDir, { projectName: 'Other' }), { ...opts, onProgress: (m) => second.push(m) });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    assert.strictEqual(second.length, 2);
    assert.ok(!second.some((m) => /Downloading/.test(m)), second.join(' | '));
    await cleanup();
});
