const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { processBlankApp, wireFeatureModules, assertNoRoomResidue } = require('../src/fileService');

// The seed is the template after applyBlankShell, cloneFeatureModules and the package move: the
// package is dev.cmpose.app, feature/home, feature/onboarding and feature/sample are gone (their
// lines are not), and with room on blank/layers/room has put the Notes-only AppDatabase.kt in place
const NEW_PACKAGE = 'dev.cmpose.app';
const PKG = 'dev/cmpose/app';
const ROOM_DIR = (sourceSet) => `core/room/src/${sourceSet}/kotlin/${PKG}/core/room`;
const NOTES_SRC = (layer) => `feature/notes/${layer}/src/commonMain/kotlin/${PKG}/feature/notes/${layer}`;
const INIT_KOIN = `shared/src/commonMain/kotlin/${PKG}/di/initKoin.kt`;

// Every other flag on (monetization off): only the Room and monetization blocks act on the tree
const ALL_ON = { network: true, networkInspector: true, theming: true, multiLang: true, dataStore: true, detekt: true };

// settings.gradle.kts of the template (room release), trimmed to its includes
const SETTINGS = [
    'rootProject.name = "Multiplatform"',
    'enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")',
    '',
    'include(":shared")',
    'include(":androidApp")',
    'include(":core:database")',
    'include(":core:designsystem")',
    'include(":core:domain")',
    'include(":core:multilang")',
    'include(":core:navigation")',
    'include(":core:network")',
    'include(":core:presentation")',
    'include(":core:room")',
    'include(":feature:home")',
    'include(":feature:home:contract")',
    'include(":feature:home:data")',
    'include(":feature:home:domain")',
    'include(":feature:home:presentation")',
    'include(":feature:onboarding")',
    'include(":feature:onboarding:contract")',
    'include(":feature:onboarding:data")',
    'include("feature:onboarding:domain")',
    'include("feature:onboarding:presentation")',
    'include(":feature:notes")',
    'include(":feature:notes:contract")',
    'include(":feature:notes:presentation")',
    'includeBuild("build-logic")'
].join('\n');

// shared/build.gradle.kts of the template: the Notes demo is not wired
const SHARED_BUILD = [
    'plugins {',
    '    alias(libs.plugins.kmp.library.plugin)',
    '    alias(libs.plugins.compose.multiplatform.plugin)',
    '}',
    '',
    'kotlin {',
    '    sourceSets {',
    '        commonMain.dependencies {',
    '            implementation(projects.core.database)',
    '            implementation(projects.core.domain)',
    '            implementation(projects.core.multilang)',
    '            implementation(projects.core.navigation)',
    '            implementation(projects.core.network)',
    '            implementation(projects.core.room)',
    '            implementation(projects.feature.home.data)',
    '            implementation(projects.feature.home.domain)',
    '            implementation(projects.feature.home.presentation)',
    '            implementation(projects.feature.onboarding.data)',
    '            implementation(projects.feature.onboarding.domain)',
    '            implementation(projects.feature.onboarding.presentation)',
    '            implementation(projects.feature.onboarding.contract)',
    '            implementation(projects.core.designsystem)',
    '        }',
    '        // KoinGraphTest reads constructors through Kotlin reflection, which is JVM only.',
    '        getByName("androidHostTest").dependencies {',
    '            implementation(libs.kotlin.reflect)',
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
    `import ${NEW_PACKAGE}.core.room.di.RoomModule`,
    `import ${NEW_PACKAGE}.feature.home.data.di.HomeDataModule`,
    `import ${NEW_PACKAGE}.feature.home.domain.di.HomeDomainModule`,
    `import ${NEW_PACKAGE}.feature.home.presentation.di.HomePresentationModule`,
    `import ${NEW_PACKAGE}.feature.onboarding.data.di.OnboardingDataModule`,
    `import ${NEW_PACKAGE}.feature.onboarding.domain.di.OnboardingDomainModule`,
    `import ${NEW_PACKAGE}.feature.onboarding.presentation.di.OnboardingPresentationModule`,
    'import org.koin.core.annotation.ComponentScan',
    'import org.koin.core.annotation.Module',
    'import org.koin.ksp.generated.module',
    'import org.koin.core.module.Module as KoinModule',
    '',
    'fun appModules(): List<KoinModule> = buildList {',
    '    add(NavigationModule().module)',
    '    add(OnboardingPresentationModule().module)',
    '    add(OnboardingDataModule().module)',
    '    add(OnboardingDomainModule().module)',
    '    add(NetworkModule().module)',
    '    add(CmpModule().module)',
    '    add(HomeDataModule().module)',
    '    add(HomeDomainModule().module)',
    '    add(HomePresentationModule().module)',
    '    add(DatabaseModule().module)',
    '    add(RoomModule().module)',
    '    add(MultiLangModule().module)',
    '}',
    '',
    '@Module',
    `@ComponentScan("${NEW_PACKAGE}")`,
    'class CmpModule',
    ''
].join('\n');

// gradle/libs.versions.toml of the template (trimmed; no trailing newline, as in the template)
const TOML = [
    '[versions]',
    'kotlin = "2.3.21"',
    'room = "2.8.5"',
    'sqlite = "2.6.2"',
    'turbine = "1.2.1"',
    '',
    '[libraries]',
    'turbine = { module = "app.cash.turbine:turbine", version.ref = "turbine" }',
    'androidx-room-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }',
    'androidx-room-compiler = { module = "androidx.room:room-compiler", version.ref = "room" }',
    'androidx-sqlite-bundled = { module = "androidx.sqlite:sqlite-bundled", version.ref = "sqlite" }',
    '',
    '[plugins]',
    'kotlinMultiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }',
    'room = { id = "androidx.room", version.ref = "room" }'
].join('\n');

// The root build.gradle.kts of the template: no Room line (core/room applies the plugin itself)
const ROOT_BUILD = [
    'plugins {',
    '    alias(libs.plugins.androidApplication) apply false',
    '    alias(libs.plugins.kotlinMultiplatform) apply false',
    '}',
    ''
].join('\n');

// README.md of the template: the Room section with its two sub-blocks, between two ordinary sections
const README = [
    '# Multiplatform',
    '',
    '## Setup',
    '',
    'Open the project.',
    '',
    '<!-- cmpose:room -->',
    '## Local database (Room)',
    '',
    '`core/room` holds the app\'s Room database, `AppDatabase`.',
    '<!-- cmpose:room-favorites -->',
    '- **Favorites** (`core/room` → `favorites/`): the star on a profile saves the GitHub user.',
    '<!-- /cmpose:room-favorites -->',
    '<!-- cmpose:room-notes -->',
    '- **Notes demo** (`feature/notes`, `core/room` → `notes/`): add and delete notes on one screen.',
    '<!-- /cmpose:room-notes -->',
    '',
    'To add a table, add an `@Entity` and a `@Dao` in their own package.',
    '<!-- /cmpose:room -->',
    '',
    '## Modules',
    '',
    '<!-- cmpose:modules -->',
    'old modules',
    '<!-- /cmpose:modules -->',
    ''
].join('\n');

const ROOM_FILES = {
    'core/room/build.gradle.kts': [
        'plugins {',
        '    alias(libs.plugins.kmp.library.plugin)',
        '    alias(libs.plugins.room)',
        '}',
        '',
        'kotlin {',
        '    sourceSets {',
        '        commonMain.dependencies {',
        '            api(libs.androidx.room.runtime)',
        '            implementation(libs.androidx.sqlite.bundled)',
        '        }',
        '    }',
        '}',
        ''
    ].join('\n'),
    [`core/room/schemas/${NEW_PACKAGE}.core.room.AppDatabase/1.json`]: '{"formatVersion": 1}\n',
    [`${ROOM_DIR('commonMain')}/AppDatabase.kt`]: [
        `package ${NEW_PACKAGE}.core.room`,
        '',
        'import androidx.room.Database',
        'import androidx.room.RoomDatabase',
        `import ${NEW_PACKAGE}.core.room.notes.NoteDao`,
        `import ${NEW_PACKAGE}.core.room.notes.NoteEntity`,
        '',
        '@Database(entities = [NoteEntity::class], version = 1)',
        'abstract class AppDatabase : RoomDatabase() {',
        '    abstract fun noteDao(): NoteDao',
        '}',
        ''
    ].join('\n'),
    [`${ROOM_DIR('commonMain')}/DatabaseFactory.kt`]: `package ${NEW_PACKAGE}.core.room\n\nimport androidx.sqlite.driver.bundled.BundledSQLiteDriver\n`,
    [`${ROOM_DIR('commonMain')}/di/RoomModule.kt`]: `package ${NEW_PACKAGE}.core.room.di\n\nclass RoomModule\n`,
    [`${ROOM_DIR('commonMain')}/favorites/FavoriteUserDao.kt`]: `package ${NEW_PACKAGE}.core.room.favorites\n\ninterface FavoriteUserDao\n`,
    [`${ROOM_DIR('commonMain')}/favorites/FavoriteUserEntity.kt`]: `package ${NEW_PACKAGE}.core.room.favorites\n\ndata class FavoriteUserEntity(val id: Long)\n`,
    [`${ROOM_DIR('commonMain')}/notes/NoteDao.kt`]: `package ${NEW_PACKAGE}.core.room.notes\n\ninterface NoteDao\n`,
    [`${ROOM_DIR('commonMain')}/notes/NoteEntity.kt`]: `package ${NEW_PACKAGE}.core.room.notes\n\ndata class NoteEntity(val id: Long)\n`,
    [`${ROOM_DIR('iosTest')}/favorites/FavoriteUserDaoTest.kt`]: `package ${NEW_PACKAGE}.core.room.favorites\n\nclass FavoriteUserDaoTest\n`
};

const NOTES_FILES = {
    'feature/notes/contract/build.gradle.kts': 'plugins {\n    alias(libs.plugins.feature.contract.plugin)\n}\n',
    'feature/notes/presentation/build.gradle.kts': 'plugins {\n    alias(libs.plugins.feature.presentation.plugin)\n}\n\nkotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(projects.core.room)\n            implementation(projects.feature.notes.contract)\n        }\n    }\n}\n',
    [`${NOTES_SRC('contract')}/Screens.kt`]: `package ${NEW_PACKAGE}.feature.notes.contract\n\ndata object NotesDestination\n`,
    [`${NOTES_SRC('presentation')}/ui/NotesViewModel.kt`]: `package ${NEW_PACKAGE}.feature.notes.presentation.ui\n\nimport ${NEW_PACKAGE}.core.room.notes.NoteDao\n\ninternal class NotesViewModel(private val noteDao: NoteDao)\n`,
    [`${NOTES_SRC('presentation')}/di/NotesPresentationModule.kt`]: `package ${NEW_PACKAGE}.feature.notes.presentation.di\n\nclass NotesPresentationModule\n`,
    [`feature/notes/presentation/src/commonTest/kotlin/${PKG}/feature/notes/presentation/ui/NotesViewModelTest.kt`]:
        `package ${NEW_PACKAGE}.feature.notes.presentation.ui\n\nclass NotesViewModelTest\n`
};

// A custom module cloned from feature/sample (four layers)
const SHOP_FILES = Object.fromEntries(['contract', 'data', 'domain', 'presentation'].map((layer) => [
    `feature/shop/${layer}/src/commonMain/kotlin/${PKG}/feature/shop/${layer}/Shop${layer}.kt`,
    `package ${NEW_PACKAGE}.feature.shop.${layer}\n`
]));

async function seed(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-'));
    const files = {
        'settings.gradle.kts': SETTINGS,
        'shared/build.gradle.kts': SHARED_BUILD,
        [INIT_KOIN]: INIT_KOIN_CONTENT,
        'gradle/libs.versions.toml': TOML,
        'build.gradle.kts': ROOT_BUILD,
        'README.md': README,
        ...ROOM_FILES,
        ...NOTES_FILES,
        ...extra
    };
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));
const count = (content, line) => content.split('\n').filter((l) => l.trim() === line).length;

// What blank room=true leaves, with or without custom modules
async function assertRoomOnBlank(dir) {
    for (const sourceSet of ['commonMain', 'iosTest']) {
        assert.equal(await exists(dir, `${ROOM_DIR(sourceSet)}/favorites`), false, `${sourceSet} favorites/ goes`);
    }
    assert.ok(await exists(dir, `${ROOM_DIR('commonMain')}/notes/NoteDao.kt`), 'notes/ stays');
    assert.ok(await exists(dir, `${ROOM_DIR('commonMain')}/AppDatabase.kt`));
    assert.ok(await exists(dir, `${NOTES_SRC('presentation')}/di/NotesPresentationModule.kt`));

    const shared = await read(dir, 'shared/build.gradle.kts');
    assert.equal(count(shared, 'implementation(projects.feature.notes.contract)'), 1);
    assert.equal(count(shared, 'implementation(projects.feature.notes.presentation)'), 1);
    assert.doesNotMatch(shared, /projects\.feature\.notes\.(data|domain)/);
    assert.equal(count(shared, 'implementation(projects.core.room)'), 1);

    const initKoin = await read(dir, INIT_KOIN);
    assert.equal(count(initKoin, `import ${NEW_PACKAGE}.feature.notes.presentation.di.NotesPresentationModule`), 1);
    assert.equal(count(initKoin, 'add(NotesPresentationModule().module)'), 1);
    assert.match(initKoin, new RegExp(`^import ${NEW_PACKAGE}\\.core\\.room\\.di\\.RoomModule$`, 'm'));
    assert.match(initKoin, /^ {4}add\(RoomModule\(\)\.module\)$/m);
    assert.doesNotMatch(initKoin, /NotesDataModule|NotesDomainModule/);

    const settings = await read(dir, 'settings.gradle.kts');
    for (const include of ['include(":feature:notes")', 'include(":feature:notes:contract")', 'include(":feature:notes:presentation")']) {
        assert.equal(count(settings, include), 1, include);
    }
    assert.doesNotMatch(settings, /feature:notes:(data|domain)/);
    assert.equal(count(settings, 'include(":core:room")'), 1);

    const readme = await read(dir, 'README.md');
    assert.doesNotMatch(readme, /cmpose:room-favorites|Favorites/);
    assert.match(readme, /<!-- cmpose:room-notes -->/);
    assert.match(readme, /<!-- cmpose:room -->/);

    // The rest of the Room setup stays as it is
    assert.equal(await read(dir, 'gradle/libs.versions.toml'), TOML);
}

test('blank room=true, no custom modules: favorites go, Notes is wired with its two layers', async (t) => {
    t.mock.method(console, 'log', () => { });
    const dir = await seed();
    try {
        await processBlankApp(dir, NEW_PACKAGE, [], { ...ALL_ON, room: true });

        await assertRoomOnBlank(dir);
        assert.deepEqual(await fs.readdir(path.join(dir, 'feature')), ['notes']);
        assert.equal(await exists(dir, 'feature/notes/presentation/src/commonTest'), false);
    } finally {
        await fs.remove(dir);
    }
});

test('blank room=true + custom module shop: shop gets four layers, notes two, every include once', async (t) => {
    t.mock.method(console, 'log', () => { });
    const dir = await seed(SHOP_FILES);
    try {
        // The hosted generator's order: processBlankApp, then the custom modules
        await processBlankApp(dir, NEW_PACKAGE, ['shop'], { ...ALL_ON, room: true });
        await wireFeatureModules(dir, NEW_PACKAGE, ['shop']);

        await assertRoomOnBlank(dir);
        const shared = await read(dir, 'shared/build.gradle.kts');
        const settings = await read(dir, 'settings.gradle.kts');
        const initKoin = await read(dir, INIT_KOIN);
        for (const layer of ['contract', 'data', 'domain', 'presentation']) {
            assert.equal(count(shared, `implementation(projects.feature.shop.${layer})`), 1, layer);
            assert.equal(count(settings, `include(":feature:shop:${layer}")`), 1, layer);
        }
        assert.equal(count(settings, 'include(":feature:shop")'), 1);
        for (const layer of ['Presentation', 'Data', 'Domain']) {
            assert.equal(count(initKoin, `add(Shop${layer}Module().module)`), 1, layer);
        }
        assert.deepEqual((await fs.readdir(path.join(dir, 'feature'))).sort(), ['notes', 'shop']);
    } finally {
        await fs.remove(dir);
    }
});

// Blank room=false: no Room, no Notes, anywhere
async function assertNoRoom(dir) {
    assert.equal(await exists(dir, 'core/room'), false);
    assert.equal(await exists(dir, 'feature/notes'), false);

    const settings = await read(dir, 'settings.gradle.kts');
    assert.doesNotMatch(settings, /"(?::)?core:room"|"(?::)?feature:notes/);
    assert.equal(settings, SETTINGS.split('\n').filter((l) => !/core:room|feature:notes|feature:home|feature:onboarding/.test(l)).join('\n'));

    const shared = await read(dir, 'shared/build.gradle.kts');
    assert.doesNotMatch(shared, /projects\.core\.room|projects\.feature\.notes/);

    const initKoin = await read(dir, INIT_KOIN);
    assert.doesNotMatch(initKoin, /RoomModule|NotesPresentationModule/);
    assert.match(initKoin, /add\(DatabaseModule\(\)\.module\)/);

    const toml = await read(dir, 'gradle/libs.versions.toml');
    assert.doesNotMatch(toml, /^(room|sqlite|androidx-room-runtime|androidx-room-compiler|androidx-sqlite-bundled)\s*=/m);
    assert.doesNotMatch(toml, /androidx\.room|androidx\.sqlite/);
    assert.equal(toml, TOML.split('\n').filter((l) => !/^(room|sqlite|androidx-room-\w+|androidx-sqlite-bundled)\s*=/.test(l)).join('\n'));

    assert.doesNotMatch(await read(dir, 'build.gradle.kts'), /libs\.plugins\.room/);

    const readme = await read(dir, 'README.md');
    assert.doesNotMatch(readme, /cmpose:room|Local database|Favorites|Notes demo/);
    assert.doesNotMatch(readme, /\n{3,}/, 'no more than one blank line where the Room section was');
    assert.match(readme, /Open the project\.\n\n## Modules/);
}

test('blank room=false: core/room, feature/notes, their lines, catalog keys and README section go', async (t) => {
    t.mock.method(console, 'log', () => { });
    // A root build that declares the Room plugin (the template does not; a fork might): the line goes
    const dir = await seed({ 'build.gradle.kts': ROOT_BUILD.replace('}\n', '    alias(libs.plugins.room) apply false\n}\n') });
    try {
        await processBlankApp(dir, NEW_PACKAGE, [], { ...ALL_ON, room: false });

        await assertNoRoom(dir);
        assert.equal(await read(dir, 'build.gradle.kts'), ROOT_BUILD);
        assert.equal(await exists(dir, 'feature'), false);
    } finally {
        await fs.remove(dir);
    }
});

test('blank room=false + a custom module named room (RoomEntry, RoomPresentationModule): no residue error', async (t) => {
    t.mock.method(console, 'log', () => { });
    const room = (layer, file, body) => [`feature/room/${layer}/src/commonMain/kotlin/${PKG}/feature/room/${layer}/${file}`,
        `package ${NEW_PACKAGE}.feature.room.${layer}${body}`];
    const dir = await seed(Object.fromEntries([
        room('contract', 'Screens.kt', '\n\ndata object RoomDestination\n'),
        room('presentation', 'navigation/RoomEntry.kt', `.navigation\n\nimport ${NEW_PACKAGE}.feature.room.contract.RoomDestination\n\ninternal class RoomEntry\n`),
        room('presentation', 'di/RoomPresentationModule.kt', '.di\n\nclass RoomPresentationModule\n'),
        ['feature/room/presentation/build.gradle.kts', 'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(dependencyNotation = projects.feature.room.contract)\n        }\n    }\n}\n']
    ]));
    try {
        await processBlankApp(dir, NEW_PACKAGE, ['room'], { ...ALL_ON, room: false });
        await wireFeatureModules(dir, NEW_PACKAGE, ['room']);
        await assertNoRoomResidue(dir, NEW_PACKAGE, { room: false });

        assert.equal(await exists(dir, 'core/room'), false);
        assert.equal(await exists(dir, 'feature/notes'), false);
        assert.deepEqual(await fs.readdir(path.join(dir, 'feature')), ['room']);
        assert.doesNotMatch(await read(dir, 'shared/build.gradle.kts'), /projects\.core\.room|projects\.feature\.notes/);
        assert.doesNotMatch(await read(dir, INIT_KOIN), /\bRoomModule\b|NotesPresentationModule/);
        assert.ok(await exists(dir, 'feature/room/presentation/build.gradle.kts'));
        assert.match(await read(dir, INIT_KOIN), /add\(RoomPresentationModule\(\)\.module\)/);
        assert.match(await read(dir, 'settings.gradle.kts'), /include\(":feature:room:presentation"\)/);
    } finally {
        await fs.remove(dir);
    }
});

// assertNoRoomResidue: the check after the room=false removal
async function residueTree(files) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-residue-'));
    for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(dir, rel), content);
    return dir;
}

test('assertNoRoomResidue fails on a Room line the removal does not reach, naming file and token', async () => {
    const dir = await residueTree({
        'core/other/build.gradle.kts': 'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation(libs.androidx.room.runtime)\n        }\n    }\n}\n',
        [`shared/src/commonMain/kotlin/${PKG}/App.kt`]: `package ${NEW_PACKAGE}\n\nfun app() = Unit\n`
    });
    try {
        await assert.rejects(
            assertNoRoomResidue(dir, NEW_PACKAGE, { room: false }),
            (err) => /^Room residue after removal/.test(err.message) &&
                err.message.includes(`${path.join('core', 'other', 'build.gradle.kts')}: libs.androidx.room`) &&
                !err.message.includes('App.kt')
        );
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoRoomResidue names a Room directory still present', async () => {
    const dir = await residueTree({ 'feature/notes/contract/build.gradle.kts': 'plugins {\n}\n' });
    try {
        await assert.rejects(
            assertNoRoomResidue(dir, NEW_PACKAGE, { room: false }),
            (err) => err.message.includes(`${path.join('feature', 'notes')}: file still present`)
        );
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoRoomResidue does not look with room on', async () => {
    const dir = await residueTree({
        'core/room/build.gradle.kts': 'dependencies {\n    implementation(libs.androidx.room.runtime)\n}\n',
        'settings.gradle.kts': 'include(":core:room")\n'
    });
    try {
        await assertNoRoomResidue(dir, NEW_PACKAGE, { room: true });
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoRoomResidue: with the package androidx.room.demo, the user\'s own package and imports are not residue', async () => {
    const pkg = 'androidx.room.demo';
    const pkgPath = 'androidx/room/demo';
    const dir = await residueTree({
        [`shared/src/commonMain/kotlin/${pkgPath}/App.kt`]: `package ${pkg}\n\nimport ${pkg}.core.domain.BuildEnvironment\nimport ${pkg}.feature.shop.contract.ShopDestination\n\nfun app() = Unit\n`,
        [`feature/shop/contract/src/commonMain/kotlin/${pkgPath}/feature/shop/contract/Screens.kt`]: `package ${pkg}.feature.shop.contract\n\ndata object ShopDestination\n`,
        'shared/build.gradle.kts': `android {\n    namespace = "${pkg}.shared"\n}\n`
    });
    try {
        await assertNoRoomResidue(dir, pkg, { room: false });
        // A real Room import is still seen under that package
        await fs.outputFile(path.join(dir, `shared/src/commonMain/kotlin/${pkgPath}/Db.kt`), `package ${pkg}\n\nimport androidx.room.RoomDatabase\n`);
        await assert.rejects(assertNoRoomResidue(dir, pkg, { room: false }), /Db\.kt: androidx\.room/);
    } finally {
        await fs.remove(dir);
    }
});

test('assertNoRoomResidue ignores a project name that spells a token in LOG_TAG_PREFIX', async () => {
    const dir = await residueTree({
        'settings.gradle.kts': 'rootProject.name = "AppDatabase"\n',
        [`core/logging/src/commonMain/kotlin/${PKG}/core/logging/LoggingConfig.kt`]:
            `package ${NEW_PACKAGE}.core.logging\n\ninternal const val LOG_TAG_PREFIX = "AppDatabase"\n`
    });
    try {
        await assertNoRoomResidue(dir, NEW_PACKAGE, { room: false });
    } finally {
        await fs.remove(dir);
    }
});


// Review: core/review has no flag; room off neither touches it nor reports it as Room residue
const REVIEW_FILES = {
    'core/review/build.gradle.kts': 'plugins {\n    alias(libs.plugins.kmp.library.plugin)\n}\n',
    [`core/review/src/commonMain/kotlin/${PKG}/core/review/ReviewCounterStore.kt`]: `package ${NEW_PACKAGE}.core.review\n\ninterface ReviewCounterStore\n`,
    [`core/review/src/commonMain/kotlin/${PKG}/core/review/di/ReviewModule.kt`]: `package ${NEW_PACKAGE}.core.review.di\n\n@Module\nclass ReviewModule\n`,
    [`core/review/src/androidMain/kotlin/${PKG}/core/review/SharedPreferencesReviewCounterStore.kt`]: `package ${NEW_PACKAGE}.core.review\n\ninternal class SharedPreferencesReviewCounterStore : ReviewCounterStore\n`,
    [`core/review/src/iosMain/kotlin/${PKG}/core/review/UserDefaultsReviewCounterStore.kt`]: `package ${NEW_PACKAGE}.core.review\n\ninternal class UserDefaultsReviewCounterStore : ReviewCounterStore\n`
};

test('blank room=false: assertNoRoomResidue passes and core/review stays', async (t) => {
    t.mock.method(console, 'log', () => { });
    const dir = await seed({
        ...REVIEW_FILES,
        'settings.gradle.kts': SETTINGS.replace('include(":core:room")', 'include(":core:review")\ninclude(":core:room")'),
        [INIT_KOIN]: INIT_KOIN_CONTENT
            .replace(`import ${NEW_PACKAGE}.core.room.di.RoomModule`, `import ${NEW_PACKAGE}.core.review.di.ReviewModule\nimport ${NEW_PACKAGE}.core.room.di.RoomModule`)
            .replace('    add(RoomModule().module)', '    add(ReviewModule().module)\n    add(RoomModule().module)')
    });
    try {
        await processBlankApp(dir, NEW_PACKAGE, [], { ...ALL_ON, room: false });

        await assertNoRoomResidue(dir, NEW_PACKAGE, { room: false });
        for (const [rel, content] of Object.entries(REVIEW_FILES)) assert.equal(await read(dir, rel), content, `${rel} is untouched`);
        assert.ok((await read(dir, 'settings.gradle.kts')).split('\n').includes('include(":core:review")'));
        const initKoin = (await read(dir, INIT_KOIN)).split('\n');
        assert.ok(initKoin.includes(`import ${NEW_PACKAGE}.core.review.di.ReviewModule`));
        assert.ok(initKoin.includes('    add(ReviewModule().module)'));
        assert.ok(!initKoin.some((line) => line.includes('RoomModule')));
    } finally {
        await fs.remove(dir);
    }
});
