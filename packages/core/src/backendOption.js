'use strict';
const fs = require('fs-extra');
const path = require('path');
const { removeSwiftPackage, parseObjects, isa } = require('./xcodePackages');
const { PRIVACY_MANIFEST } = require('./privacyManifest');

// featuresConfig.backend: the template marks everything the backend adds (MAINTAINING.md → Backend markers).
// Off strips it, on keeps it and drops only the markers. Runs on the template package, before the rename.

const MARKERS = {
    slash: { open: '// cmpose:backend', close: '// /cmpose:backend' },
    hash: { open: '# cmpose:backend', close: '# /cmpose:backend' },
    html: { open: '<!-- cmpose:backend -->', close: '<!-- /cmpose:backend -->' }
};
const SWAP = '// cmpose:backend-off: ';

const KIND_BY_EXTENSION = {
    '.kt': 'slash', '.kts': 'slash', '.swift': 'slash', '.xcconfig': 'slash',
    '.toml': 'hash', '.gitignore': 'hash', '.properties': 'hash',
    '.md': 'html', '.xml': 'html', '.plist': 'html', '.xcprivacy': 'html'
};
const SKIP_DIRS = new Set(['.git', '.gradle', 'build', 'node_modules']);

// Template-relative paths the backend adds outside the files it marks; deleted when backend is off
const TEMPLATE_PACKAGE_PATH = 'com/kturker/multiplatform';
const BACKEND_PATHS = [
    'server',
    'core/api',
    'core/auth',
    'feature/account',
    'feature/sharing',
    'androidApp/src/debug',
    'iosApp/iosApp/SignInBridge.swift',
    'iosApp/iosApp/iosApp.entitlements',
    `shared/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/SignInRegistration.kt`,
    `shared/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/SessionGate.kt`,
    `shared/src/androidHostTest/kotlin/${TEMPLATE_PACKAGE_PATH}/MainScreenGateTest.kt`,
    `shared/src/androidHostTest/kotlin/${TEMPLATE_PACKAGE_PATH}/di/BackendBindingsTest.kt`,
    ...['BackendClient', 'BackendConfig', 'EmulatorDetection', 'LocalHost', 'TokenSource']
        .map((name) => `core/network/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/${name}.kt`),
    `core/network/src/androidMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/LocalHost.android.kt`,
    `core/network/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/LocalHost.ios.kt`,
    ...['AuthenticatedClientTest', 'BackendConfigTest', 'EmulatorDetectionTest']
        .map((name) => `core/network/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/network/${name}.kt`),
    `core/image/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.kt`,
    `core/image/src/androidMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.android.kt`,
    `core/image/src/iosMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalization.ios.kt`,
    `core/image/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalizationTest.kt`,
    `core/image/src/androidDeviceTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/image/ImageNormalizationDeviceTest.kt`,
    ...['core/multilang', 'blank/layers/multilang/core/multilang'].flatMap((module) => ['AccountStrings', 'SharingStrings']
        .map((name) => `${module}/src/commonMain/kotlin/${TEMPLATE_PACKAGE_PATH}/core/multilang/resource/${name}.kt`)),
    ...['SharedSpacesWarningTest', 'SharingStringsTest']
        .map((name) => `core/multilang/src/commonTest/kotlin/${TEMPLATE_PACKAGE_PATH}/core/multilang/resource/${name}.kt`)
];

// Imports the template leaves outside the markers (import ordering) that only marked code uses
const BACKEND_ONLY_IMPORTS = [
    /^import [\w.]+\.core\.auth\./,
    /^import [\w.]+\.feature\.account\./,
    /^import [\w.]+\.feature\.sharing\./
];
const IMPORT_FILE_KINDS = new Set(['.kt', '.kts', '.swift']);

const PBXPROJ = ['iosApp', 'iosApp.xcodeproj', 'project.pbxproj'];
const PACKAGE_RESOLVED = ['iosApp', 'iosApp.xcodeproj', 'project.xcworkspace', 'xcshareddata', 'swiftpm', 'Package.resolved'];
const BACKEND_PACKAGE_URLS = ['https://github.com/firebase/firebase-ios-sdk', 'https://github.com/google/GoogleSignIn-iOS'];
const COPY_GOOGLE_SERVICE_PHASE = 'Copy GoogleService-Info if present';
const BACKEND_MEMBERSHIP_EXCEPTION = /^\t+(?:iosApp\.entitlements|"GoogleService-Info\.plist"),$/;
const BACKEND_BUILD_SETTING = /^\t+(?:CODE_SIGN_ENTITLEMENTS|INFOPLIST_PREPROCESS|INFOPLIST_PREPROCESSOR_DEFINITIONS) = [^\n]*;$/;

// Firebase, GoogleSignIn and what they pull in; the template's other pins (GMA, UMP) stay
const BACKEND_PIN_IDENTITIES = new Set([
    'abseil-cpp-binary', 'app-check', 'appauth-ios', 'firebase-ios-sdk', 'google-ads-on-device-conversion-ios-sdk',
    'googleappmeasurement', 'googledatatransport', 'googlesignin-ios', 'googleutilities', 'grpc-binary',
    'gtm-session-fetcher', 'gtmappauth', 'interop-ios-for-google-sdks', 'leveldb', 'nanopb', 'promises', 'swift-protobuf'
]);

// Off: drops each marked block with its marker lines; on: drops only the marker lines. Either way a blank
// line on both sides of a dropped run becomes one (blank runs elsewhere stay).
function removeMarkedBlocks(content, kind, keep) {
    const { open, close } = MARKERS[kind];
    const out = [];
    const joins = [];
    let inside = false;
    let dropped = false;
    for (const line of content.split('\n')) {
        const t = line.trim();
        if (t === open) {
            if (inside) throw new Error(`nested ${open}`);
            inside = true;
            dropped = true;
            continue;
        }
        if (t === close) {
            if (!inside) throw new Error(`stray ${close}`);
            inside = false;
            dropped = true;
            continue;
        }
        if (inside && !keep) continue;
        if (dropped) joins.push(out.length);
        dropped = false;
        out.push(line);
    }
    if (inside) throw new Error('unclosed cmpose:backend block');
    if (dropped) joins.push(out.length);
    return collapseBlankRuns(out, joins).join('\n');
}

// At each join (the index of the first line after a dropped run), blank lines that follow a blank line go
function collapseBlankRuns(lines, joins) {
    const drop = new Set();
    for (const join of joins) {
        if (join === 0 || lines[join - 1] !== '') continue;
        for (let i = join; i < lines.length && lines[i] === ''; i++) drop.add(i);
    }
    return lines.filter((_, i) => !drop.has(i));
}

// Off: the line after a swap marker becomes the marker's text at that line's indentation; on: the marker goes
function applySwapMarkers(content, keep) {
    const lines = content.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t.startsWith(SWAP)) { out.push(lines[i]); continue; }
        const next = lines[i + 1];
        if (next === undefined) throw new Error('cmpose:backend-off marker on the last line');
        if (keep) { out.push(next); } else { out.push(next.match(/^\s*/)[0] + t.slice(SWAP.length)); }
        i++;
    }
    return out.join('\n');
}

// Off: the Firebase and GoogleSignIn packages, the build phase copying GoogleService-Info.plist, the
// membership exceptions of the entitlements and GoogleService-Info.plist, and the entitlements and
// Info.plist preprocessing (LOCAL_SERVER) build settings. Text edits only.
function stripBackendPbxproj(content) {
    const crlf = content.includes('\r\n');
    let result = crlf ? content.replace(/\r\n/g, '\n') : content;
    for (const url of BACKEND_PACKAGE_URLS) result = removeSwiftPackage(result, url);
    result = removeCopyGoogleServicePhase(result);
    result = result.split('\n')
        .filter((line) => !BACKEND_MEMBERSHIP_EXCEPTION.test(line) && !BACKEND_BUILD_SETTING.test(line))
        .join('\n');
    if (result.includes(COPY_GOOGLE_SERVICE_PHASE)) {
        throw new Error(`stripBackendPbxproj: "${COPY_GOOGLE_SERVICE_PHASE}" is in project.pbxproj but could not be removed (unexpected formatting)`);
    }
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

function removeCopyGoogleServicePhase(content) {
    const lines = content.split('\n');
    const phases = parseObjects(lines).filter((object) => isa(object) === 'PBXShellScriptBuildPhase'
        && object.text.includes(`name = "${COPY_GOOGLE_SERVICE_PHASE}";`));
    if (phases.length === 0) return content;
    // One object per isa: a phase whose closing line is missing would swallow the next object
    if (phases.some((object) => (object.text.match(/\bisa = /g) || []).length !== 1)) {
        throw new Error(`stripBackendPbxproj: "${COPY_GOOGLE_SERVICE_PHASE}" could not be parsed (unexpected formatting)`);
    }
    const ids = new Set(phases.map((object) => object.id));
    const drop = new Set();
    for (const object of phases) {
        for (let i = object.start; i <= object.end; i++) drop.add(i);
    }
    const listEntry = /^\t+([0-9A-F]{24})(?: \/\*.*?\*\/)?,$/;
    lines.forEach((line, i) => {
        const match = line.match(listEntry);
        if (match && ids.has(match[1])) drop.add(i);
    });
    return lines.filter((_, i) => !drop.has(i)).join('\n')
        .replace(/\n\n\/\* Begin (\w+) section \*\/\n\/\* End \1 section \*\/(?=\n)/g, '');
}

// Off: Package.resolved without the backend's pins, in Xcode's layout ("key" : value). originHash goes
// (Xcode recomputes it); null when no pin is left, so the caller deletes the file.
function stripBackendPins(json) {
    const resolved = JSON.parse(json);
    const pins = (resolved.pins || []).filter((pin) => !BACKEND_PIN_IDENTITIES.has(pin.identity));
    if (pins.length === 0) return null;
    const { originHash, ...rest } = resolved;
    const text = JSON.stringify({ ...rest, pins }, null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1 : ');
    return `${text}\n`;
}

function kindOf(file) {
    const name = path.basename(file);
    return KIND_BY_EXTENSION[name === '.gitignore' ? name : path.extname(name)];
}

async function listMarkableFiles(dir) {
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) files.push(...await listMarkableFiles(full));
        } else if (kindOf(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

// Removes a path, then the directories it leaves empty (never projectDir itself)
async function removeAndPrune(projectDir, target) {
    await fs.remove(target);
    let dir = path.dirname(target);
    while (dir.startsWith(projectDir + path.sep) && (await fs.pathExists(dir)) && (await fs.readdir(dir)).length === 0) {
        await fs.remove(dir);
        dir = path.dirname(dir);
    }
}

function renderFile(content, file, enabled) {
    const kind = kindOf(file);
    let out = content;
    if (kind === 'slash') out = applySwapMarkers(out, enabled);
    out = removeMarkedBlocks(out, kind, enabled);
    if (!enabled && IMPORT_FILE_KINDS.has(path.extname(file))) {
        out = out.split('\n').filter((line) => !BACKEND_ONLY_IMPORTS.some((re) => re.test(line))).join('\n');
    }
    return out;
}

// The privacy manifest's cmpose:backend block belongs to writePrivacyManifest, so it is left alone here
async function applyBackendOption(projectDir, enabled) {
    const root = path.resolve(projectDir);
    if (!enabled) {
        for (const relative of BACKEND_PATHS) {
            const target = path.join(root, ...relative.split('/'));
            if (await fs.pathExists(target)) await removeAndPrune(root, target);
        }
    }

    const privacyManifest = path.join(root, ...PRIVACY_MANIFEST);
    for (const file of await listMarkableFiles(root)) {
        if (file === privacyManifest) continue;
        const content = await fs.readFile(file, 'utf8');
        if (!content.includes('cmpose:backend') && (enabled || !IMPORT_FILE_KINDS.has(path.extname(file)))) continue;
        let updated;
        try {
            updated = renderFile(content, file, enabled);
        } catch (error) {
            throw new Error(`${path.relative(root, file)}: ${error.message}`);
        }
        if (updated !== content) await fs.writeFile(file, updated);
    }

    if (enabled) return;

    const pbxproj = path.join(root, ...PBXPROJ);
    if (await fs.pathExists(pbxproj)) {
        const content = await fs.readFile(pbxproj, 'utf8');
        const updated = stripBackendPbxproj(content);
        if (updated !== content) await fs.writeFile(pbxproj, updated);
    }

    const resolved = path.join(root, ...PACKAGE_RESOLVED);
    if (await fs.pathExists(resolved)) {
        const content = await fs.readFile(resolved, 'utf8');
        const updated = stripBackendPins(content);
        if (updated === null) await removeAndPrune(root, resolved);
        else if (updated !== content) await fs.writeFile(resolved, updated);
    }
}

module.exports = {
    removeMarkedBlocks,
    applySwapMarkers,
    stripBackendPbxproj,
    stripBackendPins,
    applyBackendOption,
    BACKEND_PATHS,
    BACKEND_ONLY_IMPORTS,
    BACKEND_PIN_IDENTITIES
};
