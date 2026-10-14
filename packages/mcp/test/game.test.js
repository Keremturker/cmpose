'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { execFileSync } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const core = require('@cmpose/core');
const { createServer } = require('../src/server');
const { seedGameTemplate } = require('../../core/test/support/seedGameTemplate');

// A local git repository holding the game seed template at the pinned tag; cloned by its directory path
async function makeGameTemplateRepo(tag = core.pins.game.ref) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-repo-'));
    await seedGameTemplate(dir, { full: true });
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
    // No auto maintenance: a background repack after the commit would race the local clone's object copy
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'commit', '-q', '-m', 'seed');
    git('tag', tag);
    return { url: dir, commit: git('rev-parse', 'HEAD'), cleanup: () => fs.remove(dir) };
}

async function connect(options) {
    const server = createServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, close: () => client.close() };
}

async function setup({ remoteUrl } = {}) {
    const remote = remoteUrl ? null : await makeGameTemplateRepo();
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-cache-'));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-game-out-'));
    const conn = await connect({ cacheDir, remoteUrl: remoteUrl || remote.url });
    const cleanup = async () => {
        await conn.close();
        if (remote) await remote.cleanup();
        await fs.remove(cacheDir); await fs.remove(outputDir);
    };
    return { client: conn.client, remote, outputDir, cleanup };
}

const BASE = { projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper' };
const generate = (client, args) => client.callTool({ name: 'game_generate', arguments: { ...BASE, ...args } });
const leftovers = async (dir) => (await fs.readdir(dir)).filter((n) => n.startsWith('.cmpose-'));

test('lists game_describe and game_generate', async () => {
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('game_describe'), names.join(', '));
    assert.ok(names.includes('game_generate'), names.join(', '));
    await close();
});

test('game_describe returns unity 6000.3.25f1 and the pin', async () => {
    const { client, close } = await connect({});
    const r = await client.callTool({ name: 'game_describe', arguments: {} });
    assert.notStrictEqual(r.isError, true);
    assert.strictEqual(r.structuredContent.engine, 'unity');
    assert.strictEqual(r.structuredContent.unityVersion, '6000.3.25f1');
    assert.deepStrictEqual(r.structuredContent.template, { repo: core.pins.game.repo, ref: core.pins.game.ref });
    assert.deepStrictEqual(JSON.parse(r.content[0].text), r.structuredContent);
    await close();
});

test('generates a blank project with a module', async () => {
    const { client, remote, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, templateType: 'blank', features: ['shop'] });
    assert.notStrictEqual(r.isError, true, r.content?.[0]?.text);
    const projectDir = path.join(outputDir, 'SkyHopper');
    const s = r.structuredContent;
    assert.strictEqual(s.projectDir, projectDir);
    assert.deepStrictEqual(s.template, { repo: core.pins.game.repo, ref: core.pins.game.ref, commit: remote.commit });
    assert.strictEqual(s.templateType, 'blank');
    assert.strictEqual(s.render, '2d');
    assert.deepStrictEqual(s.flags, []);
    assert.deepStrictEqual(s.features, ['shop']);
    assert.ok(s.warnings.some((w) => /6000\.3\.25f1/.test(w)));
    assert.strictEqual(s.nextSteps[0], 'Open the folder in Unity Hub with editor 6000.3.25f1 (Android and iOS Build Support modules).');
    assert.strictEqual(s.nextSteps.length, 3);
    assert.ok(await fs.pathExists(path.join(projectDir, 'Assets/_Project/Features/Shop')));
    assert.ok(await fs.pathExists(path.join(projectDir, 'ProjectSettings/ProjectSettings.asset')));
    assert.match(r.content[0].text, /Generated SkyHopper/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('refuses a non-empty target', async () => {
    const { client, outputDir, cleanup } = await setup();
    await fs.outputFile(path.join(outputDir, 'SkyHopper', 'x'), 'mine');
    const r = await generate(client, { outputDir });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /not empty/);
    assert.deepStrictEqual(await fs.readdir(path.join(outputDir, 'SkyHopper')), ['x']);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    await cleanup();
});

test('invalid input names the field and writes nothing', async () => {
    const { client, outputDir, cleanup } = await setup();
    const r = await generate(client, { outputDir, templateType: 'showcase', features: ['shop'] });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /features/);
    assert.deepStrictEqual(await fs.readdir(outputDir), []);
    await cleanup();
});

test('a relative outputDir is refused', async () => {
    const { client, close } = await connect({});
    const r = await generate(client, { outputDir: 'rel', minSdk: 26, iosVersion: 16.4 });
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /outputDir must be an absolute path/);
    await close();
});

test('cleans up after a failed generation', async () => {
    const missing = path.join(os.tmpdir(), `cmpose-missing-${process.pid}-${Date.now()}`);
    const { client, outputDir, cleanup } = await setup({ remoteUrl: missing });
    const r = await generate(client, { outputDir });
    assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});

test('a failure after the copy removes the working directory', async () => {
    const { client, outputDir, cleanup } = await setup();
    const original = core.game.generateGame;
    core.game.generateGame = async () => { throw new Error('boom'); };
    let r;
    try {
        r = await generate(client, { outputDir });
    } finally {
        core.game.generateGame = original;
    }
    assert.strictEqual(r.isError, true);
    assert.match(r.content[0].text, /boom/);
    assert.deepStrictEqual(await leftovers(outputDir), []);
    assert.strictEqual(await fs.pathExists(path.join(outputDir, 'SkyHopper')), false);
    await cleanup();
});
