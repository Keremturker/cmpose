const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    escapeXmlText,
    escapeKotlinString,
    sanitizeXcconfigValue,
    replaceInContent,
    updateAppConfig,
    updateiOSConfigFiles,
    processBlankApp,
    setApiBaseUrls,
    setSchemeBuildableName
} = require('../src/fileService');

const OLD_PACKAGE = 'com.kturker.multiplatform';
const OLD_PROJECT = 'Multiplatform';
const NEW_PACKAGE = 'dev.cmpose.app';
const SDK = { minSdk: '24', iosVersion: '15.0' };

// iosApp/Configuration/Config.xcconfig as shipped in the template
const TEMPLATE_XCCONFIG = [
    'TEAM_ID=',
    '',
    'PRODUCT_NAME=ComposeMultiplatform',
    'PRODUCT_BUNDLE_IDENTIFIER=com.kturker.composemultiplatform.ComposeMultiplatform',
    '',
    'CURRENT_PROJECT_VERSION=1',
    'MARKETING_VERSION=1.0',
    'OTHER_LDFLAGS = $(inherited) -lsqlite3'
].join('\n');

// build-logic/src/main/kotlin/config/AppConfig.kt (relevant part)
const TEMPLATE_APP_CONFIG = [
    'object AppConfig {',
    '    const val applicationId = "com.kturker.multiplatform"',
    '    const val appName = "Multiplatform"',
    '    const val compileSdkVersion = 36',
    '    const val minSdkVersion = 30',
    '    const val targetSdkVersion = 36',
    '}'
].join('\n');

const TEMPLATE_STRINGS_XML = '<resources>\n    <string name="app_name">Multiplatform</string>\n</resources>';

function linesStartingWith(content, prefix) {
    return content.split('\n').filter(line => line.startsWith(prefix));
}

function rewrite(content, appName = 'My App') {
    return replaceInContent(content, OLD_PACKAGE, NEW_PACKAGE, OLD_PROJECT, 'MyApp', appName, SDK);
}

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-escape-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// --- Escape helpers ---------------------------------------------------------

test('escapeXmlText encodes XML specials and escapes the apostrophe for Android', () => {
    assert.equal(escapeXmlText('R&D <Tom\'s>'), 'R&amp;D &lt;Tom\\\'s&gt;');
    assert.equal(escapeXmlText('say "hi"'), 'say &quot;hi&quot;');
});

test('escapeKotlinString escapes backslash, double quote and dollar', () => {
    assert.equal(escapeKotlinString('a"$b\\'), 'a\\"\\$b\\\\');
});

test('sanitizeXcconfigValue turns line breaks into spaces', () => {
    assert.equal(sanitizeXcconfigValue('My\nApp\r\nName\rX'), 'My App Name X');
});

test('escape helpers are no-ops for ordinary wizard values', () => {
    for (const value of ['My App', 'MyApp 2', 'dev.cmpose.app', '24', '15.0', 'https://api.example.com/v1']) {
        assert.equal(escapeXmlText(value), value);
        assert.equal(escapeKotlinString(value), value);
        assert.equal(sanitizeXcconfigValue(value), value);
    }
});

// --- iOS bundle identifier (single pass) ------------------------------------

test('replaceInContent writes exactly one bundle id line into the template xcconfig', () => {
    const out = rewrite(TEMPLATE_XCCONFIG);

    assert.deepEqual(linesStartingWith(out, 'PRODUCT_BUNDLE_IDENTIFIER'), [
        'PRODUCT_BUNDLE_IDENTIFIER=dev.cmpose.app'
    ]);
    assert.deepEqual(linesStartingWith(out, 'PRODUCT_NAME'), ['PRODUCT_NAME=My App']);
    // Untouched lines stay as they were
    assert.match(out, /^OTHER_LDFLAGS = \$\(inherited\) -lsqlite3$/m);
    assert.match(out, /^TEAM_ID=$/m);
});

// TEAM_ID picks the signing team only: Firebase, App Store Connect and Sign in with Apple need the bare bundle id
test('replaceInContent drops the $(TEAM_ID) suffix of a template from before template-2026.10.16.3', () => {
    const out = rewrite('PRODUCT_BUNDLE_IDENTIFIER=com.kturker.composemultiplatform.ComposeMultiplatform$(TEAM_ID)\nTEAM_ID=');
    assert.deepEqual(linesStartingWith(out, 'PRODUCT_BUNDLE_IDENTIFIER'), [
        'PRODUCT_BUNDLE_IDENTIFIER=dev.cmpose.app'
    ]);
});

test('replaceInContent bundle id rewrite is idempotent', () => {
    const once = rewrite(TEMPLATE_XCCONFIG);
    assert.equal(rewrite(once), once);
});

test('replaceInContent writes the bundle id without $(TEAM_ID) when the line lacks it', () => {
    const out = rewrite('PRODUCT_BUNDLE_IDENTIFIER = com.old.App\nTEAM_ID=');
    assert.deepEqual(linesStartingWith(out, 'PRODUCT_BUNDLE_IDENTIFIER'), [
        'PRODUCT_BUNDLE_IDENTIFIER=dev.cmpose.app'
    ]);
});

test('updateiOSConfigFiles after replaceInContent keeps a single bundle id line (pipeline order)', async () => {
    await withTempDir(async (dir) => {
        const configDir = path.join(dir, 'iosApp', 'Configuration');
        await fs.ensureDir(configDir);
        const file = path.join(configDir, 'Config.xcconfig');
        await fs.writeFile(file, rewrite(TEMPLATE_XCCONFIG));

        await updateiOSConfigFiles(dir, NEW_PACKAGE, 'My App', '15.0');

        const out = await fs.readFile(file, 'utf8');
        assert.deepEqual(linesStartingWith(out, 'PRODUCT_BUNDLE_IDENTIFIER'), [
            'PRODUCT_BUNDLE_IDENTIFIER=dev.cmpose.app'
        ]);
        assert.deepEqual(linesStartingWith(out, 'PRODUCT_NAME'), ['PRODUCT_NAME=My App']);
    });
});

test('updateiOSConfigFiles writes the bundle id without $(TEAM_ID) when the file has none', async () => {
    await withTempDir(async (dir) => {
        const configDir = path.join(dir, 'iosApp', 'Configuration');
        await fs.ensureDir(configDir);
        const file = path.join(configDir, 'Config.xcconfig');
        await fs.writeFile(file, 'PRODUCT_NAME=Old\nPRODUCT_BUNDLE_IDENTIFIER = com.old.App\n');

        await updateiOSConfigFiles(dir, NEW_PACKAGE, 'My App', '15.0');

        const out = await fs.readFile(file, 'utf8');
        assert.deepEqual(linesStartingWith(out, 'PRODUCT_BUNDLE_IDENTIFIER'), [
            'PRODUCT_BUNDLE_IDENTIFIER=dev.cmpose.app'
        ]);
    });
});

// --- Per-target escaping at the write sites ---------------------------------

test('strings.xml app_name is XML/Android escaped', () => {
    const out = rewrite(TEMPLATE_STRINGS_XML, 'Tom\'s App');
    assert.match(out, /<string name="app_name">Tom\\'s App<\/string>/);
});

test('AppConfig.kt appName is Kotlin-string escaped', () => {
    const out = updateAppConfig(TEMPLATE_APP_CONFIG, NEW_PACKAGE, 'Say "hi" $x', SDK);
    assert.ok(out.includes('const val appName = "Say \\"hi\\" \\$x"'), out);
    assert.ok(out.includes('const val applicationId = "dev.cmpose.app"'), out);
    assert.ok(out.includes('const val minSdkVersion = 24'), out);
});

test('xcconfig PRODUCT_NAME has line breaks flattened', () => {
    const out = rewrite(TEMPLATE_XCCONFIG, 'My\nApp');
    assert.deepEqual(linesStartingWith(out, 'PRODUCT_NAME'), ['PRODUCT_NAME=My App']);
});

test('$& and $1 in an app name are inserted literally, never expanded', () => {
    const appName = 'A$&B $1';
    const out = rewrite(TEMPLATE_STRINGS_XML + '\n' + TEMPLATE_XCCONFIG, appName);

    assert.ok(out.includes('<string name="app_name">A$&amp;B $1</string>'), out);
    assert.deepEqual(linesStartingWith(out, 'PRODUCT_NAME'), ['PRODUCT_NAME=A$&B $1']);

    const appConfig = updateAppConfig(TEMPLATE_APP_CONFIG, NEW_PACKAGE, appName, SDK);
    assert.ok(appConfig.includes('const val appName = "A\\$&B \\$1"'), appConfig);
});

test('ordinary wizard values produce the same package/sdk rewrites as before', () => {
    const src = [
        'package com.kturker.multiplatform.core',
        'import com.kturker.multiplatform.core.Foo',
        'id = "com.kturker.multiplatform.feature"',
        '@ComponentScan("com.kturker.multiplatform.core.network")',
        'applicationId = "com.kturker.multiplatform"',
        'rootProject.name = "Multiplatform"',
        'android-minSdk = "30"',
        'minSdk = 30'
    ].join('\n');

    assert.equal(rewrite(src), [
        'package dev.cmpose.app.core',
        'import dev.cmpose.app.core.Foo',
        'id = "dev.cmpose.app.feature"',
        '@ComponentScan("dev.cmpose.app.core.network")',
        'applicationId = "dev.cmpose.app"',
        'rootProject.name = "MyApp"',
        'android-minSdk = "24"',
        'minSdk = 24'
    ].join('\n'));
});

// --- Network base URL -------------------------------------------------------

async function runBlankNetwork(networkBaseUrl) {
    return withTempDir(async (dir) => {
        const packagePath = NEW_PACKAGE.replace(/\./g, '/');
        const diDir = path.join(dir, 'core', 'network', 'src', 'commonMain', 'kotlin', packagePath, 'core', 'network', 'di');
        await fs.ensureDir(diDir);
        await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath));
        const file = path.join(diDir, 'NetworkModule.kt');
        await fs.writeFile(file, 'defaultRequest {\n    url("https://api.github.com/")\n}\n');

        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: true,
            networkInspector: true,
            networkBaseUrl,
            theming: true,
            multiLang: true,
            dataStore: true,
            detekt: true
        });

        return fs.readFile(file, 'utf8');
    });
}

test('NetworkModule url("...") gets the base URL unchanged when it is ordinary', async (t) => {
    t.mock.method(console, 'log', () => { });
    const out = await runBlankNetwork('https://api.example.com/v1');
    assert.ok(out.includes('url("https://api.example.com/v1")'), out);
});

test('NetworkModule url("...") is Kotlin-string escaped and never expands $&', async (t) => {
    t.mock.method(console, 'log', () => { });
    const out = await runBlankNetwork('https://x.com/"+evil+"$&');
    assert.ok(out.includes('url("https://x.com/\\"+evil+\\"\\$&")'), out);
});

// --- compile/target SDK stay as the template has them -----------------------

test('updateAppConfig keeps the template compile/target SDK and writes only minSdk', () => {
    const template = TEMPLATE_APP_CONFIG
        .replace('compileSdkVersion = 36', 'compileSdkVersion = 37')
        .replace('targetSdkVersion = 36', 'targetSdkVersion = 37');

    const out = updateAppConfig(template, NEW_PACKAGE, 'My App', { minSdk: '24', iosVersion: '15.0' });

    assert.ok(out.includes('const val compileSdkVersion = 37'), out);
    assert.ok(out.includes('const val targetSdkVersion = 37'), out);
    assert.ok(out.includes('const val minSdkVersion = 24'), out);
});

test('replaceInContent leaves compileSdk/targetSdk literals alone', () => {
    const src = ['android-compileSdk = "37"', 'android-targetSdk = "37"', 'android-minSdk = "30"',
        'compileSdk = 37', 'targetSdk = 37', 'minSdk = 30'].join('\n');

    const out = replaceInContent(src, OLD_PACKAGE, NEW_PACKAGE, OLD_PROJECT, 'MyApp', 'My App',
        { minSdk: '24', iosVersion: '15.0' });

    assert.equal(out, ['android-compileSdk = "37"', 'android-targetSdk = "37"', 'android-minSdk = "24"',
        'compileSdk = 37', 'targetSdk = 37', 'minSdk = 24'].join('\n'));
});

// --- base URL into ApiConfig.kt ---------------------------------------------

const TEMPLATE_API_CONFIG = [
    'object ApiConfig {',
    '    const val DEBUG_BASE_URL = "https://api.github.com/"',
    '    const val RELEASE_BASE_URL = "https://api.github.com/"',
    '}'
].join('\n');

test('setApiBaseUrls writes the URL into both constants', () => {
    const out = setApiBaseUrls(TEMPLATE_API_CONFIG, 'https://api.example.com/v1/');

    assert.ok(out.includes('const val DEBUG_BASE_URL = "https://api.example.com/v1/"'), out);
    assert.ok(out.includes('const val RELEASE_BASE_URL = "https://api.example.com/v1/"'), out);
});

test('setApiBaseUrls escapes Kotlin strings and never expands $&', () => {
    const out = setApiBaseUrls(TEMPLATE_API_CONFIG, 'https://x.dev/a"b$&c');

    assert.equal((out.match(/= "https:\/\/x\.dev\/a\\"b\\\$&c"/g) || []).length, 2, out);
});

test('setApiBaseUrls with an empty URL clears both constants', () => {
    const out = setApiBaseUrls(TEMPLATE_API_CONFIG, '');

    assert.equal((out.match(/_BASE_URL = ""/g) || []).length, 2, out);
});

async function runBlankNetworkWithApiConfig(networkBaseUrl) {
    return withTempDir(async (dir) => {
        const pkgPath = NEW_PACKAGE.replace(/\./g, '/');
        const netDir = path.join(dir, 'core', 'network', 'src', 'commonMain', 'kotlin', pkgPath, 'core', 'network');
        const apiConfig = path.join(netDir, 'ApiConfig.kt');
        const networkModule = path.join(netDir, 'di', 'NetworkModule.kt');
        await fs.outputFile(apiConfig, TEMPLATE_API_CONFIG);
        await fs.outputFile(networkModule, 'defaultRequest {\n    url(ApiConfig.baseUrl(environment))\n}\n');
        await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', pkgPath));
        await processBlankApp(dir, NEW_PACKAGE, [], {
            network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true,
            networkBaseUrl
        });
        return { apiConfig: await fs.readFile(apiConfig, 'utf8'), networkModule: await fs.readFile(networkModule, 'utf8') };
    });
}

test('blank + network writes the wizard base URL into ApiConfig.kt and leaves NetworkModule alone', async (t) => {
    t.mock.method(console, 'log', () => { });
    const { apiConfig, networkModule } = await runBlankNetworkWithApiConfig('https://api.example.com/v1/');

    assert.equal((apiConfig.match(/"https:\/\/api\.example\.com\/v1\/"/g) || []).length, 2, apiConfig);
    assert.ok(networkModule.includes('url(ApiConfig.baseUrl(environment))'), networkModule);
});

test('the shared scheme names the product the generator renamed', () => {
    const xml = '<BuildableReference\n BuildableName = "ComposeMultiplatform.app"\n BlueprintName = "iosApp">';
    assert.equal(setSchemeBuildableName(xml + xml, 'My App & Co'),
        ('<BuildableReference\n BuildableName = "My App &amp; Co.app"\n BlueprintName = "iosApp">').repeat(2));
});

test('updateiOSConfigFiles rewrites the shared scheme when present and tolerates its absence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheme-'));
    try {
        await updateiOSConfigFiles(dir, NEW_PACKAGE, 'X', '15.0'); // no iosApp at all
        const schemeDir = path.join(dir, 'iosApp/iosApp.xcodeproj/xcshareddata/xcschemes');
        await fs.ensureDir(schemeDir);
        await fs.writeFile(path.join(schemeDir, 'iosApp.xcscheme'), 'BuildableName = "ComposeMultiplatform.app"');
        await updateiOSConfigFiles(dir, NEW_PACKAGE, 'Tom\'s Notes', '15.0');
        assert.equal(await fs.readFile(path.join(schemeDir, 'iosApp.xcscheme'), 'utf8'), 'BuildableName = "Tom\'s Notes.app"');
    } finally {
        await fs.remove(dir);
    }
});

// --- core/logging: LOG_TAG_PREFIX -------------------------------------------

// core/logging/.../LoggingConfig.kt (relevant line) next to another "Multiplatform" string
const TEMPLATE_LOGGING_CONFIG = [
    'package com.kturker.multiplatform.core.logging',
    '',
    'internal const val LOG_TAG_PREFIX = "Multiplatform"',
    '',
    'val title = "Multiplatform"'
].join('\n');

test('replaceInContent writes the project name into LOG_TAG_PREFIX', () => {
    const out = rewrite(TEMPLATE_LOGGING_CONFIG);
    assert.deepEqual(linesStartingWith(out, 'internal const val LOG_TAG_PREFIX'), ['internal const val LOG_TAG_PREFIX = "MyApp"']);
});

test('replaceInContent leaves any other "Multiplatform" string alone', () => {
    const out = rewrite(TEMPLATE_LOGGING_CONFIG);
    assert.deepEqual(linesStartingWith(out, 'val title'), ['val title = "Multiplatform"']);
});

test('replaceInContent keeps LOG_TAG_PREFIX when the project name is unchanged', () => {
    const out = replaceInContent(TEMPLATE_LOGGING_CONFIG, OLD_PACKAGE, OLD_PACKAGE, OLD_PROJECT, OLD_PROJECT, null, SDK);
    assert.equal(out, TEMPLATE_LOGGING_CONFIG);
});

// --- Deep links: the scheme is the project's name in lower case -------------

const SAME_PACKAGE = (content, newProject = 'MyApp') =>
    replaceInContent(content, OLD_PACKAGE, OLD_PACKAGE, OLD_PROJECT, newProject, null, SDK);

test('replaceInContent writes the lower-case project name into DEEP_LINK_SCHEME', () => {
    const out = SAME_PACKAGE('const val DEEP_LINK_SCHEME = "multiplatform"\nconst val APP_LINK_HOST = ""');
    assert.equal(out, 'const val DEEP_LINK_SCHEME = "myapp"\nconst val APP_LINK_HOST = ""');
});

test('replaceInContent writes the scheme into the manifest and leaves https alone', () => {
    const out = SAME_PACKAGE('<data android:scheme="multiplatform" />\n<data android:scheme="https" />');
    assert.equal(out, '<data android:scheme="myapp" />\n<data android:scheme="https" />');
});

test('replaceInContent writes the scheme into CFBundleURLSchemes and leaves the bundle id alone', () => {
    const plist = [
        '<key>CFBundleURLName</key>',
        '<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
        '<key>CFBundleURLSchemes</key>',
        '<array>',
        '<string>multiplatform</string>',
        '</array>'
    ].join('\n');
    const out = SAME_PACKAGE(plist);
    assert.equal(out, plist.replace('<string>multiplatform</string>', '<string>myapp</string>'));
});

test('replaceInContent writes the scheme into multiplatform:// links only', () => {
    const text = [
        'Open multiplatform://user/octocat to see a profile.',
        'package com.kturker.multiplatform.core.navigation',
        'rootProject.name = "Multiplatform"'
    ].join('\n');
    const out = SAME_PACKAGE(text);
    assert.equal(out, [
        'Open myapp://user/octocat to see a profile.',
        'package com.kturker.multiplatform.core.navigation',
        'rootProject.name = "MyApp"'
    ].join('\n'));
});

test('replaceInContent keeps the scheme when the project name is unchanged', () => {
    const text = 'const val DEEP_LINK_SCHEME = "multiplatform"\n<data android:scheme="multiplatform" />\nmultiplatform://settings';
    assert.equal(SAME_PACKAGE(text, OLD_PROJECT), text);
});

test('replaceInContent renames the package as a whole name anywhere: a main class, a logger name, a plugin id, a KDoc link', () => {
    const src = [
        `application { mainClass.set("${OLD_PACKAGE}.server.MainKt") }`,
        `    id("${OLD_PACKAGE}.detekt")`,
        `val log = LoggerFactory.getLogger("${OLD_PACKAGE}.server.auth.FirebaseAuth")`,
        `/** Holds a [${OLD_PACKAGE}.core.api.Role]. */`
    ].join('\n');
    assert.equal(rewrite(src), src.split(OLD_PACKAGE).join(NEW_PACKAGE));
    // A longer name, or the package as a later segment of another one, is not the package
    for (const other of [`${OLD_PACKAGE}x.a`, `dev.${OLD_PACKAGE}.a`, `my${OLD_PACKAGE}`]) {
        assert.equal(rewrite(`val s = "${other}"`), `val s = "${other}"`);
    }
});
