'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { seedTemplate } = require('./support/seedTemplate');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');

async function freshCopy() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-gen-'));
    await seedTemplate(dir, { commit: 'a'.repeat(40), ref: 'refs/tags/template-test' });
    return dir;
}

test('generates a showcase project in place and reports what it did', async () => {
    const projectDir = await freshCopy();
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0' });
    const summary = await generateCmpProject(value, { projectDir, generatorVersion: 'test@1' });

    assert.strictEqual(summary.templateCommit, 'a'.repeat(40));
    assert.strictEqual(summary.templateRef, 'refs/tags/template-test');
    assert.strictEqual(summary.warnings.length, 2);
    for (const leftover of ['.git', '.idea', 'local.properties', '.template-commit', '.template-ref', 'Multiplatform.iml', 'LICENSE']) {
        assert.strictEqual(await fs.pathExists(path.join(projectDir, leftover)), false, leftover);
    }
    const record = await fs.readJson(path.join(projectDir, '.cmpose', 'generation.json'));
    assert.strictEqual(record.backend.revision, 'test@1');
    assert.strictEqual(record.template.commit, 'a'.repeat(40));
    const settings = await fs.readFile(path.join(projectDir, 'settings.gradle.kts'), 'utf8');
    assert.match(settings, /rootProject\.name = "Demo"/);
    await fs.remove(projectDir);
});

test('a broken copy fails instead of returning a project', async () => {
    const projectDir = await freshCopy();
    await fs.remove(path.join(projectDir, 'iosApp'));
    const { value } = validate({ projectName: 'Demo', appName: 'Demo App', packageName: 'com.example.demo', minSdk: '24', iosVersion: '15.0' });
    await assert.rejects(generateCmpProject(value, { projectDir }));
    await fs.remove(projectDir);
});
