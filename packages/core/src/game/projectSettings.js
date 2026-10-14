const {
    UnityYamlError, setScalar, setMapEntry, getMapEntry, removeMapEntry, setList
} = require('./unityYaml');

// PlayerSettings is document '--- !u!129 &1' of ProjectSettings/ProjectSettings.asset
const PLAYER = { classId: 129, fileId: 1 };

// Plain YAML scalars only: no line breaks, no leading indicator or space, no ': ' or ' #', no trailing space.
// Whether a value is a valid name or ID is the validator's job, not this file's.
function plain(name, value) {
    const s = String(value === undefined || value === null ? '' : value);
    if (s.length === 0 || /[\r\n]/.test(s) || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: /.test(s) || / #/.test(s) || /\s$/.test(s)) {
        throw new UnityYamlError(`${name}: '${s}' cannot be written as a plain YAML value`, { key: name });
    }
    return s;
}

function applyIdentity(text, { companyName, productName, bundleId, version, androidMinSdk, iosTarget, urlScheme }) {
    if (!Number.isInteger(androidMinSdk)) {
        throw new UnityYamlError('androidMinSdk must be an integer', { key: 'androidMinSdk' });
    }
    const doc = PLAYER;
    let out = text;
    out = setScalar(out, 'companyName', plain('companyName', companyName), { doc });
    out = setScalar(out, 'productName', plain('productName', productName), { doc });
    out = setScalar(out, 'bundleVersion', plain('version', version), { doc });
    out = setScalar(out, 'overrideDefaultApplicationIdentifier', '1', { doc });
    out = setMapEntry(out, 'applicationIdentifier', 'Android', plain('bundleId', bundleId), { doc });
    out = setMapEntry(out, 'applicationIdentifier', 'iPhone', plain('bundleId', bundleId), { doc });
    out = setScalar(out, 'AndroidMinSdkVersion', String(androidMinSdk), { doc });
    out = setScalar(out, 'iOSTargetOSVersionString', plain('iosTarget', iosTarget), { doc });
    out = setList(out, 'iOSURLSchemes', urlScheme ? [plain('urlScheme', urlScheme)] : [], { doc });
    return out;
}

const SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Unity 6 keeps scripting defines per build target, ';'-separated; an empty target has no entry
function setDefines(text, target, symbols) {
    for (const s of symbols) {
        if (!SYMBOL.test(s)) throw new UnityYamlError(`scripting define '${s}' is not a valid symbol`, { key: target });
    }
    return symbols.length
        ? setMapEntry(text, 'scriptingDefineSymbols', target, symbols.join(';'), { doc: PLAYER })
        : removeMapEntry(text, 'scriptingDefineSymbols', target, { doc: PLAYER });
}

function getDefines(text, target) {
    const value = getMapEntry(text, 'scriptingDefineSymbols', target, { doc: PLAYER });
    return value ? value.split(';').filter(Boolean) : [];
}

module.exports = { PLAYER, applyIdentity, setDefines, getDefines };
