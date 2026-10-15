'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { validate } = require('../src/validate');
const { generateCmpProject } = require('../src/generate');
const { listTextFiles } = require('../src/projectFiles');
const { BACKEND_RESIDUE_TOKENS } = require('../src/fileService');

// The whole pipeline against the REAL template with the backend (CMP_REAL_TEMPLATE_DIR, e.g. a `git archive` of
// the template's backend branch). Skipped, not failed, when it is unset or the template predates the backend.
const REAL = process.env.CMP_REAL_TEMPLATE_DIR;
const HAS_TEMPLATE = Boolean(REAL) && fs.existsSync(path.join(REAL, 'server', 'build.gradle.kts'))
    && fs.existsSync(path.join(REAL, 'blank', 'layers')) && fs.existsSync(path.join(REAL, 'feature', 'sample'));
const NO_TEMPLATE = { skip: REAL ? `no backend template at CMP_REAL_TEMPLATE_DIR (${REAL})` : 'CMP_REAL_TEMPLATE_DIR is not set' };
const OPTIONS = HAS_TEMPLATE ? {} : NO_TEMPLATE;

// What the template's sync (updateTemplate) keeps out of the template: an upstream archive still has them
const MAINTAINER_ONLY = ['gradle/wizard.gradle.kts', 'MAINTAINING.md', 'scripts/ios-add-packages.rb', 'scripts-maintainer'];
const PBXPROJ = 'iosApp/iosApp.xcodeproj/project.pbxproj';
const PACKAGE_RESOLVED = 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
const GMA_PINS = ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform'];

async function generate(t, request) {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-real-'));
    t.after(() => fs.remove(projectDir));
    await fs.copy(REAL, projectDir, {
        filter: (src) => {
            const rel = path.relative(REAL, src).split(path.sep).join('/');
            return !MAINTAINER_ONLY.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));
        }
    });
    const { ok, value, error } = validate({ appName: 'Demo App', minSdk: '24', iosVersion: '16.0', ...request });
    assert.ok(ok, error);
    await generateCmpProject(value, { projectDir, generatorVersion: 'test' });
    return projectDir;
}

const read = (projectDir, rel) => fs.readFile(path.join(projectDir, rel), 'utf8');
const tokenLabel = (token) => (typeof token === 'string' ? token : token.label);
const tokenFound = (content, token) => (typeof token === 'string' ? content.includes(token) : token.regex.test(content));

// Every residue token in every text file (.gitignore too); the project's own names spell none of them
async function residue(projectDir) {
    const found = [];
    const files = [...await listTextFiles(projectDir), path.join(projectDir, '.gitignore')];
    for (const file of files) {
        if (!(await fs.pathExists(file))) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const token of BACKEND_RESIDUE_TOKENS) {
            if (tokenFound(content, token)) found.push(`${path.relative(projectDir, file)}: ${tokenLabel(token)}`);
        }
    }
    return found;
}

async function assertBackendOff(projectDir) {
    assert.deepEqual(await residue(projectDir), []);
    for (const dir of ['server', 'core/api', 'core/auth', 'feature/account', 'feature/sharing']) {
        assert.equal(await fs.pathExists(path.join(projectDir, dir)), false, dir);
    }
    const pbxproj = await read(projectDir, PBXPROJ);
    assert.ok(pbxproj.includes('swift-package-manager-google-mobile-ads'), 'GMA package missing from project.pbxproj');
    assert.ok(!/firebase|GoogleSignIn/i.test(pbxproj), 'Firebase or GoogleSignIn left in project.pbxproj');
    const pins = JSON.parse(await read(projectDir, PACKAGE_RESOLVED)).pins.map((pin) => pin.identity);
    assert.deepEqual(pins.sort(), GMA_PINS);
}

test('real template, showcase: no backend part is left, GMA stays', OPTIONS, async (t) => {
    const projectDir = await generate(t, { projectName: 'Demo', packageName: 'com.example.demo', templateType: 'showcase' });
    await assertBackendOff(projectDir);
});

test('real template, blank with purchases and ads, backend off: no backend part is left, GMA stays', OPTIONS, async (t) => {
    const projectDir = await generate(t, {
        projectName: 'Demo', packageName: 'com.example.demo', templateType: 'blank',
        featuresConfig: { backend: false, purchases: true, ads: true }
    });
    await assertBackendOff(projectDir);
});

test('real template, blank with the backend and a custom module: server, modules, URL schemes and README', OPTIONS, async (t) => {
    const projectDir = await generate(t, {
        projectName: 'CloudList', packageName: 'com.example.cloudlist', templateType: 'blank',
        features: ['notesx'], featuresConfig: { backend: true }
    });

    // The local runner keeps its place: the local main class com.example.cloudlist.server.local.LocalMainKt
    const localMain = await read(projectDir, 'server/src/local/kotlin/com/example/cloudlist/server/local/LocalMain.kt');
    assert.match(localMain, /^package com\.example\.cloudlist\.server\.local$/m);
    assert.ok((await read(projectDir, 'server/build.gradle.kts')).includes('"com.example.cloudlist.server.local.LocalMainKt"'));

    // The app's scheme is the user's; the Google Sign-In scheme stays a build setting
    const plist = await read(projectDir, 'iosApp/iosApp/Info.plist');
    const firstScheme = plist.match(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>([^<]*)<\/string>/);
    assert.equal(firstScheme && firstScheme[1], 'cloudlist');
    assert.ok(plist.includes('<string>$(GOOGLE_REVERSED_CLIENT_ID)</string>'));

    const settings = await read(projectDir, 'settings.gradle.kts');
    for (const include of [':server', ':core:api', ':core:auth', ':feature:account:presentation', ':feature:sharing:presentation',
        ':feature:notesx:presentation']) {
        assert.ok(settings.includes(`"${include}"`), `${include} not included`);
    }
    const sharedBuild = await read(projectDir, 'shared/build.gradle.kts');
    assert.ok(sharedBuild.includes('projects.feature.notesx.presentation'));
    assert.ok(sharedBuild.includes('projects.feature.account.presentation'));
    const initKoin = await read(projectDir, 'shared/src/commonMain/kotlin/com/example/cloudlist/di/initKoin.kt');
    for (const module of ['NotesxPresentationModule', 'AuthModule', 'AccountModule', 'SharingModule']) {
        assert.match(initKoin, new RegExp(`\\b${module}\\b`), module);
    }

    // detekt is off: the server and core/api no longer apply its plugin
    for (const rel of ['server/build.gradle.kts', 'core/api/build.gradle.kts']) {
        assert.ok(!(await read(projectDir, rel)).includes('.detekt")'), rel);
    }
    // ... and nothing configures it there either (the server's build script would not compile)
    assert.ok(!/^\s*detekt\s*\{/m.test(await read(projectDir, 'server/build.gradle.kts')), 'server/build.gradle.kts configures detekt');

    // ads is off: Package.resolved keeps the backend's pins and loses only GMA and UMP
    const pins = JSON.parse(await read(projectDir, PACKAGE_RESOLVED)).pins.map((pin) => pin.identity);
    assert.ok(pins.includes('firebase-ios-sdk') && pins.includes('googlesignin-ios'), pins.join(', '));
    for (const gone of GMA_PINS) assert.ok(!pins.includes(gone), gone);

    const readme = await read(projectDir, 'README.md');
    assert.ok(readme.includes('- `:server`'), 'README does not list :server');
    assert.ok(readme.includes('- `:feature:notesx`'), 'README does not list the custom module');

    for (const file of await listTextFiles(projectDir)) {
        assert.ok(!(await fs.readFile(file, 'utf8')).includes('cmpose:backend'), path.relative(projectDir, file));
    }
});
