const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processBlankApp, wireFeatureModules } = require('../src/fileService');

const NEW_PACKAGE = 'dev.cmpose.app';
const FEATURES = ['profile'];

// detekt/detekt.yml (the real template, 667 lines) turns TrailingWhitespace into a build
// failure: `e: MainScreen.kt:22:1 Line 22 ends with a whitespace. [TrailingWhitespace]`.
// Every line ending in a space or tab (before an optional \r and the newline) trips it.
const TRAILING_WHITESPACE = /[ \t]+\r?$/m;

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-blank-sources-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// A fully-normalized featuresConfig: all six booleans present, all `true` except detekt
// (so the "Detekt enabled" branch of processCoreFeatures, which is what a real
// detekt-checked generation exercises, is skipped here and only the removal branch -
// fully defensive on a missing detekt/ folder - runs). This mirrors the actual payload
// that produced the TrailingWhitespace failure (detekt:true in production; kept false
// here only so the minimal fixture below doesn't need a detekt/detekt.yml on disk).
function normalizedConfig(overrides) {
    return {
        network: true,
        networkInspector: true,
        theming: true,
        multiLang: true,
        dataStore: true,
        detekt: false,
        ...overrides
    };
}

const INIT_KOIN = [
    '@file:Suppress("Filename")',
    '',
    'package dev.cmpose.app.di',
    '',
    'import dev.cmpose.app.core.navigation.NavigationModule',
    'import org.koin.core.module.Module as KoinModule',
    'import org.koin.ksp.generated.module',
    '',
    'fun appModules(): List<KoinModule> = buildList {',
    '    add(NavigationModule().module)',
    '    add(CmpModule().module)',
    '}',
    ''
].join('\n');

// The generator no longer writes module sources or a MainScreen; the only Kotlin it still
// edits is what the template ships. The fixture therefore seeds initKoin.kt (which wiring and
// blank cleanup rewrite) so the whitespace / EOF assertions below have a file to check.
async function setupMinimalFixture(dir, packageName) {
    const packagePath = packageName.replace(/\./g, '/');
    await fs.ensureDir(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath));
    await fs.outputFile(path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', packagePath, 'di', 'initKoin.kt'), INIT_KOIN);
}

async function collectKotlinFiles(dir) {
    const results = [];

    async function walk(current) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(entryPath);
            } else if (entry.name.endsWith('.kt') || entry.name.endsWith('.kts')) {
                results.push(entryPath);
            }
        }
    }

    await walk(dir);
    return results;
}

test('processBlankApp + wireFeatureModules never emit a .kt/.kts line with trailing whitespace', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await setupMinimalFixture(dir, NEW_PACKAGE);

        await wireFeatureModules(dir, NEW_PACKAGE, FEATURES);
        await processBlankApp(dir, NEW_PACKAGE, FEATURES, normalizedConfig());

        const kotlinFiles = await collectKotlinFiles(dir);
        assert.ok(kotlinFiles.length > 0, 'fixture should have produced at least one .kt/.kts file');

        const offenders = [];
        for (const filePath of kotlinFiles) {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                if (TRAILING_WHITESPACE.test(line)) {
                    offenders.push(`${path.relative(dir, filePath)}:${index + 1}`);
                }
            });
        }

        assert.deepEqual(offenders, [], `detekt's TrailingWhitespace rule would fail on:\n${offenders.join('\n')}`);
    });
});

// detekt's NewLineAtEndOfFile rule fails the build when a source file's last byte isn't
// `\n` (e.g. `e: ProfileScreen.kt:64:2 The file ... is not ending with a new line.`).
// We also check for MORE than one trailing newline: detekt's style rules are strict
// about blank lines, and a generator that got the EOF newline right should not then
// leave stray blank lines behind either.
test('processBlankApp + wireFeatureModules never emit a .kt/.kts file with a missing or doubled trailing newline', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await setupMinimalFixture(dir, NEW_PACKAGE);

        await wireFeatureModules(dir, NEW_PACKAGE, FEATURES);
        await processBlankApp(dir, NEW_PACKAGE, FEATURES, normalizedConfig());

        const kotlinFiles = await collectKotlinFiles(dir);
        assert.ok(kotlinFiles.length > 0, 'fixture should have produced at least one .kt/.kts file');

        const offenders = [];
        for (const filePath of kotlinFiles) {
            const content = await fs.readFile(filePath, 'utf8');
            if (content.length === 0) {
                continue; // an empty file has no line to end wrongly
            }
            if (!content.endsWith('\n')) {
                offenders.push(`${path.relative(dir, filePath)}: missing trailing newline`);
            } else if (content.endsWith('\n\n')) {
                offenders.push(`${path.relative(dir, filePath)}: more than one trailing newline`);
            }
        }

        assert.deepEqual(offenders, [], `detekt's NewLineAtEndOfFile rule (or a stray-blank-line rule) would fail on:\n${offenders.join('\n')}`);
    });
});

// Every custom module registers its three Koin modules in appModules(), at the list's
// indentation, with imports in the .feature. package (the clone's package).
test('wireFeatureModules registers presentation, data and domain of every module in appModules()', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await setupMinimalFixture(dir, NEW_PACKAGE);
        const initKoinPath = path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'cmpose', 'app', 'di', 'initKoin.kt');
        await fs.ensureDir(path.dirname(initKoinPath));
        await fs.writeFile(initKoinPath, INIT_KOIN);

        await wireFeatureModules(dir, NEW_PACKAGE, ['profile', 'cart']);

        const out = await fs.readFile(initKoinPath, 'utf8');
        assert.ok(out.includes([
            '    add(CmpModule().module)',
            '    add(ProfilePresentationModule().module)',
            '    add(ProfileDataModule().module)',
            '    add(ProfileDomainModule().module)',
            '    add(CartPresentationModule().module)',
            '    add(CartDataModule().module)',
            '    add(CartDomainModule().module)',
            '}'
        ].join('\n')), out);
        for (const imp of [
            'import dev.cmpose.app.feature.profile.presentation.di.ProfilePresentationModule',
            'import dev.cmpose.app.feature.profile.data.di.ProfileDataModule',
            'import dev.cmpose.app.feature.profile.domain.di.ProfileDomainModule',
            'import dev.cmpose.app.feature.cart.domain.di.CartDomainModule'
        ]) {
            assert.ok(out.includes(imp), `${imp}\n${out}`);
        }
        assert.ok(out.includes('import org.koin.core.module.Module as KoinModule'), out);
        // Wiring does not write layer build files: those come from the clone
        assert.ok(!(await fs.pathExists(path.join(dir, 'feature', 'profile', 'presentation', 'build.gradle.kts'))));
    });
});

// compass-kit's detekt (Compass's gate) runs ktlint's ImportOrdering: lexicographic, then java, javax,
// kotlin, and aliased imports last. A plain sort put `Module as KoinModule` between the org.koin lines.
function importBlock(content) {
    return content.split('\n').filter((line) => line.startsWith('import '));
}

for (const [packageName, label] of [[NEW_PACKAGE, 'a package before org.koin'], ['zz.app', 'a package after org.koin']]) {
    test(`wireFeatureModules keeps initKoin imports in ktlint order, aliases last (${label})`, async (t) => {
        t.mock.method(console, 'log', () => { });

        await withTempDir(async (dir) => {
            const initKoinPath = path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', ...packageName.split('.'), 'di', 'initKoin.kt');
            await fs.outputFile(initKoinPath, INIT_KOIN.replace(/dev\.cmpose\.app/g, packageName));

            await wireFeatureModules(dir, packageName, ['profile']);

            const imports = importBlock(await fs.readFile(initKoinPath, 'utf8'));
            const aliased = imports.filter((line) => / as \S+$/.test(line));
            const plain = imports.filter((line) => !/ as \S+$/.test(line));
            assert.deepEqual(imports, [...plain, ...aliased], 'aliased imports come last');
            assert.deepEqual(plain, [...plain].sort(), 'the rest is lexicographic');
            assert.deepEqual(aliased, ['import org.koin.core.module.Module as KoinModule']);
            assert.ok(plain.includes(`import ${packageName}.feature.profile.data.di.ProfileDataModule`), imports.join('\n'));
        });
    });
}

// Blank no longer writes a MainScreen (it comes from the template's blank/ overlay) and no
// longer deletes feature/home|onboarding (a clone may carry that name).
test('processBlankApp leaves MainScreen and cloned home modules alone', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        await setupMinimalFixture(dir, NEW_PACKAGE);
        const mainScreen = path.join(dir, 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'cmpose', 'app', 'MainScreen.kt');
        await fs.writeFile(mainScreen, 'package dev.cmpose.app\n// from the overlay\n');
        const clonedHome = path.join(dir, 'feature', 'home', 'presentation', 'build.gradle.kts');
        await fs.outputFile(clonedHome, 'plugins { }\n');

        await processBlankApp(dir, NEW_PACKAGE, ['home'], normalizedConfig());

        assert.equal(await fs.readFile(mainScreen, 'utf8'), 'package dev.cmpose.app\n// from the overlay\n');
        assert.ok(await fs.pathExists(clonedHome));
    });
});

test('processBlankApp without custom modules removes the feature directory', async (t) => {
    t.mock.method(console, 'log', () => { });
    t.mock.method(console, 'warn', () => { });

    await withTempDir(async (dir) => {
        await setupMinimalFixture(dir, NEW_PACKAGE);
        await fs.outputFile(path.join(dir, 'feature', 'home', 'data', 'build.gradle.kts'), 'plugins { }\n');

        await processBlankApp(dir, NEW_PACKAGE, [], normalizedConfig());

        assert.ok(!(await fs.pathExists(path.join(dir, 'feature'))));
    });
});
