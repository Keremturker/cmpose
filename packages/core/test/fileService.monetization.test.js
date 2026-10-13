const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const {
    processCoreFeatures,
    assertNoMonetizationResidue,
    stripAdsInfoPlist,
    stripAdsManifest,
    stripAdsBridgeRegistration
} = require('../src/fileService');

// The seed is the template after processAllFiles: the package is already dev.cmpose.app
const NEW_PACKAGE = 'dev.cmpose.app';
const PKG = 'dev/cmpose/app';
const PURCHASES_SRC = `core/purchases/src/commonMain/kotlin/${PKG}/core/purchases`;
const ADS_SRC = `core/ads/src/commonMain/kotlin/${PKG}/core/ads`;
const CONTRACT_SRC = `feature/monetization/contract/src/commonMain/kotlin/${PKG}/feature/monetization/contract`;
const PRESENTATION_SRC = `feature/monetization/presentation/src/commonMain/kotlin/${PKG}/feature/monetization/presentation`;
const PRESENTATION_TEST = `feature/monetization/presentation/src/commonTest/kotlin/${PKG}/feature/monetization/presentation`;
const INIT_KOIN = `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`;
const MAIN_SCREEN = `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`;
// blank/shared MainScreen.kt after the package move: the first-launch lines close it
const MAIN_SCREEN_CONTENT = [
    `package ${NEW_PACKAGE}`,
    '',
    `import ${NEW_PACKAGE}.core.update.AppUpdateEffect`,
    `import ${NEW_PACKAGE}.feature.monetization.presentation.paywall.FirstLaunchPaywall`,
    'import org.koin.compose.koinInject',
    '',
    '@Composable',
    'fun MainScreen() {',
    '    // Passes ReviewPrompter\'s requests ("Rate the app") to the platform',
    '    ReviewRequestEffect()',
    '',
    '    // Update available / required (core/update): at most one check a day',
    '    AppUpdateEffect()',
    '    // FirstLaunchPaywall (purchases): the paywall once, at the first launch (feature/monetization)',
    '    FirstLaunchPaywall()',
    '}',
    ''
].join('\n');

// Every other flag on: only the monetization blocks act on the tree
const ALL_ON = { network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true };

// settings.gradle.kts includes (template + monetization modules)
const SETTINGS = [
    'rootProject.name = "Multiplatform"',
    'enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")',
    '',
    'include(":shared")',
    'include(":androidApp")',
    'include(":core:ads")',
    'include(":core:database")',
    'include(":core:designsystem")',
    'include(":core:domain")',
    'include(":core:multilang")',
    'include(":core:navigation")',
    'include(":core:network")',
    'include(":core:presentation")',
    'include(":core:purchases")',
    'include(":feature:monetization")',
    'include(":feature:monetization:contract")',
    'include(":feature:monetization:presentation")',
    'includeBuild("build-logic")'
].join('\n');

// shared/build.gradle.kts of the template
const SHARED_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    listOf(',
    '        iosArm64(),',
    '        iosSimulatorArm64()',
    '    ).forEach { iosTarget ->',
    '        iosTarget.binaries.framework {',
    '            export(projects.core.ads)',
    '            baseName = "Shared"',
    '            isStatic = true',
    '        }',
    '    }',
    '',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            api(projects.core.ads)',
    '            implementation(projects.core.database)',
    '            implementation(projects.core.domain)',
    '            implementation(projects.core.multilang)',
    '            implementation(projects.core.navigation)',
    '            implementation(projects.core.network)',
    '            implementation(projects.core.purchases)',
    '            implementation(projects.feature.monetization.contract)',
    '            implementation(projects.feature.monetization.presentation)',
    '            implementation(projects.core.designsystem)',
    '        }',
    '    }',
    '}'
].join('\n');

// shared/.../di/initKoin.kt of the template, after the package move
const INIT_KOIN_CONTENT = [
    '@file:Suppress("Filename")',
    '',
    `package ${NEW_PACKAGE}.di`,
    '',
    `import ${NEW_PACKAGE}.core.database.di.DatabaseModule`,
    `import ${NEW_PACKAGE}.core.domain.BuildEnvironment`,
    `import ${NEW_PACKAGE}.core.multilang.di.MultiLangModule`,
    `import ${NEW_PACKAGE}.core.navigation.NavigationModule`,
    `import ${NEW_PACKAGE}.core.network.di.NetworkModule`,
    `import ${NEW_PACKAGE}.core.purchases.di.PurchasesModule`,
    `import ${NEW_PACKAGE}.feature.monetization.presentation.di.MonetizationPresentationModule`,
    'import org.koin.core.annotation.ComponentScan',
    'import org.koin.core.annotation.Module',
    'import org.koin.ksp.generated.module',
    'import org.koin.core.module.Module as KoinModule',
    '',
    'fun appModules(): List<KoinModule> = buildList {',
    '    add(NavigationModule().module)',
    '    add(NetworkModule().module)',
    '    add(CmpModule().module)',
    '    add(DatabaseModule().module)',
    '    add(MultiLangModule().module)',
    '    add(PurchasesModule().module)',
    '    add(MonetizationPresentationModule().module)',
    '}',
    '',
    '@Module',
    `@ComponentScan("${NEW_PACKAGE}")`,
    'class CmpModule',
    ''
].join('\n');

// feature/monetization/presentation/build.gradle.kts of the template
const PRESENTATION_BUILD = [
    'plugins {',
    '    alias(libs.plugins.feature.presentation.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(projects.core.ads)',
    '            implementation(projects.core.purchases)',
    '            implementation(libs.revenuecat.ui)',
    '            implementation(projects.feature.monetization.contract)',
    '        }',
    '    }',
    '}'
].join('\n');

// gradle/libs.versions.toml of the template (trimmed; no trailing newline, as in the template; Android ads on the GMA Next-Gen SDK)
const TOML = [
    '[versions]',
    'kotlin = "2.3.21"',
    'networkMonitor = "0.1.1"',
    'turbine = "1.2.1"',
    'revenuecat = "3.10.1"',
    'adsMobileSdk = "1.5.0"',
    'ump = "4.0.0"',
    'androidx-work = "2.12.0"',
    '',
    '[libraries]',
    'turbine = { module = "app.cash.turbine:turbine", version.ref = "turbine" }',
    'networkMonitor-debug = { module = "com.kturker:networkmonitor", version.ref = "networkMonitor" }',
    'networkMonitor-release = { module = "com.kturker:networkmonitor-noop", version.ref = "networkMonitor" }',
    'revenuecat-core = { module = "com.revenuecat.purchases:purchases-kmp-core", version.ref = "revenuecat" }',
    'revenuecat-ui = { module = "com.revenuecat.purchases:purchases-kmp-ui", version.ref = "revenuecat" }',
    'adsMobileSdk = { module = "com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk", version.ref = "adsMobileSdk" }',
    'ump = { module = "com.google.android.ump:user-messaging-platform", version.ref = "ump" }',
    'androidx-work-runtime = { module = "androidx.work:work-runtime", version.ref = "androidx-work" }',
    '',
    '[plugins]',
    'kotlinMultiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }'
].join('\n');

const ADS_FILES = {
    'core/ads/build.gradle.kts': 'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n',
    [`${ADS_SRC}/AdsController.kt`]: `package ${NEW_PACKAGE}.core.ads\n\ninterface AdsController\n`,
    [`${CONTRACT_SRC}/AdsDemoDestination.kt`]: `package ${NEW_PACKAGE}.feature.monetization.contract\n\ndata object AdsDemoDestination\n`,
    [`${PRESENTATION_SRC}/ads/AdFreeSource.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\ninternal interface AdFreeSource\n`,
    [`${PRESENTATION_SRC}/ads/AdsDemoViewModel.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\ninternal class AdsDemoViewModel\n`,
    [`${PRESENTATION_SRC}/di/MonetizationPresentationModule.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.di\n\nclass MonetizationPresentationModule\n`
};

const PURCHASES_FILES = {
    'core/purchases/build.gradle.kts': 'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            api(libs.revenuecat.core)\n        }\n    }\n}\n',
    [`${PURCHASES_SRC}/PurchasesManager.kt`]: `package ${NEW_PACKAGE}.core.purchases\n\ninterface PurchasesManager\n`,
    [`${PURCHASES_SRC}/RevenueCatPurchasesManager.kt`]: `package ${NEW_PACKAGE}.core.purchases\n\nimport com.revenuecat.purchases.kmp.Purchases\n\ninternal class RevenueCatPurchasesManager : PurchasesManager\n`,
    [`${PURCHASES_SRC}/di/PurchasesModule.kt`]: `package ${NEW_PACKAGE}.core.purchases.di\n\nclass PurchasesModule\n`,
    [`${CONTRACT_SRC}/PaywallDestination.kt`]: `package ${NEW_PACKAGE}.feature.monetization.contract\n\ndata object PaywallDestination\n`,
    [`${PRESENTATION_SRC}/paywall/PaywallViewModel.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.paywall\n\nimport ${NEW_PACKAGE}.core.purchases.PurchasesManager\n\ninternal class PaywallViewModel(private val purchasesManager: PurchasesManager)\n`,
    [`${PRESENTATION_SRC}/paywall/PaywallProvider.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.paywall\n\nimport ${NEW_PACKAGE}.feature.monetization.contract.PaywallDestination\n`,
    [`${PRESENTATION_SRC}/ads/PremiumAdFreeSource.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\nimport ${NEW_PACKAGE}.core.purchases.PurchasesManager\n\ninternal class PremiumAdFreeSource(private val purchasesManager: PurchasesManager) : AdFreeSource\n`,
    [`${PRESENTATION_TEST}/paywall/PaywallViewModelTest.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.paywall\n\nimport ${NEW_PACKAGE}.core.purchases.PurchasesManager\n\nclass FakePurchasesManager : PurchasesManager\n`
};

// README.md of the template (marked monetization block between two ordinary sections)
const README_PURCHASES = [
    '<!-- cmpose:purchases -->',
    '- **RevenueCat** (`core/purchases`): replace the Test Store key.',
    '<!-- /cmpose:purchases -->'
].join('\n');
const README_ADS = [
    '<!-- cmpose:ads -->',
    '- **AdMob** (`core/ads`): replace the test app IDs.',
    '<!-- /cmpose:ads -->'
].join('\n');
const README = [
    '# Multiplatform',
    '',
    '## Modules',
    '',
    '<!-- cmpose:modules -->',
    'old modules',
    '<!-- /cmpose:modules -->',
    '',
    '<!-- cmpose:monetization -->',
    '## Monetization',
    '',
    'This project ships with **test keys only**.',
    README_PURCHASES,
    README_ADS,
    '<!-- /cmpose:monetization -->',
    '',
    '## License',
    '',
    'MIT',
    ''
].join('\n');

async function seed() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    const files = {
        'settings.gradle.kts': SETTINGS,
        'shared/build.gradle.kts': SHARED_BUILD,
        [INIT_KOIN]: INIT_KOIN_CONTENT,
        'feature/monetization/contract/build.gradle.kts': 'plugins {\n    alias(libs.plugins.feature.contract.plugin)\n}\n',
        'feature/monetization/presentation/build.gradle.kts': PRESENTATION_BUILD,
        'gradle/libs.versions.toml': TOML,
        'README.md': README,
        ...ADS_FILES,
        ...PURCHASES_FILES
    };
    for (const [rel, content] of Object.entries(files)) {
        await fs.outputFile(path.join(dir, rel), content);
    }
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));

test('purchases=false, ads=true removes RevenueCat and leaves the ads side as it is', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: true }, NEW_PACKAGE);

        assert.equal(await exists(dir, 'core/purchases'), false);
        assert.equal(await exists(dir, `${CONTRACT_SRC}/PaywallDestination.kt`), false);
        assert.equal(await exists(dir, `${PRESENTATION_SRC}/paywall`), false);
        assert.equal(await exists(dir, `${PRESENTATION_TEST}/paywall`), false);
        assert.equal(await exists(dir, `${PRESENTATION_SRC}/ads/PremiumAdFreeSource.kt`), false);

        const settings = await read(dir, 'settings.gradle.kts');
        assert.ok(!settings.includes('":core:purchases"'));
        assert.equal(settings, SETTINGS.split('\n').filter((l) => l !== 'include(":core:purchases")').join('\n'));

        const shared = await read(dir, 'shared/build.gradle.kts');
        assert.equal(shared, SHARED_BUILD.split('\n').filter((l) => !l.includes('projects.core.purchases')).join('\n'));

        const presentation = await read(dir, 'feature/monetization/presentation/build.gradle.kts');
        assert.equal(presentation, PRESENTATION_BUILD.split('\n')
            .filter((l) => !l.includes('projects.core.purchases') && !l.includes('libs.revenuecat')).join('\n'));

        const initKoin = await read(dir, INIT_KOIN);
        assert.ok(!initKoin.includes('PurchasesModule'));
        assert.equal(initKoin, INIT_KOIN_CONTENT.split('\n').filter((l) => !l.includes('PurchasesModule')).join('\n'));
        assert.ok(initKoin.includes('add(MonetizationPresentationModule().module)'));

        const toml = await read(dir, 'gradle/libs.versions.toml');
        assert.doesNotMatch(toml, /^revenuecat(-core|-ui)?\s*=/m);
        assert.equal(toml, TOML.split('\n').filter((l) => !/^revenuecat(-core|-ui)?\s*=/.test(l)).join('\n'));
        assert.match(toml, /^adsMobileSdk = /m);
        assert.match(toml, /^ump = /m);

        // Ads side untouched
        for (const [rel, content] of Object.entries(ADS_FILES)) {
            assert.equal(await read(dir, rel), content, rel);
        }
        assert.ok(settings.includes('include(":core:ads")'));
        assert.ok(shared.includes('api(projects.core.ads)'));
        assert.ok(shared.includes('export(projects.core.ads)'));
        assert.ok(presentation.includes('implementation(projects.core.ads)'));
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=true leaves everything purchases-related in place', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: true }, NEW_PACKAGE);

        assert.equal(await read(dir, 'settings.gradle.kts'), SETTINGS);
        assert.equal(await read(dir, 'shared/build.gradle.kts'), SHARED_BUILD);
        assert.equal(await read(dir, 'feature/monetization/presentation/build.gradle.kts'), PRESENTATION_BUILD);
        assert.equal(await read(dir, INIT_KOIN), INIT_KOIN_CONTENT);
        assert.equal(await read(dir, 'gradle/libs.versions.toml'), TOML);
        for (const [rel, content] of Object.entries(PURCHASES_FILES)) {
            assert.equal(await read(dir, rel), content, rel);
        }
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false on a tree without monetization files is a no-op', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":shared")\n');
        await processCoreFeatures(dir, { ...ALL_ON }, NEW_PACKAGE);
        assert.equal(await read(dir, 'settings.gradle.kts'), 'include(":shared")\n');
    } finally {
        await fs.remove(dir);
    }
});

test('a RevenueCat line the removal does not reach makes processCoreFeatures fail', async () => {
    const dir = await seed();
    try {
        // An unrelated module the purchases block never edits
        await fs.outputFile(path.join(dir, 'feature/sample/data/build.gradle.kts'),
            'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(libs.revenuecat.core)\n        }\n    }\n}\n');
        await assert.rejects(
            processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: true }, NEW_PACKAGE),
            (err) => /Monetization residue/.test(err.message) &&
                err.message.includes(path.join('feature', 'sample', 'data', 'build.gradle.kts') + ': libs.revenuecat')
        );
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue reports each purchases token and ignores user input', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'a/Leftover.kt'), 'import com.revenuecat.purchases.kmp.Purchases\nval x: PurchasesManager\nval d = PaywallDestination\n');
        await fs.outputFile(path.join(dir, 'b/build.gradle.kts'), 'include(":core:purchases")\nimplementation(projects.core.purchases)\n');
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: true }), (err) => {
            for (const token of ['com.revenuecat', 'PurchasesManager', 'PaywallDestination', '":core:purchases"', 'projects.core.purchases']) {
                assert.ok(err.message.includes(token), token);
            }
            return true;
        });
        // Purchases on: its tokens are not looked for
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: true });

        // A package, project name or app name that spells a token is not residue
        const clean = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            const pkg = 'com.revenuecat.app';
            await fs.outputFile(path.join(clean, 'shared/src/Main.kt'), `package ${pkg}.di\n\nimport ${pkg}.core.navigation.NavigationModule\n`);
            await fs.outputFile(path.join(clean, 'core/navigation/src/NavigationModule.kt'), `package ${pkg}.core.navigation\n\nclass NavigationModule\n`);
            await fs.outputFile(path.join(clean, 'settings.gradle.kts'), 'rootProject.name = "PurchasesManager"\n');
            await fs.outputFile(path.join(clean, 'androidApp/src/main/res/values/strings.xml'), '<string name="app_name">projects.core.purchases</string>\n');
            await fs.outputFile(path.join(clean, 'iosApp/Configuration/Config.xcconfig'), 'APP_NAME = PaywallDestination\n');
            await assertNoMonetizationResidue(clean, pkg, { purchases: false, ads: false });
        } finally {
            await fs.remove(clean);
        }
    } finally {
        await fs.remove(dir);
    }
});

// A custom module (cloned from feature/sample) next to the monetization feature
const CUSTOM_FILES = {
    'feature/shop/presentation/build.gradle.kts': 'plugins {\n    alias(libs.plugins.feature.presentation.plugin)\n}\n',
    [`feature/shop/presentation/src/commonMain/kotlin/${PKG}/feature/shop/presentation/ShopScreen.kt`]: `package ${NEW_PACKAGE}.feature.shop.presentation\n\nfun ShopScreen() = Unit\n`
};
const CUSTOM_SETTINGS_LINES = ['include(":feature:shop")', 'include(":feature:shop:presentation")'];
const CUSTOM_SHARED_LINE = '            implementation(projects.feature.shop.presentation)';
const CUSTOM_KOIN_LINES = [`import ${NEW_PACKAGE}.feature.shop.presentation.di.ShopPresentationModule`, '    add(ShopPresentationModule().module)'];

async function seedWithCustomModule() {
    const dir = await seed();
    for (const [rel, content] of Object.entries(CUSTOM_FILES)) {
        await fs.outputFile(path.join(dir, rel), content);
    }
    const insertAfter = async (rel, anchor, lines) => {
        const content = await read(dir, rel);
        await fs.writeFile(path.join(dir, rel), content.replace(anchor, [anchor, ...lines].join('\n')));
    };
    await insertAfter('settings.gradle.kts', 'include(":feature:monetization:presentation")', CUSTOM_SETTINGS_LINES);
    await insertAfter('shared/build.gradle.kts', '            implementation(projects.feature.monetization.presentation)', [CUSTOM_SHARED_LINE]);
    await insertAfter(INIT_KOIN, `import ${NEW_PACKAGE}.feature.monetization.presentation.di.MonetizationPresentationModule`, [CUSTOM_KOIN_LINES[0]]);
    await insertAfter(INIT_KOIN, '    add(MonetizationPresentationModule().module)', [CUSTOM_KOIN_LINES[1]]);
    return dir;
}

test('purchases=false, ads=false removes the monetization feature and keeps a custom module', async () => {
    const dir = await seedWithCustomModule();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        assert.equal(await exists(dir, 'feature/monetization'), false);

        const settings = await read(dir, 'settings.gradle.kts');
        assert.ok(!settings.includes('":feature:monetization'), settings);
        for (const line of CUSTOM_SETTINGS_LINES) assert.ok(settings.includes(line), line);

        const shared = await read(dir, 'shared/build.gradle.kts');
        assert.ok(!shared.includes('projects.feature.monetization'), shared);
        assert.ok(shared.includes(CUSTOM_SHARED_LINE));

        const initKoin = await read(dir, INIT_KOIN);
        assert.doesNotMatch(initKoin, /\bMonetizationPresentationModule\b/);
        for (const line of CUSTOM_KOIN_LINES) assert.ok(initKoin.includes(line), line);
        assert.ok(initKoin.includes('add(CmpModule().module)'));

        // The custom module is untouched
        for (const [rel, content] of Object.entries(CUSTOM_FILES)) {
            assert.equal(await read(dir, rel), content, rel);
        }
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false, ads=false fails when a monetization reference is left behind', async () => {
    const dir = await seed();
    try {
        await fs.outputFile(path.join(dir, 'feature/shop/presentation/build.gradle.kts'),
            'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(projects.feature.monetization.contract)\n        }\n    }\n}\n');
        await assert.rejects(
            processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE),
            (err) => /Monetization residue/.test(err.message) &&
                err.message.includes(path.join('feature', 'shop', 'presentation', 'build.gradle.kts') + ': projects.feature.monetization')
        );
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue looks for the monetization feature only when both flags are off', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'include(":feature:monetization:contract")\n');
        await fs.outputFile(path.join(dir, 'shared/build.gradle.kts'), 'implementation(projects.feature.monetization.presentation)\n');
        await fs.outputFile(path.join(dir, 'shared/src/initKoin.kt'), 'add(MonetizationPresentationModule().module)\n');
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false }), (err) => {
            for (const token of ['":feature:monetization"', 'projects.feature.monetization', 'MonetizationPresentationModule']) {
                assert.ok(err.message.includes(token), token);
            }
            return true;
        });
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false });
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: true });
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false, ads=true removes only the purchases README block', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: true }, NEW_PACKAGE);

        const readme = await read(dir, 'README.md');
        assert.ok(!readme.includes('cmpose:purchases'), readme);
        assert.ok(!readme.includes('RevenueCat'), readme);
        assert.ok(readme.includes('<!-- cmpose:monetization -->') && readme.includes('<!-- /cmpose:monetization -->'), readme);
        assert.ok(readme.includes(README_ADS), readme);
        assert.equal(readme, README.replace(`${README_PURCHASES}\n`, ''));
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=true, ads=false removes only the ads README block', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);

        const readme = await read(dir, 'README.md');
        assert.ok(!readme.includes('cmpose:ads'), readme);
        assert.ok(!readme.includes('AdMob'), readme);
        assert.ok(readme.includes('<!-- cmpose:monetization -->') && readme.includes('<!-- /cmpose:monetization -->'), readme);
        assert.ok(readme.includes(README_PURCHASES), readme);
        assert.equal(readme, README.replace(`\n${README_ADS}`, ''));
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false, ads=false removes the whole monetization README block', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        const readme = await read(dir, 'README.md');
        for (const marker of ['cmpose:monetization', 'cmpose:purchases', 'cmpose:ads', '## Monetization']) {
            assert.ok(!readme.includes(marker), marker);
        }
        assert.doesNotMatch(readme, /\n{3,}/);
        assert.ok(readme.includes('<!-- /cmpose:modules -->\n\n## License'), readme);
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=true, ads=true leaves the README unchanged', async () => {
    const dir = await seed();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: true }, NEW_PACKAGE);
        assert.equal(await read(dir, 'README.md'), README);
    } finally {
        await fs.remove(dir);
    }
});

// --- Review fixes: user input, module-name prefixes, masking, colon-less includes ---

test('assertNoMonetizationResidue ignores an appName that spells a token in AppConfig.kt', async () => {
    const appNames = ['PaywallDestination', 'PurchasesManager', 'com.revenuecat', 'PurchasesModule',
        'PurchasesKeys', 'MonetizationPresentationModule', 'projects.core.purchases', 'projects.feature.monetization'];
    for (const appName of appNames) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            await fs.outputFile(path.join(dir, 'build-logic/src/main/kotlin/config/AppConfig.kt'), [
                'package config',
                '',
                'object AppConfig {',
                `    const val applicationId = "${NEW_PACKAGE}"`,
                `    const val appName = "${appName}"`,
                '    const val minSdkVersion = 24',
                '}',
                ''
            ].join('\n'));
            await fs.outputFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${appName.replace(/[ .]/g, '')}"\n`);
            await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
        } finally {
            await fs.remove(dir);
        }
    }
});

// Custom modules whose names start with "monetization" are valid (monetization itself is reserved)
const PREFIX_MODULES = ['monetizationx', 'monetization2'];
const prefixModuleFiles = (name) => ({
    [`feature/${name}/presentation/build.gradle.kts`]:
        `plugins {\n    alias(libs.plugins.feature.presentation.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(projects.feature.${name}.contract)\n        }\n    }\n}\n`,
    [`feature/${name}/presentation/src/commonMain/kotlin/${PKG}/feature/${name}/presentation/di/${name[0].toUpperCase()}${name.slice(1)}PresentationModule.kt`]:
        `package ${NEW_PACKAGE}.feature.${name}.presentation.di\n\nclass ${name[0].toUpperCase()}${name.slice(1)}PresentationModule\n`
});

test('purchases=false, ads=false keeps custom modules whose names start with monetization', async () => {
    const dir = await seed();
    try {
        const settingsLines = [];
        const sharedLines = [];
        for (const name of PREFIX_MODULES) {
            for (const [rel, content] of Object.entries(prefixModuleFiles(name))) {
                await fs.outputFile(path.join(dir, rel), content);
            }
            // One include with the leading colon, one without (both spellings are in the template)
            settingsLines.push(`include(":feature:${name}:contract")`, `include("feature:${name}:presentation")`);
            sharedLines.push(`            implementation(projects.feature.${name}.presentation)`);
        }
        await fs.writeFile(path.join(dir, 'settings.gradle.kts'), `${SETTINGS}\n${settingsLines.join('\n')}`);
        const shared = SHARED_BUILD.replace('            implementation(projects.core.designsystem)',
            [...sharedLines, '            implementation(projects.core.designsystem)'].join('\n'));
        await fs.writeFile(path.join(dir, 'shared/build.gradle.kts'), shared);

        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        const settings = await read(dir, 'settings.gradle.kts');
        for (const line of settingsLines) assert.ok(settings.includes(line), line);
        assert.doesNotMatch(settings, /feature:monetization(?=[:"])/);
        const sharedAfter = await read(dir, 'shared/build.gradle.kts');
        for (const line of sharedLines) assert.ok(sharedAfter.includes(line), line);
        assert.doesNotMatch(sharedAfter, /projects\.feature\.monetization\./);
        for (const name of PREFIX_MODULES) {
            for (const [rel, content] of Object.entries(prefixModuleFiles(name))) {
                assert.equal(await read(dir, rel), content, rel);
            }
        }
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue reports PurchasesModule and PurchasesKeys', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'shared/src/initKoin.kt'), 'fun f() = add(PurchasesModule().module)\n');
        await fs.outputFile(path.join(dir, 'androidApp/src/Keys.kt'), 'val key = PurchasesKeys.API_KEY\n');
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: true }), (err) => {
            assert.ok(err.message.includes(path.join('shared', 'src', 'initKoin.kt') + ': PurchasesModule'), err.message);
            assert.ok(err.message.includes(path.join('androidApp', 'src', 'Keys.kt') + ': PurchasesKeys'), err.message);
            return true;
        });
    } finally {
        await fs.remove(dir);
    }
});

test('a package that spells com.revenuecat masks only its own package lines', async () => {
    const pkg = 'com.revenuecat.purchases';
    const pkgPath = pkg.replace(/\./g, '/');
    const own = async (dir) => {
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/App.kt`), `package ${pkg}\n\nfun App() = Unit\n`);
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/di/initKoin.kt`), [
            `package ${pkg}.di`,
            '',
            `import ${pkg}.App`,
            `import ${pkg}.core.navigation.NavigationModule`,
            `import ${pkg}.core.navigation.NavigationModule.Companion`,
            `import ${pkg}.core.navigation.*`,
            '',
            `@ComponentScan("${pkg}")`,
            'class CmpModule',
            ''
        ].join('\n'));
        await fs.outputFile(path.join(dir, `core/navigation/src/commonMain/kotlin/${pkgPath}/core/navigation/NavigationModule.kt`),
            `package ${pkg}.core.navigation\n\nclass NavigationModule\n`);
        await fs.outputFile(path.join(dir, 'build-logic/src/main/kotlin/config/AppConfig.kt'), `object AppConfig {\n    const val applicationId = "${pkg}"\n}\n`);
        await fs.outputFile(path.join(dir, 'core/navigation/build.gradle.kts'), `android {\n    namespace = "${pkg}.core.navigation"\n}\n`);
        await fs.outputFile(path.join(dir, 'gradle/libs.versions.toml'), `[plugins]\nkmp-library-plugin = { id = "${pkg}.kmp.library", version = "unspecified" }\n`);
    };

    // The user's own lines are not residue
    const clean = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await own(clean);
        await assertNoMonetizationResidue(clean, pkg, { purchases: false, ads: false });
    } finally {
        await fs.remove(clean);
    }

    // A real RevenueCat import is still caught
    const dirty = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await own(dirty);
        await fs.outputFile(path.join(dirty, `core/navigation/src/commonMain/kotlin/${pkgPath}/core/navigation/Leftover.kt`),
            `package ${pkg}.core.navigation\n\nimport com.revenuecat.purchases.kmp.Purchases\n`);
        await assert.rejects(assertNoMonetizationResidue(dirty, pkg, { purchases: false, ads: true }),
            (err) => err.message.includes('Leftover.kt: com.revenuecat'));
    } finally {
        await fs.remove(dirty);
    }
});

test('colon-less includes of core:purchases and feature:monetization are removed and detected', async () => {
    const dir = await seed();
    try {
        const settings = SETTINGS
            .replace('include(":core:purchases")', 'include("core:purchases")')
            .replace('include(":feature:monetization:presentation")', 'include("feature:monetization:presentation")');
        await fs.writeFile(path.join(dir, 'settings.gradle.kts'), settings);

        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);
        const after = await read(dir, 'settings.gradle.kts');
        assert.doesNotMatch(after, /core:purchases|feature:monetization|core:ads/);
    } finally {
        await fs.remove(dir);
    }

    const residue = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(residue, 'settings.gradle.kts'), 'include("core:purchases")\ninclude("feature:monetization:contract")\n');
        await assert.rejects(assertNoMonetizationResidue(residue, NEW_PACKAGE, { purchases: false, ads: false }), (err) => {
            assert.ok(err.message.includes('settings.gradle.kts: ":core:purchases"'), err.message);
            assert.ok(err.message.includes('settings.gradle.kts: ":feature:monetization"'), err.message);
            return true;
        });
    } finally {
        await fs.remove(residue);
    }
});

// --- Ads: golden platform files and the ads=false block ---

const FIXTURES = path.join(__dirname, 'fixtures', 'monetization');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

test('stripAdsInfoPlist turns the with-ads Info.plist into the without-ads one byte for byte', () => {
    assert.equal(stripAdsInfoPlist(fixture('Info.with-ads.plist')), fixture('Info.without-ads.plist'));
    assert.equal(stripAdsInfoPlist(fixture('Info.without-ads.plist')), fixture('Info.without-ads.plist'));
});

test('stripAdsManifest turns the with-ads manifest into the without-ads one byte for byte', () => {
    assert.equal(stripAdsManifest(fixture('AndroidManifest.with-ads.xml')), fixture('AndroidManifest.without-ads.xml'));
    assert.equal(stripAdsManifest(fixture('AndroidManifest.without-ads.xml')), fixture('AndroidManifest.without-ads.xml'));
});

test('stripAdsBridgeRegistration turns the with-ads iOSApp.swift into the without-ads one byte for byte', () => {
    assert.equal(stripAdsBridgeRegistration(fixture('iOSApp.with-ads.swift')), fixture('iOSApp.without-ads.swift'));
    assert.equal(stripAdsBridgeRegistration(fixture('iOSApp.without-ads.swift')), fixture('iOSApp.without-ads.swift'));
});

const ADS_BRIDGE_REGISTRATION = `shared/src/iosMain/kotlin/${PKG}/AdsBridgeRegistration.kt`;
const PACKAGE_RESOLVED = 'iosApp/iosApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
const PLATFORM_FILES = {
    'iosApp/iosApp.xcodeproj/project.pbxproj': ['project.with-ads.pbxproj', 'project.without-ads.pbxproj'],
    'iosApp/iosApp/Info.plist': ['Info.with-ads.plist', 'Info.without-ads.plist'],
    'androidApp/src/main/AndroidManifest.xml': ['AndroidManifest.with-ads.xml', 'AndroidManifest.without-ads.xml'],
    'iosApp/iosApp/iOSApp.swift': ['iOSApp.with-ads.swift', 'iOSApp.without-ads.swift']
};
const IOS_ADS_FILES = {
    [ADS_BRIDGE_REGISTRATION]: `package ${NEW_PACKAGE}\n\nimport ${NEW_PACKAGE}.core.ads.IosAds\nimport ${NEW_PACKAGE}.core.ads.IosAdsBridge\n\nfun registerAdsBridge(bridge: IosAdsBridge) = IosAds.register(bridge)\n`,
    'iosApp/iosApp/AdsBridge.swift': 'import GoogleMobileAds\nimport Shared\n\nfinal class AdsBridge: NSObject, IosAdsBridge {}\n',
    [PACKAGE_RESOLVED]: '{\n  "pins" : [\n    {\n      "identity" : "swift-package-manager-google-mobile-ads"\n    }\n  ],\n  "version" : 3\n}\n',
    [`${PRESENTATION_TEST}/ads/AdsDemoViewModelTest.kt`]: `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\nimport ${NEW_PACKAGE}.core.ads.AdResult\n\nclass AdsDemoViewModelTest\n`
};

async function seedWithPlatform() {
    const dir = await seed();
    for (const [rel, [withAds]] of Object.entries(PLATFORM_FILES)) {
        await fs.outputFile(path.join(dir, rel), fixture(withAds));
    }
    for (const [rel, content] of Object.entries(IOS_ADS_FILES)) {
        await fs.outputFile(path.join(dir, rel), content);
    }
    return dir;
}

const withoutLines = (content, re) => content.split('\n').filter((l) => !re.test(l)).join('\n');
// androidx-work: core/ads depends on a current WorkManager (the ads SDK's old one breaks under R8)
const ADS_TOML_LINE = /^(adsMobileSdk|ump|androidx-work|androidx-work-runtime)\s*=/;

async function assertAdsRemoved(dir) {
    for (const rel of ['core/ads', ADS_BRIDGE_REGISTRATION, 'iosApp/iosApp/AdsBridge.swift', PACKAGE_RESOLVED,
        `${CONTRACT_SRC}/AdsDemoDestination.kt`, `${PRESENTATION_SRC}/ads`, `${PRESENTATION_TEST}/ads`]) {
        assert.equal(await exists(dir, rel), false, rel);
    }
    for (const [rel, [, withoutAds]] of Object.entries(PLATFORM_FILES)) {
        assert.equal(await read(dir, rel), fixture(withoutAds), rel);
    }
    const toml = await read(dir, 'gradle/libs.versions.toml');
    assert.doesNotMatch(toml, /^(adsMobileSdk|playServicesAds|ump|androidx-work|androidx-work-runtime)\s*=/m);
    assert.doesNotMatch(toml, /ads-mobile-sdk|play-services-ads|user-messaging-platform|androidx\.work:work-runtime/);
}

test('purchases=true, ads=false removes AdMob, the Swift bridge and the SPM package and keeps the paywall', async () => {
    const dir = await seedWithPlatform();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);

        await assertAdsRemoved(dir);

        assert.equal(await read(dir, 'settings.gradle.kts'), withoutLines(SETTINGS, /^include\(":core:ads"\)$/));
        assert.equal(await read(dir, 'shared/build.gradle.kts'), withoutLines(SHARED_BUILD, /projects\.core\.ads\)/));
        assert.equal(await read(dir, 'feature/monetization/presentation/build.gradle.kts'), withoutLines(PRESENTATION_BUILD, /projects\.core\.ads\)/));
        assert.equal(await read(dir, 'gradle/libs.versions.toml'), withoutLines(TOML, ADS_TOML_LINE));
        assert.equal(await read(dir, INIT_KOIN), INIT_KOIN_CONTENT);

        // The purchases side and the module stay (PremiumAdFreeSource lives in ads/ and goes with it)
        for (const [rel, content] of Object.entries(PURCHASES_FILES)) {
            if (rel.startsWith(`${PRESENTATION_SRC}/ads/`)) continue;
            assert.equal(await read(dir, rel), content, rel);
        }
        assert.equal(await read(dir, `${PRESENTATION_SRC}/di/MonetizationPresentationModule.kt`), ADS_FILES[`${PRESENTATION_SRC}/di/MonetizationPresentationModule.kt`]);
        assert.ok((await read(dir, 'settings.gradle.kts')).includes('include(":feature:monetization:presentation")'));
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false, ads=false removes the ads side and the whole monetization feature', async () => {
    const dir = await seedWithPlatform();
    try {
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        await assertAdsRemoved(dir);
        assert.equal(await exists(dir, 'core/purchases'), false);
        assert.equal(await exists(dir, 'feature/monetization'), false);

        const settings = await read(dir, 'settings.gradle.kts');
        assert.doesNotMatch(settings, /core:ads|core:purchases|feature:monetization/);
        const shared = await read(dir, 'shared/build.gradle.kts');
        assert.doesNotMatch(shared, /projects\.core\.ads|projects\.core\.purchases|projects\.feature\.monetization/);
        assert.ok(shared.includes('            baseName = "Shared"'));
        assert.equal(await read(dir, 'gradle/libs.versions.toml'),
            withoutLines(TOML, /^(adsMobileSdk|ump|androidx-work|androidx-work-runtime|revenuecat(-core|-ui)?)\s*=/));
    } finally {
        await fs.remove(dir);
    }
});

// Templates before the GMA Next-Gen move had the play-services-ads catalog entry; it is stripped too
const LEGACY_TOML = TOML
    .replace('adsMobileSdk = "1.5.0"', 'playServicesAds = "24.9.0"')
    .replace('adsMobileSdk = { module = "com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk", version.ref = "adsMobileSdk" }',
        'playServicesAds = { module = "com.google.android.gms:play-services-ads", version.ref = "playServicesAds" }');

test('ads=false also removes the legacy playServicesAds catalog entry of older templates', async () => {
    assert.match(LEGACY_TOML, /^playServicesAds = \{ module = "com\.google\.android\.gms:play-services-ads"/m);
    for (const purchases of [true, false]) {
        const dir = await seedWithPlatform();
        try {
            await fs.outputFile(path.join(dir, 'gradle/libs.versions.toml'), LEGACY_TOML);
            await processCoreFeatures(dir, { ...ALL_ON, purchases, ads: false }, NEW_PACKAGE);
            const toml = await read(dir, 'gradle/libs.versions.toml');
            assert.equal(toml, withoutLines(LEGACY_TOML, purchases
                ? /^(playServicesAds|ump|androidx-work|androidx-work-runtime)\s*=/
                : /^(playServicesAds|ump|androidx-work|androidx-work-runtime|revenuecat(-core|-ui)?)\s*=/));
            assert.doesNotMatch(toml, /play-services-ads|user-messaging-platform/);
        } finally {
            await fs.remove(dir);
        }
    }
});

test('ads=true leaves the ads side, the platform files and the SPM package untouched', async () => {
    for (const purchases of [true, false]) {
        const dir = await seedWithPlatform();
        try {
            await processCoreFeatures(dir, { ...ALL_ON, purchases, ads: true }, NEW_PACKAGE);
            for (const [rel, [withAds]] of Object.entries(PLATFORM_FILES)) {
                assert.equal(await read(dir, rel), fixture(withAds), rel);
            }
            for (const [rel, content] of Object.entries({ ...ADS_FILES, ...IOS_ADS_FILES })) {
                assert.equal(await read(dir, rel), content, rel);
            }
            const settings = await read(dir, 'settings.gradle.kts');
            assert.ok(settings.includes('include(":core:ads")'));
            const toml = await read(dir, 'gradle/libs.versions.toml');
            assert.match(toml, /^adsMobileSdk = /m);
            assert.match(toml, /^ump = /m);
            assert.match(toml, /^androidx-work = /m);
            assert.match(toml, /^androidx-work-runtime = /m);
        } finally {
            await fs.remove(dir);
        }
    }
});

test('an ads reference the removal does not reach makes processCoreFeatures fail', async () => {
    const leftovers = [
        ['feature/shop/presentation/build.gradle.kts', 'dependencies {\n    implementation(projects.core.ads)\n}\n', 'projects.core.ads'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation(libs.playServicesAds)\n}\n', 'libs.playServicesAds'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation(libs.ump)\n}\n', 'libs.ump'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation(libs.adsMobileSdk)\n}\n', 'libs.adsMobileSdk'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation(libs.androidx.work.runtime)\n}\n', 'libs.androidx.work'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation("androidx.work:work-runtime:2.12.0")\n}\n', 'androidx.work:work-runtime'],
        ['core/other/build.gradle.kts', 'dependencies {\n    implementation("com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk:1.5.0")\n}\n',
            'com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk'],
        [`core/other/src/androidMain/kotlin/${PKG}/core/other/Other.kt`,
            `package ${NEW_PACKAGE}.core.other\n\nimport com.google.android.libraries.ads.mobile.sdk.MobileAds\n`,
            'import com.google.android.libraries.ads.mobile.sdk'],
        ['iosApp/iosApp/Other.swift', 'import GoogleMobileAds\n', 'import GoogleMobileAds'],
        ['iosApp/iosApp/Other.swift', 'let b: IosAdsBridge? = nil\n', 'IosAdsBridge'],
        [`feature/shop/presentation/src/commonMain/kotlin/${PKG}/feature/shop/Nav.kt`, 'val d = AdsDemoDestination\n', 'AdsDemoDestination'],
        ['iosApp/Other/Info.plist', '<dict>\n    <key>GADApplicationIdentifier</key>\n</dict>\n', 'GADApplicationIdentifier'],
        ['core/other/src/main/AndroidManifest.xml', '<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" />\n', 'com.google.android.gms.ads.APPLICATION_ID']
    ];
    for (const [rel, content, label] of leftovers) {
        const dir = await seedWithPlatform();
        try {
            await fs.outputFile(path.join(dir, rel), content);
            await assert.rejects(
                processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE),
                (err) => /Monetization residue/.test(err.message) && err.message.includes(`${path.normalize(rel)}: ${label}`),
                label
            );
        } finally {
            await fs.remove(dir);
        }
    }
});

test('assertNoMonetizationResidue reports leftover ads files and platform keys', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        for (const [rel, [withAds]] of Object.entries(PLATFORM_FILES)) {
            await fs.outputFile(path.join(dir, rel), fixture(withAds));
        }
        for (const rel of [ADS_BRIDGE_REGISTRATION, 'iosApp/iosApp/AdsBridge.swift', PACKAGE_RESOLVED]) {
            await fs.outputFile(path.join(dir, rel), IOS_ADS_FILES[rel]);
        }
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false }), (err) => {
            for (const expected of [
                `${path.normalize(ADS_BRIDGE_REGISTRATION)}: file still present`,
                `${path.normalize('iosApp/iosApp/AdsBridge.swift')}: file still present`,
                `${path.normalize(PACKAGE_RESOLVED)}: file still present`,
                `${path.normalize('iosApp/iosApp/Info.plist')}: GADApplicationIdentifier`,
                `${path.normalize('iosApp/iosApp/Info.plist')}: SKAdNetworkItems`,
                `${path.normalize('iosApp/iosApp/Info.plist')}: NSUserTrackingUsageDescription`,
                `${path.normalize('androidApp/src/main/AndroidManifest.xml')}: com.google.android.gms.ads.APPLICATION_ID`,
                `${path.normalize('iosApp/iosApp.xcodeproj/project.pbxproj')}: swift-package-manager-google-mobile-ads`,
                `${path.normalize('iosApp/iosApp/iOSApp.swift')}: AdsBridgeRegistrationKt`,
                `${path.normalize('iosApp/iosApp/iOSApp.swift')}: registerAdsBridge`
            ]) {
                assert.ok(err.message.includes(expected), `${expected}\n${err.message}`);
            }
            return true;
        });
        // Ads on: none of it is looked for
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: true });

        // The without-ads platform files are clean
        const clean = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            for (const [rel, [, withoutAds]] of Object.entries(PLATFORM_FILES)) {
                await fs.outputFile(path.join(clean, rel), fixture(withoutAds));
            }
            await assertNoMonetizationResidue(clean, NEW_PACKAGE, { purchases: false, ads: false });
        } finally {
            await fs.remove(clean);
        }
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue ignores an app name or bundle id that spells an ads token', async () => {
    const appNames = ['AdsBridge', 'IosAdsBridge', 'AdsDemoDestination', 'registerAdsBridge', 'AdsBridgeRegistrationKt',
        'projects.core.ads', 'GoogleMobileAds', '<key>GADApplicationIdentifier</key>',
        'com.google.android.gms.ads.APPLICATION_ID', 'XCRemoteSwiftPackageReference "swift-package-manager-google-mobile-ads"'];
    const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const appName of appNames) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            await fs.outputFile(path.join(dir, 'build-logic/src/main/kotlin/config/AppConfig.kt'),
                `object AppConfig {\n    const val appName = "${appName.replace(/"/g, '\\"')}"\n}\n`);
            await fs.outputFile(path.join(dir, 'settings.gradle.kts'), `rootProject.name = "${appName.replace(/[^A-Za-z0-9]/g, '')}"\n`);
            await fs.outputFile(path.join(dir, 'androidApp/src/main/res/values/strings.xml'),
                `<resources>\n    <string name="app_name">${escapeXml(appName)}</string>\n</resources>\n`);
            await fs.outputFile(path.join(dir, 'iosApp/iosApp/Info.plist'),
                `<plist version="1.0">\n    <dict>\n        <key>CFBundleDisplayName</key>\n        <string>${escapeXml(appName)}</string>\n    </dict>\n</plist>\n`);
            await fs.outputFile(path.join(dir, 'iosApp/Configuration/Config.xcconfig'), `APP_NAME=${appName}\n`);
            await fs.outputFile(path.join(dir, 'iosApp/iosApp.xcodeproj/project.pbxproj'),
                fixture('project.without-ads.pbxproj').replace('objectVersion = 77;', 'objectVersion = 77;\n\t/* PRODUCT_BUNDLE_IDENTIFIER = com.google.android.gms.ads.app; */'));
            await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
        } finally {
            await fs.remove(dir);
        }
    }

    // A package under com.google.android.gms.ads is the user's own
    const pkg = 'com.google.android.gms.ads';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'build-logic/src/main/kotlin/config/AppConfig.kt'), `object AppConfig {\n    const val applicationId = "${pkg}"\n}\n`);
        await fs.outputFile(path.join(dir, 'androidApp/src/main/AndroidManifest.xml'), fixture('AndroidManifest.without-ads.xml'));
        await assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false });
    } finally {
        await fs.remove(dir);
    }

    // A package under com.google.android.libraries.ads.mobile.sdk is the user's own: its package
    // lines, applicationId and imports of its own code are not the Next-Gen SDK
    const sdkPkg = 'com.google.android.libraries.ads.mobile.sdk';
    const sdkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(sdkDir, 'build-logic/src/main/kotlin/config/AppConfig.kt'), `object AppConfig {\n    const val applicationId = "${sdkPkg}"\n}\n`);
        await fs.outputFile(path.join(sdkDir, `core/common/src/commonMain/kotlin/${sdkPkg.replace(/\./g, '/')}/core/common/A.kt`),
            `package ${sdkPkg}.core.common\n\nimport ${sdkPkg}.core.common.B\nimport ${sdkPkg}.AppKt\n`);
        // AppKt is the facade of the user's own App.kt (a single name under an SDK package is the
        // user's only when the package declares it, review M1)
        await fs.outputFile(path.join(sdkDir, `shared/src/commonMain/kotlin/${sdkPkg.replace(/\./g, '/')}/App.kt`),
            `package ${sdkPkg}\n\nfun App() = Unit\n`);
        await fs.outputFile(path.join(sdkDir, 'androidApp/src/main/AndroidManifest.xml'), fixture('AndroidManifest.without-ads.xml'));
        await assertNoMonetizationResidue(sdkDir, sdkPkg, { purchases: false, ads: false });
    } finally {
        await fs.remove(sdkDir);
    }
});

// --- Review M1: RevenueCat (and GMA) need INTERNET even without core:network ---

const MANIFEST = 'androidApp/src/main/AndroidManifest.xml';
const INTERNET = '<uses-permission android:name="android.permission.INTERNET" />';

for (const [purchases, ads, kept] of [[true, false, true], [false, true, true], [true, true, true], [false, false, false]]) {
    test(`network=false, purchases=${purchases}, ads=${ads} ${kept ? 'keeps' : 'removes'} the INTERNET permission`, async () => {
        const dir = await seed();
        try {
            await fs.outputFile(path.join(dir, MANIFEST), fixture('AndroidManifest.with-ads.xml'));
            await processCoreFeatures(dir, { ...ALL_ON, network: false, purchases, ads }, NEW_PACKAGE);
            const manifest = await read(dir, MANIFEST);
            assert.equal(manifest.includes(INTERNET), kept, manifest);
        } finally {
            await fs.remove(dir);
        }
    });
}

// --- Review M3: custom modules named like a monetization screen are clones of feature/sample ---

// What cloning feature/sample as <name> leaves (the destination and its uses)
const userModuleFiles = (name) => {
    const cap = name[0].toUpperCase() + name.slice(1);
    return {
        [`feature/${name}/contract/src/commonMain/kotlin/${PKG}/feature/${name}/contract/Screens.kt`]:
            `package ${NEW_PACKAGE}.feature.${name}.contract\n\n@Serializable\ndata object ${cap}Destination : NavigationCommand.Destination\n`,
        [`feature/${name}/presentation/src/commonMain/kotlin/${PKG}/feature/${name}/presentation/navigation/${cap}Entry.kt`]:
            `package ${NEW_PACKAGE}.feature.${name}.presentation.navigation\n\nimport ${NEW_PACKAGE}.feature.${name}.contract.${cap}Destination\n\n` +
            `class ${cap}Entry {\n    val destination = ${cap}Destination\n}\n`
    };
};

for (const [purchases, ads] of [[false, false], [false, true], [true, false]]) {
    test(`custom modules paywall and adsdemo are not monetization residue (purchases=${purchases}, ads=${ads})`, async () => {
        const dir = await seed();
        try {
            for (const name of ['paywall', 'adsdemo']) {
                for (const [rel, content] of Object.entries(userModuleFiles(name))) {
                    await fs.outputFile(path.join(dir, rel), content);
                }
            }
            await processCoreFeatures(dir, { ...ALL_ON, purchases, ads }, NEW_PACKAGE);
            for (const name of ['paywall', 'adsdemo']) {
                for (const [rel, content] of Object.entries(userModuleFiles(name))) {
                    assert.equal(await read(dir, rel), content, rel);
                }
            }
        } finally {
            await fs.remove(dir);
        }
    });
}

test('a monetization class left outside the custom modules is still residue', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        for (const [rel, content] of Object.entries(userModuleFiles('paywall'))) {
            await fs.outputFile(path.join(dir, rel), content);
        }
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/MainScreen.kt`), 'val start = PaywallDestination\nval ads = AdsDemoDestination\n');
        await fs.outputFile(path.join(dir, `${CONTRACT_SRC}/Left.kt`), 'val left = PaywallDestination\n');
        // Another monetization class inside a custom module is residue (only its own class names are masked)
        await fs.outputFile(path.join(dir, `feature/paywall/presentation/src/commonMain/kotlin/${PKG}/feature/paywall/presentation/Ads.kt`),
            'val ads = AdsDemoDestination\n');
        // A RevenueCat import inside a custom module is residue as well (only class names are its own)
        await fs.outputFile(path.join(dir, `feature/paywall/data/src/commonMain/kotlin/${PKG}/feature/paywall/data/Repo.kt`),
            'import com.revenuecat.purchases.kmp.Purchases\n');
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false }), (err) => {
            assert.ok(err.message.includes('MainScreen.kt: PaywallDestination'), err.message);
            assert.ok(err.message.includes('MainScreen.kt: AdsDemoDestination'), err.message);
            assert.ok(err.message.includes('Left.kt: PaywallDestination'), err.message);
            assert.ok(err.message.includes('Repo.kt: com.revenuecat'), err.message);
            assert.ok(err.message.includes('Ads.kt: AdsDemoDestination'), err.message);
            assert.ok(!err.message.includes('Screens.kt'), err.message);
            assert.ok(!err.message.includes('PaywallEntry.kt'), err.message);
            return true;
        });
    } finally {
        await fs.remove(dir);
    }
});

// --- Review M4: a package under com.revenuecat with both flags off and no custom modules ---

test('package com.revenuecat.app: the showcase feature imports initKoin still has are the user\'s own', async () => {
    const pkg = 'com.revenuecat.app';
    const pkgPath = pkg.replace(/\./g, '/');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        // No feature/ package line anywhere: home/onboarding are gone, their imports go after the check
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/di/initKoin.kt`), [
            `package ${pkg}.di`,
            '',
            `import ${pkg}.feature.home.presentation.di.HomePresentationModule`,
            `import ${pkg}.feature.onboarding.data.di.OnboardingDataModule`,
            `import ${pkg}.core.navigation.NavigationModule`,
            ''
        ].join('\n'));
        await assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false });

        // RevenueCat's own SDK import is still caught
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Left.kt`),
            `package ${pkg}\n\nimport com.revenuecat.purchases.kmp.Purchases\n`);
        await assert.rejects(assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false }),
            (err) => err.message.includes('Left.kt: com.revenuecat') && !err.message.includes('initKoin.kt'));
    } finally {
        await fs.remove(dir);
    }
});

// --- Gate fixes (monetization A2) ---

// Ruling: with purchases off, PremiumAdFreeSource's own test goes with it (it fakes PurchasesManager,
// so the generated project's tests would not compile)
test('purchases=false, ads=true also removes PremiumAdFreeSourceTest and keeps the other ads tests', async () => {
    const dir = await seed();
    try {
        const premiumTest = `${PRESENTATION_TEST}/ads/PremiumAdFreeSourceTest.kt`;
        const demoTest = `${PRESENTATION_TEST}/ads/AdsDemoViewModelTest.kt`;
        await fs.outputFile(path.join(dir, premiumTest),
            `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\nimport ${NEW_PACKAGE}.core.purchases.PurchasesManager\n\nclass PremiumAdFreeSourceTest\n`);
        await fs.outputFile(path.join(dir, demoTest), `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\nclass AdsDemoViewModelTest\n`);

        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: true }, NEW_PACKAGE);

        assert.equal(await exists(dir, premiumTest), false);
        assert.equal(await exists(dir, demoTest), true);
        assert.equal(await exists(dir, `${PRESENTATION_SRC}/ads/PremiumAdFreeSource.kt`), false);
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=true keeps PremiumAdFreeSourceTest', async () => {
    const dir = await seed();
    try {
        const premiumTest = `${PRESENTATION_TEST}/ads/PremiumAdFreeSourceTest.kt`;
        await fs.outputFile(path.join(dir, premiumTest), `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n`);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: true }, NEW_PACKAGE);
        assert.equal(await exists(dir, premiumTest), true);
    } finally {
        await fs.remove(dir);
    }
});

// Review M1: a package equal to an SDK package must not hide that SDK's leftover imports
test('package com.revenuecat.purchases.kmp: a leftover RevenueCat SDK import is still residue', async () => {
    const pkg = 'com.revenuecat.purchases.kmp';
    const pkgPath = pkg.replace(/\./g, '/');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/App.kt`), `package ${pkg}\n\nfun App() = Unit\n`);
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/di/initKoin.kt`), [
            `package ${pkg}.di`,
            '',
            `import ${pkg}.App`,
            `import ${pkg}.AppKt`,
            `import ${pkg}.core.navigation.NavigationModule`,
            `import ${pkg}.feature.home.presentation.di.HomePresentationModule`,
            ''
        ].join('\n'));
        // The user's own code only: clean
        await assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false });

        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Left.kt`),
            `package ${pkg}\n\nimport com.revenuecat.purchases.kmp.Purchases\n`);
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/core/ui/Paywall.kt`),
            `package ${pkg}.ui\n\nimport com.revenuecat.purchases.kmp.ui.revenuecatui.Paywall\n`);
        await assert.rejects(assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false }), (err) => {
            assert.ok(err.message.includes('Left.kt: com.revenuecat'), err.message);
            assert.ok(err.message.includes('Paywall.kt: com.revenuecat'), err.message);
            assert.ok(!err.message.includes('initKoin.kt'), err.message);
            return true;
        });
    } finally {
        await fs.remove(dir);
    }
});

test('package com.google.android.libraries.ads.mobile.sdk: a leftover Next-Gen SDK import is still residue', async () => {
    const pkg = 'com.google.android.libraries.ads.mobile.sdk';
    const pkgPath = pkg.replace(/\./g, '/');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Left.kt`),
            `package ${pkg}\n\nimport ${pkg}.MobileAds\n`);
        await assert.rejects(assertNoMonetizationResidue(dir, pkg, { purchases: true, ads: false }),
            (err) => err.message.includes('Left.kt: import com.google.android.libraries.ads.mobile.sdk'));
    } finally {
        await fs.remove(dir);
    }
});

// Review M2: the Swift, pbxproj and manifest spellings the tokens used to miss
test('assertNoMonetizationResidue catches attributed Swift imports, UMP, a bare GMA repositoryURL and any manifest attribute order', async () => {
    const cases = [
        ['iosApp/iosApp/AdsView.swift', '@preconcurrency import GoogleMobileAds\n', 'import GoogleMobileAds'],
        ['iosApp/iosApp/Consent.swift', 'import UserMessagingPlatform\n', 'import UserMessagingPlatform'],
        ['iosApp/iosApp.xcodeproj/project.pbxproj',
            '// !$*UTF8*$!\n{\n\t\t\trepositoryURL = "https://github.com/googleads/swift-package-manager-google-mobile-ads";\n}\n',
            'swift-package-manager-google-mobile-ads'],
        [MANIFEST,
            '<manifest>\n    <application>\n        <meta-data\n            android:value="ca-app-pub-3940256099942544~3347511713"\n            android:name="com.google.android.gms.ads.APPLICATION_ID" />\n    </application>\n</manifest>\n',
            'com.google.android.gms.ads.APPLICATION_ID'],
        [MANIFEST,
            "<manifest>\n    <application>\n        <meta-data android:name='com.google.android.gms.ads.APPLICATION_ID' android:value='x' />\n    </application>\n</manifest>\n",
            'com.google.android.gms.ads.APPLICATION_ID']
    ];
    for (const [rel, content, label] of cases) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            await fs.outputFile(path.join(dir, rel), content);
            await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false }),
                (err) => err.message.includes(`${path.normalize(rel)}: ${label}`) || assert.fail(err.message), label);
            // Ads on: not residue
            await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: true });
        } finally {
            await fs.remove(dir);
        }
    }
});

// The template now commits Package.resolved: with ads off it goes, and so do the directories it
// alone kept (the template before it had only contents.xcworkspacedata); anything else there stays
test('ads=false leaves no empty swiftpm/xcshareddata directories behind Package.resolved', async () => {
    const workspace = 'iosApp/iosApp.xcodeproj/project.xcworkspace';
    const dir = await seedWithPlatform();
    try {
        await fs.outputFile(path.join(dir, workspace, 'contents.xcworkspacedata'), '<Workspace version = "1.0"/>\n');
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);
        assert.equal(await exists(dir, `${workspace}/xcshareddata`), false);
        assert.equal(await exists(dir, `${workspace}/contents.xcworkspacedata`), true);
    } finally {
        await fs.remove(dir);
    }

    const other = await seedWithPlatform();
    try {
        await fs.outputFile(path.join(other, workspace, 'xcshareddata/IDEWorkspaceChecks.plist'), '<plist/>\n');
        await processCoreFeatures(other, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);
        assert.equal(await exists(other, `${workspace}/xcshareddata/swiftpm`), false);
        assert.equal(await exists(other, `${workspace}/xcshareddata/IDEWorkspaceChecks.plist`), true);
    } finally {
        await fs.remove(other);
    }
});

// Spec §4 #9: Swift's kind-qualified imports (import struct GoogleMobileAds.BannerView) are residue too
test('assertNoMonetizationResidue catches kind-qualified Swift imports of GoogleMobileAds and UMP', async () => {
    const cases = [
        ['import struct GoogleMobileAds.BannerView\n', 'import GoogleMobileAds'],
        ['import class GoogleMobileAds.MobileAds\n', 'import GoogleMobileAds'],
        ['import enum GoogleMobileAds.AdFormat\n', 'import GoogleMobileAds'],
        ['@preconcurrency import protocol GoogleMobileAds.FullScreenContentDelegate\n', 'import GoogleMobileAds'],
        ['import class UserMessagingPlatform.ConsentForm\n', 'import UserMessagingPlatform'],
        ['import enum UserMessagingPlatform.ConsentStatus\n', 'import UserMessagingPlatform'],
        ['import struct UserMessagingPlatform.DebugSettings\n', 'import UserMessagingPlatform']
    ];
    for (const [content, label] of cases) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
        try {
            await fs.outputFile(path.join(dir, 'iosApp/iosApp/Left.swift'), content);
            await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false }),
                (err) => err.message.includes(`${path.normalize('iosApp/iosApp/Left.swift')}: ${label}`) || assert.fail(err.message), content);
            await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: true });
        } finally {
            await fs.remove(dir);
        }
    }
});

// Spec §4 #9: an APPLICATION_ID meta-data left only inside an XML comment does nothing; outside one it is residue
test('assertNoMonetizationResidue ignores the ads APPLICATION_ID inside an XML comment only', async () => {
    const commented = [
        '<manifest>',
        '    <application>',
        '        <!-- <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="x" /> -->',
        '        <!--',
        '        <meta-data',
        '            android:name="com.google.android.gms.ads.APPLICATION_ID"',
        '            android:value="x" />',
        '        -->',
        '    </application>',
        '</manifest>',
        ''
    ].join('\n');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, MANIFEST), commented);
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false });

        await fs.outputFile(path.join(dir, MANIFEST), commented.replace('    </application>',
            '        <!-- the ads app id -->\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="x" />\n    </application>'));
        await assert.rejects(assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false }),
            (err) => err.message.includes(`${path.normalize(MANIFEST)}: com.google.android.gms.ads.APPLICATION_ID`) || assert.fail(err.message));
    } finally {
        await fs.remove(dir);
    }
});

// Spec §4 #9: a top-level declaration annotated on the same line (@Composable fun App()) is the user's own
test('package com.revenuecat.purchases.kmp: an import of an annotated top-level declaration is the user\'s own', async () => {
    const pkg = 'com.revenuecat.purchases.kmp';
    const pkgPath = pkg.replace(/\./g, '/');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Main.kt`), [
            `package ${pkg}`,
            '',
            '@Composable fun App() = Unit',
            '',
            '@OptIn(ExperimentalFoo::class) @Composable internal fun Root() = Unit',
            ''
        ].join('\n'));
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/MainViewController.kt`), [
            `package ${pkg}.ios`,
            '',
            `import ${pkg}.App`,
            `import ${pkg}.Root`,
            ''
        ].join('\n'));
        await assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false });

        // A name the user's package does not declare is still RevenueCat's
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Left.kt`),
            `package ${pkg}.left\n\nimport ${pkg}.Purchases\n`);
        await assert.rejects(assertNoMonetizationResidue(dir, pkg, { purchases: false, ads: false }), (err) => {
            assert.ok(err.message.includes('Left.kt: com.revenuecat'), err.message);
            assert.ok(!err.message.includes('MainViewController.kt'), err.message);
            return true;
        });
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue ignores a project name that spells a token in LOG_TAG_PREFIX', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "PurchasesManager"\n');
        await fs.outputFile(path.join(dir, `core/logging/src/commonMain/kotlin/${PKG}/core/logging/LoggingConfig.kt`), [
            `package ${NEW_PACKAGE}.core.logging`,
            '',
            'internal const val LOG_TAG_PREFIX = "PurchasesManager"',
            ''
        ].join('\n'));
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
    } finally {
        await fs.remove(dir);
    }
});

// Review: core/review has no flag. Its Play Review, StoreKit and "store page" code is not
// monetization residue, and the removal of purchases and ads leaves it as it is.
const REVIEW_SRC = (sourceSet) => `core/review/src/${sourceSet}/kotlin/${PKG}/core/review`;
const REVIEW_FILES = {
    'core/review/build.gradle.kts': 'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n\nkotlin {\n    sourceSets {\n        androidMain.dependencies {\n            implementation(libs.play.review)\n            implementation(libs.play.review.ktx)\n        }\n    }\n}\n',
    [`${REVIEW_SRC('commonMain')}/ReviewPrompter.kt`]: `package ${NEW_PACKAGE}.core.review\n\nimport org.koin.core.annotation.Single\n\n@Single\nclass ReviewPrompter(private val store: ReviewCounterStore) {\n    fun openStorePage() = Unit\n}\n`,
    [`${REVIEW_SRC('commonMain')}/StoreLinks.kt`]: `package ${NEW_PACKAGE}.core.review\n\nfun appStoreWriteReviewUrl(appStoreId: String): String = "https://apps.apple.com/app/id$appStoreId?action=write-review"\n`,
    [`${REVIEW_SRC('commonMain')}/di/ReviewModule.kt`]: `package ${NEW_PACKAGE}.core.review.di\n\n@Module\nclass ReviewModule\n`,
    [`${REVIEW_SRC('androidMain')}/AndroidReviewRequester.kt`]: `package ${NEW_PACKAGE}.core.review\n\nimport com.google.android.play.core.review.ReviewManagerFactory\n\ninternal class AndroidReviewRequester : ReviewRequester\n`,
    [`${REVIEW_SRC('iosMain')}/IosReviewRequester.kt`]: `package ${NEW_PACKAGE}.core.review\n\nimport platform.StoreKit.SKStoreReviewController\n\ninternal class IosReviewRequester : ReviewRequester\n`,
    [`${REVIEW_SRC('iosMain')}/AppStoreId.kt`]: `package ${NEW_PACKAGE}.core.review\n\ninternal const val APP_STORE_ID = ""\n`
};

test('purchases and ads off: core/review is no monetization residue and stays as it is', async () => {
    const dir = await seed();
    try {
        for (const [rel, content] of Object.entries(REVIEW_FILES)) await fs.outputFile(path.join(dir, rel), content);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
        for (const [rel, content] of Object.entries(REVIEW_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    } finally {
        await fs.remove(dir);
    }
});

// Store-ready: core/about and the privacy manifest are not monetization. With ads and purchases off the
// residue check finds nothing in core/about's files or in the stripped PrivacyInfo.xcprivacy.
const { renderPrivacyManifest } = require('../src/privacyManifest');

const ABOUT_SRC = `core/about/src/commonMain/kotlin/${PKG}/core/about`;
const ABOUT_FILES = {
    'core/about/build.gradle.kts':
        'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(libs.aboutlibraries.core)\n            implementation(libs.aboutlibraries.compose.m3)\n        }\n    }\n}\n',
    [`${ABOUT_SRC}/LegalUrls.kt`]: `package ${NEW_PACKAGE}.core.about\n\nconst val PRIVACY_POLICY_URL = ""\nconst val TERMS_URL = ""\n`,
    [`${ABOUT_SRC}/AppInfo.kt`]: `package ${NEW_PACKAGE}.core.about\n\ninterface AppInfo {\n    val version: AppVersion\n    val legalLinks: List<LegalLink>\n}\n`,
    [`${ABOUT_SRC}/licenses/LicensesNavGraphProvider.kt`]:
        `package ${NEW_PACKAGE}.core.about.licenses\n\n@Single(binds = [NavGraphProvider::class])\n@Named("core.about.licenses")\ninternal class LicensesNavGraphProvider : NavGraphProvider\n`,
    [`${ABOUT_SRC}/di/AboutModule.kt`]: `package ${NEW_PACKAGE}.core.about.di\n\n@Module\n@ComponentScan("${NEW_PACKAGE}.core.about")\nclass AboutModule\n`,
    [`core/about/src/androidMain/kotlin/${PKG}/core/about/AppVersion.android.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\nimport android.content.Context\n`,
    [`core/about/src/iosMain/kotlin/${PKG}/core/about/AppVersion.ios.kt`]:
        `package ${NEW_PACKAGE}.core.about\n\nimport platform.Foundation.NSBundle\n`
};
const PRIVACY_MANIFEST_REL = 'iosApp/iosApp/PrivacyInfo.xcprivacy';

test('purchases=false, ads=false: no monetization residue in core/about or the stripped PrivacyInfo.xcprivacy', async () => {
    const dir = await seedWithPlatform();
    try {
        const template = fs.readFileSync(path.join(__dirname, 'fixtures', 'privacy', 'PrivacyInfo.template.xcprivacy'), 'utf8');
        const stripped = renderPrivacyManifest(template, { ads: false, purchases: false });
        const files = { ...ABOUT_FILES, [PRIVACY_MANIFEST_REL]: stripped };
        for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);

        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });

        for (const [rel, content] of Object.entries(files)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    } finally {
        await fs.remove(dir);
    }
});

// network-ux: core/update is not monetization. Its Play In-App Updates, App Store lookup and "open the
// store" code is no residue with ads and purchases off, and the removal leaves it as it is.
const UPDATE_SRC = (sourceSet) => `core/update/src/${sourceSet}/kotlin/${PKG}/core/update`;
const UPDATE_FILES = {
    'core/update/build.gradle.kts':
        'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n\nkotlin {\n    sourceSets {\n        androidMain.dependencies {\n            implementation(libs.play.app.update)\n            implementation(libs.play.app.update.ktx)\n        }\n    }\n}\n',
    [`${UPDATE_SRC('commonMain')}/UpdateConfig.kt`]: `package ${NEW_PACKAGE}.core.update\n\nconst val MIN_VERSION_URL = ""\n`,
    [`${UPDATE_SRC('commonMain')}/AppStoreLookup.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\ndata class StoreRelease(val version: String, val storeUrl: String)\n\ninternal fun appStoreLookupUrl(bundleId: String): String = "https://itunes.apple.com/lookup?bundleId=$bundleId"\n`,
    [`${UPDATE_SRC('commonMain')}/PlatformUpdater.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\ninterface PlatformUpdater {\n    suspend fun startRecommendedUpdate(): Boolean\n    fun openStore(url: String?)\n    fun completeUpdate()\n}\n`,
    [`${UPDATE_SRC('commonMain')}/di/UpdateModule.kt`]: `package ${NEW_PACKAGE}.core.update.di\n\n@Module\n@ComponentScan("${NEW_PACKAGE}.core.update")\nclass UpdateModule\n`,
    [`${UPDATE_SRC('androidMain')}/PlatformUpdater.android.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport com.google.android.play.core.appupdate.AppUpdateManagerFactory\nimport com.google.android.play.core.install.model.AppUpdateType\n\nprivate const val PLAY_STORE_URL = "https://play.google.com/store/apps/details?id="\n`,
    [`${UPDATE_SRC('iosMain')}/PlatformUpdater.ios.kt`]:
        `package ${NEW_PACKAGE}.core.update\n\nimport platform.Foundation.NSURL\nimport platform.UIKit.UIApplication\n`
};

test('purchases and ads off: core/update is no monetization residue and stays as it is', async () => {
    const dir = await seed();
    try {
        for (const [rel, content] of Object.entries(UPDATE_FILES)) await fs.outputFile(path.join(dir, rel), content);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
        for (const [rel, content] of Object.entries(UPDATE_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
    } finally {
        await fs.remove(dir);
    }
});

// Coil: core/image is not monetization. Its Coil loader, cache and Kermit logger are no residue with
// ads and purchases off, and the removal leaves it as it is.
const IMAGE_SRC = (sourceSet) => `core/image/src/${sourceSet}/kotlin/${PKG}/core/image`;
const IMAGE_FILES = {
    'core/image/build.gradle.kts':
        'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n    alias(libs.plugins.compose.multiplatform.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            api(libs.coil.compose)\n            implementation(projects.core.domain)\n            implementation(projects.core.logging)\n        }\n    }\n}\n',
    [`${IMAGE_SRC('commonMain')}/ImageCacheConfig.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\ninternal const val MEMORY_CACHE_PERCENT = 0.25\ninternal const val DISK_CACHE_MAX_BYTES = 50L * 1024 * 1024\n`,
    [`${IMAGE_SRC('commonMain')}/ImageLoaderFactory.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.ImageLoader\nimport coil3.PlatformContext\n\nfun newImageLoader(context: PlatformContext, isDebug: Boolean): ImageLoader = TODO()\n`,
    [`${IMAGE_SRC('commonMain')}/KermitImageLogger.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.util.Logger\n\ninternal class KermitImageLogger : Logger\n`,
    [`${IMAGE_SRC('commonMain')}/ImageLoaderSetup.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport coil3.compose.setSingletonImageLoaderFactory\n\n@Composable\nfun ImageLoaderSetup() {\n}\n`,
    [`${IMAGE_SRC('androidMain')}/ImageCacheDirectory.android.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nactual fun imageCacheDirectory(context: PlatformContext): String = context.cacheDir.absolutePath\n`,
    [`${IMAGE_SRC('iosMain')}/ImageCacheDirectory.ios.kt`]:
        `package ${NEW_PACKAGE}.core.image\n\nimport platform.Foundation.NSCachesDirectory\n`,
    [`${IMAGE_SRC('commonTest')}/ImageCacheConfigTest.kt`]: `package ${NEW_PACKAGE}.core.image\n\nclass ImageCacheConfigTest\n`
};

test('purchases and ads off: core/image is no monetization residue and stays as it is', async () => {
    const dir = await seed();
    try {
        for (const [rel, content] of Object.entries(IMAGE_FILES)) await fs.outputFile(path.join(dir, rel), content);
        await fs.writeFile(path.join(dir, 'settings.gradle.kts'),
            (await read(dir, 'settings.gradle.kts')).replace('include(":core:domain")', 'include(":core:domain")\ninclude(":core:image")'));
        await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads: false }, NEW_PACKAGE);

        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: false });
        for (const [rel, content] of Object.entries(IMAGE_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
        assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes('include(":core:image")'));
    } finally {
        await fs.remove(dir);
    }
});

// Deep links: the scheme is the project name in lower case; a project named after a token keeps it
test('assertNoMonetizationResidue ignores the deep link scheme written from the project name', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "Purchasesmanager"\n');
        await fs.outputFile(path.join(dir, `core/navigation/src/commonMain/kotlin/${PKG}/core/navigation/DeepLinkConfig.kt`), [
            `package ${NEW_PACKAGE}.core.navigation`,
            '',
            'internal const val DEEP_LINK_SCHEME = "purchasesmanager"',
            'internal const val APP_LINK_HOST = ""',
            ''
        ].join('\n'));
        await fs.outputFile(path.join(dir, 'androidApp/src/main/AndroidManifest.xml'), [
            '<intent-filter>',
            '    <action android:name="android.intent.action.VIEW" />',
            '    <data android:scheme="purchasesmanager" />',
            '</intent-filter>',
            ''
        ].join('\n'));
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: true });
    } finally {
        await fs.remove(dir);
    }
});

// Deep links: ads=false removes only the GMA keys and the AdsBridge lines; the URL type and
// .onOpenURL are not part of the ads side
const URL_TYPES = [
    '        <key>CFBundleURLTypes</key>',
    '        <array>',
    '            <dict>',
    '                <key>CFBundleURLName</key>',
    '                <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
    '                <key>CFBundleURLSchemes</key>',
    '                <array>',
    '                    <string>multiplatform</string>',
    '                </array>',
    '            </dict>',
    '        </array>'
].join('\n');
const ON_OPEN_URL = [
    '            ContentView()',
    '                // Deep links (multiplatform://…, Universal Links once set up): Kotlin opens the screen',
    '                .onOpenURL { url in _ = DeepLinksKt.handleDeepLink(uri: url.absoluteString) }'
].join('\n');
const withUrlTypes = (plist) => plist.replace(/(<key>UIApplicationSceneManifest<\/key>\s*<dict>[\s\S]*?\n[ \t]*<\/dict>)/, `$1\n${URL_TYPES}`);
const withOnOpenUrl = (swift) => swift.replace('            ContentView()', ON_OPEN_URL);

test('ads=false keeps the deep link URL type in Info.plist byte for byte and .onOpenURL in iOSApp.swift', async () => {
    const plistWithAds = withUrlTypes(fixture('Info.with-ads.plist'));
    const swiftWithAds = withOnOpenUrl(fixture('iOSApp.with-ads.swift'));
    assert.ok(plistWithAds.includes(URL_TYPES) && swiftWithAds.includes(ON_OPEN_URL));
    const dir = await seedWithPlatform();
    try {
        await fs.writeFile(path.join(dir, 'iosApp/iosApp/Info.plist'), plistWithAds);
        await fs.writeFile(path.join(dir, 'iosApp/iosApp/iOSApp.swift'), swiftWithAds);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);

        const plist = await read(dir, 'iosApp/iosApp/Info.plist');
        assert.equal(plist, withUrlTypes(fixture('Info.without-ads.plist')));
        assert.ok(plist.includes(URL_TYPES), plist);
        for (const key of ['GADApplicationIdentifier', 'NSUserTrackingUsageDescription', 'SKAdNetworkItems']) {
            assert.ok(!plist.includes(key), `Info.plist must not contain ${key}`);
        }
        const swift = await read(dir, 'iosApp/iosApp/iOSApp.swift');
        assert.equal(swift, withOnOpenUrl(fixture('iOSApp.without-ads.swift')));
        assert.ok(swift.includes(ON_OPEN_URL), swift);
        assert.ok(!swift.includes('registerAdsBridge'), swift);
        await assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false });
    } finally {
        await fs.remove(dir);
    }
});

test('purchases=false drops the FirstLaunchPaywall lines from MainScreen and leaves no blank line behind', async () => {
    for (const ads of [true, false]) {
        const dir = await seed();
        try {
            await fs.outputFile(path.join(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
            await processCoreFeatures(dir, { ...ALL_ON, purchases: false, ads }, NEW_PACKAGE);

            const mainScreen = await read(dir, MAIN_SCREEN);
            assert.equal(mainScreen, MAIN_SCREEN_CONTENT.split('\n').filter((l) => !l.includes('FirstLaunchPaywall')).join('\n'), `ads=${ads}`);
            assert.doesNotMatch(mainScreen, /\n\n\}/, 'blank line before the closing brace');
            assert.doesNotMatch(mainScreen, /\n\n\n/, 'two blank lines in a row');
        } finally {
            await fs.remove(dir);
        }
    }
});

test('purchases=true keeps FirstLaunchPaywall in MainScreen', async () => {
    const dir = await seed();
    try {
        await fs.outputFile(path.join(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);
        assert.equal(await read(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue reports FirstLaunchPaywall and FirstPaywallStore when purchases is off', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, MAIN_SCREEN), MAIN_SCREEN_CONTENT);
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/Leftover.kt`),
            `package ${NEW_PACKAGE}\n\nval store: FirstPaywallStore? = null\n`);
        await assert.rejects(
            assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: false, ads: true }),
            (err) => err.message.includes('MainScreen.kt: FirstLaunchPaywall') &&
                err.message.includes('Leftover.kt: FirstPaywallStore')
        );
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoMonetizationResidue reports InterstitialPacer when ads is off', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monetization-'));
    try {
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${PKG}/Leftover.kt`),
            `package ${NEW_PACKAGE}\n\nfun pacer(): InterstitialPacer? = null\n`);
        await assert.rejects(
            assertNoMonetizationResidue(dir, NEW_PACKAGE, { purchases: true, ads: false }),
            (err) => err.message.includes('Leftover.kt: InterstitialPacer')
        );
    } finally {
        await fs.remove(dir);
    }
});

test('ads=false removes InterstitialPacerProvider with the ads demo', async () => {
    const dir = await seed();
    try {
        await fs.outputFile(path.join(dir, `${PRESENTATION_SRC}/ads/InterstitialPacerProvider.kt`),
            `package ${NEW_PACKAGE}.feature.monetization.presentation.ads\n\nimport ${NEW_PACKAGE}.core.ads.InterstitialPacer\n\nfun provideInterstitialPacer(): InterstitialPacer = InterstitialPacer()\n`);
        await fs.outputFile(path.join(dir, `${ADS_SRC}/InterstitialPacer.kt`), `package ${NEW_PACKAGE}.core.ads\n\nclass InterstitialPacer\n`);
        await processCoreFeatures(dir, { ...ALL_ON, purchases: true, ads: false }, NEW_PACKAGE);
        assert.equal(await exists(dir, `${PRESENTATION_SRC}/ads/InterstitialPacerProvider.kt`), false);
        assert.equal(await exists(dir, 'core/ads'), false);
    } finally {
        await fs.remove(dir);
    }
});
