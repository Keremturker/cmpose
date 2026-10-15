const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processBlankApp, assertNoNetworkMonitorResidue } = require('../src/fileService');

// Relevant files of the two template shapes: old = the template before the network monitor moved
// into core/network, new = the template after that move. Extracted from the template's history.
const FIXTURES = path.join(__dirname, 'fixtures', 'network-monitor');
const TEMPLATE_PACKAGE = 'com.kturker.multiplatform';
const NEW_PACKAGE = 'dev.cmpose.app';

const INSPECTOR_OFF = { network: true, networkInspector: false, theming: true, multiLang: true, dataStore: true, detekt: true };
const INSPECTOR_ON = { ...INSPECTOR_OFF, networkInspector: true };

// Where each fixture lands in a generated project, after the package move.
function layout(pkgPath) {
    return {
        'MainActivity.kt': ['androidApp', 'src', 'main', 'kotlin', pkgPath, 'MainActivity.kt'],
        'AndroidManifest.xml': ['androidApp', 'src', 'main', 'AndroidManifest.xml'],
        'NetworkModule.kt': ['core', 'network', 'src', 'commonMain', 'kotlin', pkgPath, 'core', 'network', 'di', 'NetworkModule.kt'],
        'NetworkMonitor.kt': ['core', 'network', 'src', 'commonMain', 'kotlin', pkgPath, 'core', 'network', 'NetworkMonitor.kt'],
        'NetworkMonitor.android.kt': ['core', 'network', 'src', 'androidMain', 'kotlin', pkgPath, 'core', 'network', 'NetworkMonitor.android.kt'],
        'NetworkMonitor.ios.kt': ['core', 'network', 'src', 'iosMain', 'kotlin', pkgPath, 'core', 'network', 'NetworkMonitor.ios.kt'],
        'core-network.build.gradle.kts': ['core', 'network', 'build.gradle.kts'],
        'androidApp.build.gradle.kts': ['androidApp', 'build.gradle.kts'],
        'ContentView.swift': ['iosApp', 'iosApp', 'ContentView.swift'],
        'Info.plist': ['iosApp', 'iosApp', 'Info.plist'],
        'Config.xcconfig': ['iosApp', 'Configuration', 'Config.xcconfig'],
        'libs.versions.toml': ['gradle', 'libs.versions.toml']
    };
}

// Places one template shape into `dir` the way the generator leaves it right before
// processBlankApp: files at their package-moved paths, package strings rewritten.
// Returns { name: { path, input } } for the files that exist in that shape.
async function placeShape(dir, shape, packageName = NEW_PACKAGE) {
    const pkgPath = packageName.replace(/\./g, '/');

    // With no custom modules (features:[]), processBlankApp writes shared/.../MainScreen.kt
    // directly without ensureDir; a real template copy already has this directory, so that is
    // fine, but this isolated fixture set has to create it here
    // (see fileService.blank.test.js: setupDesignSystemFixture, same reason).
    await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', pkgPath));

    const placed = {};
    for (const [name, rel] of Object.entries(layout(pkgPath))) {
        const src = path.join(FIXTURES, shape, name);
        if (!(await fs.pathExists(src))) continue;
        const input = (await fs.readFile(src, 'utf8')).split(TEMPLATE_PACKAGE).join(packageName);
        const dest = path.join(dir, ...rel);
        await fs.outputFile(dest, input);
        placed[name] = { path: dest, input };
    }
    return placed;
}

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-monitor-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

const read = (file) => fs.readFile(file.path, 'utf8');
const count = (s, ch) => s.split(ch).length - 1;
function assertBalanced(name, content) {
    assert.equal(count(content, '{'), count(content, '}'), `${name}: unbalanced braces:\n${content}`);
}

// Guarantees shared by both shapes once the inspector is off
async function assertInspectorRemoved(placed) {
    const mainActivity = await read(placed['MainActivity.kt']);
    for (const token of ['requestNotificationPermission', 'NOTIFICATION_PERMISSION_REQUEST_CODE', 'import android.Manifest', 'ApplicationInfo']) {
        assert.ok(!mainActivity.includes(token), `MainActivity.kt must not contain ${token}:\n${mainActivity}`);
    }
    assert.ok(mainActivity.includes('setContent {') && mainActivity.includes('enableEdgeToEdge()'), mainActivity);
    assertBalanced('MainActivity.kt', mainActivity);
    // compass-kit's NoBlankLineBeforeRbrace: the removed call must not leave a blank line before a "}"
    assert.doesNotMatch(mainActivity, /\n[ \t]*\n[ \t]*\}/, `MainActivity.kt has a blank line before "}":\n${mainActivity}`);

    const manifest = await read(placed['AndroidManifest.xml']);
    assert.ok(!manifest.includes('POST_NOTIFICATIONS'), manifest);
    assert.ok(manifest.includes('android.permission.INTERNET'), manifest);

    const networkModule = await read(placed['NetworkModule.kt']);
    for (const token of ['MonitorLogging', 'installNetworkMonitor']) {
        assert.ok(!networkModule.includes(token), `NetworkModule.kt must not contain ${token}:\n${networkModule}`);
    }
    assert.ok(networkModule.includes('install(HttpTimeout)') && networkModule.includes('install(ContentNegotiation)'), networkModule);
    assertBalanced('NetworkModule.kt', networkModule);

    const coreNetworkBuild = await read(placed['core-network.build.gradle.kts']);
    assert.ok(!/networkMonitor|Network monitor|networkmonitor/.test(coreNetworkBuild), coreNetworkBuild);
    assert.ok(coreNetworkBuild.includes('implementation(libs.ktor.client.core)'), coreNetworkBuild);

    const appBuild = await read(placed['androidApp.build.gradle.kts']);
    assert.ok(!/networkmonitor|networkMonitor|Network monitor/.test(appBuild), appBuild);
    assert.ok(appBuild.includes('implementation(libs.koin.android)'), appBuild);

    const contentView = await read(placed['ContentView.swift']);
    for (const token of ['requestNotificationPermission', 'import UserNotifications', '#if DEBUG', '#endif']) {
        assert.ok(!contentView.includes(token), `ContentView.swift must not contain ${token}:\n${contentView}`);
    }
    assertBalanced('ContentView.swift', contentView);

    assert.ok(!(await read(placed['Info.plist'])).includes('NSUserNotificationUsageDescription'));
    assert.ok(!(await read(placed['Config.xcconfig'])).includes('-lsqlite3'));
    const toml = await read(placed['libs.versions.toml']);
    assert.ok(!/^\s*networkMonitor(?:-debug|-release)?\s*=/m.test(toml), toml);
}

test('new shape, inspector off: monitor files are deleted and every reference is removed', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        for (const name of ['NetworkMonitor.kt', 'NetworkMonitor.android.kt', 'NetworkMonitor.ios.kt']) {
            assert.equal(await fs.pathExists(placed[name].path), false, `${name} must be deleted`);
        }
        await assertInspectorRemoved(placed);

        // androidApp/build.gradle.kts: exactly the part before the no-op block survives
        const appInput = placed['androidApp.build.gradle.kts'].input;
        const expectedApp = appInput.slice(0, appInput.indexOf('// Network monitor: release builds')).replace(/\n+$/, '\n');
        assert.equal(await read(placed['androidApp.build.gradle.kts']), expectedApp);

        // The removed call leaves no blank line right before a closing brace
        const networkModule = await read(placed['NetworkModule.kt']);
        assert.ok(!/\n[ \t]*\n[ \t]*\}/.test(networkModule), `blank line before a closing brace:\n${networkModule}`);
        // The template no longer has a blank line between
        // the json serialization line (viewmodelCompose was removed) and the network-monitor comment,
        // so once the comment + debug implementation lines are filtered out, that line is directly followed by
        // commonMain dependencies' closing brace - no leftover blank line.
        const coreNetworkBuild = await read(placed['core-network.build.gradle.kts']);
        assert.ok(
            /kotlinx\.json\)\n[ \t]*\}/.test(coreNetworkBuild),
            `blank line between the last dependency and the closing brace:\n${coreNetworkBuild}`
        );
        const contentView = await read(placed['ContentView.swift']);
        assert.ok(contentView.includes('ComposeView()') && contentView.includes('.ignoresSafeArea()'), contentView);
    });
});

test('old shape, inspector off: every reference is removed', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'old');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);
        await assertInspectorRemoved(placed);
        assert.ok((await read(placed['ContentView.swift'])).includes('IosThemeObserver'));
    });
});

test('new shape, inspector on: the monitor code is kept', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_ON);
        // Nothing else edits the helper files; other files may be edited for unrelated reasons
        // (e.g. network on clears NetworkModule's base URL), so check the monitor lines there.
        for (const name of ['NetworkMonitor.kt', 'NetworkMonitor.android.kt', 'NetworkMonitor.ios.kt']) {
            assert.equal(await read(placed[name]), placed[name].input, `${name} must be unchanged`);
        }
        const expectations = {
            'NetworkModule.kt': ['installNetworkMonitor()', `import ${NEW_PACKAGE}.core.network.installNetworkMonitor`],
            'androidApp.build.gradle.kts': ['// Network monitor: release builds', 'com.kturker:networkmonitor-noop'],
            'core-network.build.gradle.kts': ['// Network monitor: release APKs swap in', 'implementation(libs.networkMonitor.debug)'],
            'MainActivity.kt': ['requestNotificationPermission()', 'ApplicationInfo.FLAG_DEBUGGABLE'],
            'ContentView.swift': ['requestNotificationPermission()', '#if DEBUG', 'import UserNotifications'],
            'Config.xcconfig': ['-lsqlite3'],
            'libs.versions.toml': ['com.kturker:networkmonitor"', 'com.kturker:networkmonitor-noop"']
        };
        for (const [name, tokens] of Object.entries(expectations)) {
            const content = await read(placed[name]);
            for (const token of tokens) assert.ok(content.includes(token), `${name} must keep ${token}:\n${content}`);
        }
    });
});

test('new shape, theming off + inspector off: the inspector .task block goes, ContentView has no theme code (B) and stays well-formed', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], { ...INSPECTOR_OFF, theming: false, multiLang: false, dataStore: false });
        const contentView = await read(placed['ContentView.swift']);
        for (const token of ['requestNotificationPermission', 'IosThemeObserver', 'colorScheme', '#if DEBUG', '#endif', 'import UserNotifications']) {
            assert.ok(!contentView.includes(token), `ContentView.swift must not contain ${token}:\n${contentView}`);
        }
        assert.ok(contentView.includes('ComposeView()') && contentView.includes('.ignoresSafeArea()'), contentView);
        assertBalanced('ContentView.swift', contentView);
    });
});

test('a monitor reference the removal does not know about makes processBlankApp reject, naming file and token', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await placeShape(dir, 'new');
        const leak = path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'cmpose', 'app', 'Leak.kt');
        await fs.outputFile(leak, 'package dev.cmpose.app\n\nimport com.kturker.networkmonitor.MonitorLogging\n');
        await assert.rejects(
            processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF),
            /Network monitor residue[\s\S]*Leak\.kt: com\.kturker\.networkmonitor\.MonitorLogging/
        );
    });
});

test('an anchor miss in a known file is caught (ContentView function in an unexpected shape)', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const contentView = placed['ContentView.swift'];
        await fs.writeFile(contentView.path, contentView.input.replace(/error in\s*\}/, 'error in print(granted) }'));
        await assert.rejects(
            processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF),
            /ContentView\.swift: requestNotificationPermission/
        );
    });
});

test('package containing "networkmonitor" and project named MonitorLogging are not residue', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const pkg = 'com.kturker.networkmonitor.app';
        const placed = await placeShape(dir, 'new', pkg);
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "MonitorLogging"\n');
        await processBlankApp(dir, pkg, [], INSPECTOR_OFF);
        const networkModule = await read(placed['NetworkModule.kt']);
        assert.ok(!networkModule.includes('installNetworkMonitor'), networkModule);
        await assertNoNetworkMonitorResidue(dir, pkg);
    });
});

test('assertNoNetworkMonitorResidue passes on both shapes after removal', async (t) => {
    t.mock.method(console, 'log', () => { });
    for (const shape of ['old', 'new']) {
        await withTempDir(async (dir) => {
            await placeShape(dir, shape);
            await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);
            await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
        });
    }
});

// appName (ProjectValidator.js, /^[\p{L}\p{M}\p{N} ._'-]+$/u,
// <=30 chars) is user input written into strings.xml, Info.plist, Config.xcconfig and a Kotlin
// `const val appName = "..."`. A valid appName can coincidentally look like a monitor token
// ("libs.networkMonitor", "Tools -lsqlite3"); those must never trip the residue check.
test('valid appName values that look like monitor tokens are not residue', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        await fs.outputFile(
            path.join(dir, 'androidApp', 'src', 'main', 'res', 'values', 'strings.xml'),
            '<resources>\n    <string name="app_name">libs.networkMonitor.debug</string>\n</resources>\n'
        );
        await fs.appendFile(placed['Config.xcconfig'].path, 'PRODUCT_NAME=Tools -lsqlite3\n');
        await fs.outputFile(
            path.join(dir, 'build-logic', 'src', 'main', 'kotlin', 'config', 'AppConfig.kt'),
            'const val appName = "libs.networkMonitor"\n'
        );

        await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
    });
});

test('a Gradle reference to the monitor left anywhere is caught', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        await fs.outputFile(
            path.join(dir, 'feature', 'x', 'build.gradle.kts'),
            '    implementation(libs.networkMonitor.debug)\n'
        );

        await assert.rejects(
            assertNoNetworkMonitorResidue(dir, NEW_PACKAGE),
            /feature\/x\/build\.gradle\.kts: libs\.networkMonitor reference/
        );
    });
});

test('an OTHER_LDFLAGS line that still links sqlite is caught', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        await fs.appendFile(placed['Config.xcconfig'].path, 'OTHER_LDFLAGS = $(inherited) -lsqlite3\n');

        await assert.rejects(
            assertNoNetworkMonitorResidue(dir, NEW_PACKAGE),
            /Config\.xcconfig: -lsqlite3/
        );
    });
});

// Kermit: NetworkModule calls installRequestLogging right before installNetworkMonitor, and
// SENSITIVE_HEADERS moved to RequestLogging.kt; inspector off drops only the monitor
test('new shape with request logging, inspector off: installRequestLogging and RequestLogging.kt stay, the monitor goes', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const loggingImport = `import ${NEW_PACKAGE}.core.network.installRequestLogging`;
        const loggingCall = '        installRequestLogging(isDebug = environment.isDebug)';
        const networkModule = placed['NetworkModule.kt'];
        const withLogging = networkModule.input
            .replace(`import ${NEW_PACKAGE}.core.network.installNetworkMonitor\n`, `$&${loggingImport}\n`)
            .replace('        installNetworkMonitor()\n', `${loggingCall}\n$&`);
        assert.notEqual(withLogging, networkModule.input);
        await fs.writeFile(networkModule.path, withLogging);
        const requestLogging = path.join(path.dirname(placed['NetworkMonitor.kt'].path), 'RequestLogging.kt');
        const requestLoggingInput = [
            `package ${NEW_PACKAGE}.core.network`,
            '',
            'internal val SENSITIVE_HEADERS = listOf(',
            '    HttpHeaders.Authorization',
            ')',
            ''
        ].join('\n');
        await fs.outputFile(requestLogging, requestLoggingInput);

        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        const out = await read(networkModule);
        assert.ok(out.split('\n').includes(loggingImport), out);
        assert.ok(out.includes(`${loggingCall}\n    }\n}`), `installRequestLogging stays, right before the closing brace:\n${out}`);
        assert.ok(!out.includes('installNetworkMonitor'), out);
        assert.doesNotMatch(out, /\n[ \t]*\n[ \t]*\}/, `blank line before a closing brace:\n${out}`);
        assertBalanced('NetworkModule.kt', out);
        assert.equal(await fs.readFile(requestLogging, 'utf8'), requestLoggingInput);
        assert.equal(await fs.pathExists(placed['NetworkMonitor.kt'].path), false);
        await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
    });
});

// network-ux: provideConnectivityMonitor (and its comment) follows provideHttpClient; inspector off drops
// only installNetworkMonitor, the connectivity provider stays
test('new shape with the connectivity provider, inspector off: provideConnectivityMonitor and its comment stay', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const loggingImport = `import ${NEW_PACKAGE}.core.network.installRequestLogging`;
        const loggingCall = '        installRequestLogging(isDebug = environment.isDebug)';
        const providerComment = '    // Whether the device is online: the offline banner and the screens\' retry (core/domain ConnectivityMonitor)';
        const provider = '    fun provideConnectivityMonitor(): ConnectivityMonitor = createConnectivityMonitor()';
        const networkModule = placed['NetworkModule.kt'];
        const withConnectivity = networkModule.input
            .replace(`import ${NEW_PACKAGE}.core.network.installNetworkMonitor\n`, `$&${loggingImport}\n`)
            .replace('        installNetworkMonitor()\n', `${loggingCall}\n\n$&`)
            .replace(/\n    \}\n\}\n?$/, `\n    }\n\n${providerComment}\n    @Single\n${provider}\n}\n`);
        assert.ok(withConnectivity.includes(provider) && withConnectivity.includes(loggingCall), withConnectivity);
        await fs.writeFile(networkModule.path, withConnectivity);

        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        const out = await read(networkModule);
        const lines = out.split('\n');
        assert.ok(!out.includes('installNetworkMonitor'), out);
        assert.ok(out.includes(`${loggingCall}\n    }\n`), `installRequestLogging stays, right before the closing brace:\n${out}`);
        assert.ok(out.includes(`${providerComment}\n    @Single\n${provider}\n}`), `the provider and its comment stay:\n${out}`);
        assert.ok(lines.includes(loggingImport), out);
        assert.doesNotMatch(out, /\n[ \t]*\n[ \t]*\}/, `blank line before a closing brace:\n${out}`);
        assertBalanced('NetworkModule.kt', out);
        await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
    });
});

// Deep links: the link lines of onCreate, onNewIntent and the Intent import are not part of
// the inspector; turning it off removes only the notification permission code
test('new shape with deep links, inspector off: onNewIntent, both handleDeepLink calls and the Intent import stay', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const intentImport = 'import android.content.Intent';
        const linkComment = '        // A link that started the app; a recreated activity (rotation) has handled it already';
        const linkCall = '        if (savedInstanceState == null) intent?.dataString?.let(::handleDeepLink)';
        const onNewIntent = [
            '    // singleTask: a link while the app runs arrives here instead of starting a second activity',
            '    override fun onNewIntent(intent: Intent) {',
            '        super.onNewIntent(intent)',
            '        intent.dataString?.let(::handleDeepLink)',
            '    }'
        ].join('\n');
        const mainActivity = placed['MainActivity.kt'];
        const withLinks = mainActivity.input
            .replace('import android.Manifest\n', `$&${intentImport}\n`)
            .replace('        }\n\n        requestNotificationPermission()\n    }\n',
                `        }\n\n${linkComment}\n${linkCall}\n\n        requestNotificationPermission()\n    }\n\n${onNewIntent}\n`);
        assert.ok(withLinks.includes(onNewIntent) && withLinks.includes(linkCall) && withLinks.includes(intentImport), withLinks);
        await fs.writeFile(mainActivity.path, withLinks);

        await processBlankApp(dir, NEW_PACKAGE, [], INSPECTOR_OFF);

        const out = await read(mainActivity);
        const lines = out.split('\n');
        assert.ok(lines.includes(intentImport), out);
        assert.ok(out.includes(`        }\n\n${linkComment}\n${linkCall}\n    }\n\n${onNewIntent}\n}`), `the link lines stay where they were:\n${out}`);
        assert.equal(out.split('handleDeepLink').length - 1, 2, out);
        for (const token of ['requestNotificationPermission', 'ActivityCompat', 'NOTIFICATION_PERMISSION_REQUEST_CODE']) {
            assert.ok(!out.includes(token), `MainActivity.kt must not contain ${token}:\n${out}`);
        }
        assert.doesNotMatch(out, /\n[ \t]*\n[ \t]*\}/, `blank line before a closing brace:\n${out}`);
        assert.doesNotMatch(out, /\n[ \t]*\n[ \t]*\n/, `two blank lines in a row (ktlint):\n${out}`);
        assertBalanced('MainActivity.kt', out);
        await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
    });
});

test('processAllFiles fails when a file cannot be rewritten instead of skipping it', async () => {
    // The error message names the file's path RELATIVE TO THE PROJECT ROOT, not just its bare
    // basename - there are ~20 build.gradle.kts files across a generated project, so "Locked.kt"
    // alone would not say which one.
    const { processAllFiles } = require('../src/fileService');
    await withTempDir(async (dir) => {
        const nested = path.join(dir, 'feature', 'profile', 'presentation');
        await fs.ensureDir(nested);
        const locked = path.join(nested, 'Locked.kt');
        await fs.writeFile(locked, 'package com.kturker.multiplatform\n');
        await fs.chmod(locked, 0o444);
        try {
            await assert.rejects(
                processAllFiles(dir, 'com.kturker.multiplatform', 'dev.cmpose.app', 'Multiplatform', 'Demo', 'Demo', { minSdk: '24', iosVersion: '15.0' }),
                /Could not process feature\/profile\/presentation\/Locked\.kt/
            );
        } finally {
            await fs.chmod(locked, 0o644);
        }
    });
});

// Backend on: the backend's own client (BackendClient.kt) records its calls with the monitor in debug builds, and
// core/network's iOS test executable links SQLite only for the monitor; inspector off removes both
const BACKEND_NATIVE_BLOCK = '\n\n// The backend client (BackendClient.kt) keeps the network monitor, which stores calls through SQLiter and so\n' +
    '// the system SQLite. The app\'s link brings it in; this module\'s iOS test executable has to ask for it.\n' +
    'kotlin.targets.withType<org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget>().configureEach {\n' +
    '    binaries.withType<org.jetbrains.kotlin.gradle.plugin.mpp.TestExecutable>().configureEach {\n' +
    '        linkerOpts("-lsqlite3")\n' +
    '    }\n' +
    '}';

async function placeBackendClient(dir, placed) {
    const pkgPath = NEW_PACKAGE.replace(/\./g, '/');
    const client = path.join(dir, 'core', 'network', 'src', 'commonMain', 'kotlin', pkgPath, 'core', 'network', 'BackendClient.kt');
    const input = (await fs.readFile(path.join(FIXTURES, 'backend', 'BackendClient.kt'), 'utf8')).split(TEMPLATE_PACKAGE).join(NEW_PACKAGE);
    await fs.outputFile(client, input);
    const gradle = placed['core-network.build.gradle.kts'];
    await fs.writeFile(gradle.path, gradle.input.replace(/\n*$/, '') + BACKEND_NATIVE_BLOCK);
    return client;
}

test('backend on, inspector off: the backend client and the native test link drop the monitor', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const client = await placeBackendClient(dir, placed);
        await processBlankApp(dir, NEW_PACKAGE, [], { ...INSPECTOR_OFF, backend: true });
        const clientOut = await fs.readFile(client, 'utf8');
        assert.ok(!clientOut.includes('installNetworkMonitor') && !clientOut.includes('the monitor records'), clientOut);
        assert.ok(clientOut.includes('installRequestLogging(isDebug = isDebug)') && clientOut.includes('install(Auth)'), clientOut);
        assert.ok(/installRequestLogging\(isDebug = isDebug\)\n {4}\}\n\}/.test(clientOut), clientOut);
        const gradleOut = await read(placed['core-network.build.gradle.kts']);
        assert.ok(!gradleOut.includes('-lsqlite3') && !gradleOut.includes('KotlinNativeTarget'), gradleOut);
        await assertNoNetworkMonitorResidue(dir, NEW_PACKAGE);
    });
});

test('backend on, inspector on: the backend client keeps the monitor', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        const client = await placeBackendClient(dir, placed);
        await processBlankApp(dir, NEW_PACKAGE, [], { ...INSPECTOR_ON, backend: true });
        assert.ok((await fs.readFile(client, 'utf8')).includes('if (isDebug) installNetworkMonitor()'));
        assert.ok((await read(placed['core-network.build.gradle.kts'])).includes('linkerOpts("-lsqlite3")'));
    });
});

test('a monitor call left in the backend client is residue', async (t) => {
    t.mock.method(console, 'log', () => { });
    await withTempDir(async (dir) => {
        const placed = await placeShape(dir, 'new');
        await placeBackendClient(dir, placed);
        await assert.rejects(assertNoNetworkMonitorResidue(dir, NEW_PACKAGE), /BackendClient\.kt: installNetworkMonitor/);
    });
});
