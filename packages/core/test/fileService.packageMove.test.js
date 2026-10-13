const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { movePackageStructure } = require('../src/fileService');

const OLD_PACKAGE = 'com.kturker.multiplatform';
const NEW_PACKAGE = 'dev.cmpose.app';

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmp-package-move-test-'));
    try {
        return await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

// Every source set moves to the new package, the test ones included (the template ships
// commonTest and androidHostTest sources; left behind, the verifier rejects the generation).
// %P = the package directory. build.gradle.kts marks shared/ and androidApp/ as modules.
const FILES = [
    'shared/build.gradle.kts',
    'shared/src/commonMain/kotlin/%P/di/initKoin.kt',
    'shared/src/androidHostTest/kotlin/%P/di/KoinGraphTest.kt',
    'feature/home/domain/src/commonMain/kotlin/%P/feature/home/domain/usecase/GetGithubUserDetailUseCase.kt',
    'feature/home/domain/src/commonTest/kotlin/%P/feature/home/domain/usecase/GetGithubUserDetailUseCaseTest.kt',
    'core/domain/src/iosTest/kotlin/%P/core/domain/RestResultTest.kt',
    'androidApp/build.gradle.kts',
    'androidApp/src/main/kotlin/%P/MainActivity.kt'
];

test('movePackageStructure moves every source set of every module to the new package, test sets included', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        const oldPath = OLD_PACKAGE.replace(/\./g, '/');
        const newPath = NEW_PACKAGE.replace(/\./g, '/');
        for (const file of FILES) {
            const target = path.join(dir, file.replace('%P', oldPath));
            await fs.ensureDir(path.dirname(target));
            await fs.writeFile(target, `// ${path.basename(target)}\n`);
        }

        await movePackageStructure(dir, OLD_PACKAGE, NEW_PACKAGE);

        for (const file of FILES) {
            if (!file.includes('%P')) continue;
            const moved = path.join(dir, file.replace('%P', newPath));
            assert.ok(await fs.pathExists(moved), `not moved: ${file}`);
            assert.equal(await fs.readFile(moved, 'utf8'), `// ${path.basename(moved)}\n`);
            assert.ok(!(await fs.pathExists(path.join(dir, file.replace('%P', oldPath)))), `left behind: ${file}`);
        }
        const leftovers = [];
        async function walk(current) {
            for (const entry of await fs.readdir(current, { withFileTypes: true })) {
                const p = path.join(current, entry.name);
                if (!entry.isDirectory()) continue;
                if (p.endsWith(path.join('com', 'kturker'))) leftovers.push(path.relative(dir, p));
                await walk(p);
            }
        }
        await walk(dir);
        assert.deepEqual(leftovers, [], 'no com/kturker directory may remain');
    });
});

const SCHEMA_REL = (pkg) => `core/room/schemas/${pkg}.core.room.AppDatabase/1.json`;

test('movePackageStructure moves the Room schema directory named after the database class to the new package', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, SCHEMA_REL(OLD_PACKAGE)), '{"version":1}\n');
        await fs.outputFile(path.join(dir, 'core/room/build.gradle.kts'), '// room\n');

        await movePackageStructure(dir, OLD_PACKAGE, NEW_PACKAGE);

        assert.equal(await fs.readFile(path.join(dir, SCHEMA_REL(NEW_PACKAGE)), 'utf8'), '{"version":1}\n');
        assert.ok(!(await fs.pathExists(path.join(dir, 'core/room/schemas', `${OLD_PACKAGE}.core.room.AppDatabase`))));
    });
});

test('movePackageStructure without a schemas directory, or with the same package, leaves things alone', async (t) => {
    t.mock.method(console, 'log', () => { });

    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, 'core/room/build.gradle.kts'), '// room\n');
        await movePackageStructure(dir, OLD_PACKAGE, NEW_PACKAGE);
    });
    await withTempDir(async (dir) => {
        await fs.outputFile(path.join(dir, SCHEMA_REL(OLD_PACKAGE)), '{}\n');
        await movePackageStructure(dir, OLD_PACKAGE, OLD_PACKAGE);
        assert.ok(await fs.pathExists(path.join(dir, SCHEMA_REL(OLD_PACKAGE))));
    });
});
