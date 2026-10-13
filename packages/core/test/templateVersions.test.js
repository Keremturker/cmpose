'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { readTemplateVersions } = require('../src/templateVersions');

test('reads versions and the cache records of a template directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-tv-'));
    await fs.outputFile(path.join(root, 'gradle/libs.versions.toml'), 'kotlin = "2.2.0"\nagp = "8.12.0"\ncomposeMultiplatform = "1.9.0"\n');
    await fs.outputFile(path.join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\n');
    await fs.outputFile(path.join(root, 'build-logic/src/main/kotlin/config/AppConfig.kt'), 'const val compileSdkVersion = 36\nconst val targetSdkVersion = 36\n');
    await fs.outputFile(path.join(root, '.template-commit'), 'abc123\n');
    await fs.outputFile(path.join(root, '.template-ref'), 'refs/tags/template-x\n');
    const v = await readTemplateVersions(root);
    assert.strictEqual(v.kotlin, '2.2.0');
    assert.strictEqual(v.gradle, '8.14.3');
    assert.strictEqual(v.targetSdk, '36');
    assert.strictEqual(v.templateCommit, 'abc123');
    assert.strictEqual(v.templateRef, 'refs/tags/template-x');
    await fs.remove(root);
});
