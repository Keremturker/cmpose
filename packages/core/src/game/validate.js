'use strict';
const PV = require('../ProjectValidator');
const limits = require('../limits');
const { GAME_SCHEMA: S } = require('./contract');

const CSHARP_KEYWORDS = ('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while').split(' ');
const KOTLIN_KEYWORDS = PV.KOTLIN_HARD_KEYWORDS;

const NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const PACKAGE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/;
const MODULE_RE = /^[a-z][a-z0-9]{0,19}$/;
const IOS_VERSION_RE = /^\d+(\.\d+){1,2}$/;

const ID_FORMATS = {
    admob: {
        androidAppId: /^ca-app-pub-\d{16}~\d{10}$/, iosAppId: /^ca-app-pub-\d{16}~\d{10}$/,
        androidBanner: /^ca-app-pub-\d{16}\/\d{10}$/, androidInterstitial: /^ca-app-pub-\d{16}\/\d{10}$/, androidRewarded: /^ca-app-pub-\d{16}\/\d{10}$/,
        iosBanner: /^ca-app-pub-\d{16}\/\d{10}$/, iosInterstitial: /^ca-app-pub-\d{16}\/\d{10}$/, iosRewarded: /^ca-app-pub-\d{16}\/\d{10}$/
    },
    revenueCat: { appleApiKey: /^appl_[A-Za-z0-9]{20,}$/, googleApiKey: /^goog_[A-Za-z0-9]{20,}$/ },
    gameServices: {
        androidAppId: /^\d{6,20}$/,
        leaderboardAndroid: /^[A-Za-z0-9_-]{4,64}$/, firstCompletionAndroid: /^[A-Za-z0-9_-]{4,64}$/, tenCompletionsAndroid: /^[A-Za-z0-9_-]{4,64}$/,
        leaderboardIos: /^[A-Za-z0-9._-]{1,100}$/, firstCompletionIos: /^[A-Za-z0-9._-]{1,100}$/, tenCompletionsIos: /^[A-Za-z0-9._-]{1,100}$/
    }
};

const fail = (error) => ({ ok: false, error });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inList = (list, word, ci) => list.includes(ci ? String(word).toLowerCase() : word);

function checkName(field, value) {
    if (typeof value !== 'string' || !NAME_RE.test(value)) return `${field} must be 1-${S.limits.nameMax} letters or digits, starting with a letter`;
    if (inList(CSHARP_KEYWORDS, value, false)) return `${field} must not be a C# keyword`;
    if (S.reservedNames.includes(value)) return `${field} is reserved`;
    return null;
}

function parseIosVersion(v) {
    return String(v).split('.').map(Number);
}
function cmpVersion(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d;
    }
    return 0;
}

function validateIds(ids, flags) {
    if (!isObject(ids)) return { error: 'ids must be an object' };
    const out = {};
    for (const group of Object.keys(ids)) {
        const def = S.idGroups[group];
        if (!def) return { error: `ids.${group} is not a known group (${Object.keys(S.idGroups).join(', ')})` };
        const g = ids[group];
        if (!isObject(g)) return { error: `ids.${group} must be an object` };
        const missing = def.fields.filter((f) => !(f in g));
        const extra = Object.keys(g).filter((f) => !def.fields.includes(f));
        if (missing.length || extra.length) return { error: `ids.${group} needs all of: ${def.fields.join(', ')}` };
        if (!flags.includes(def.flag)) return { error: `ids.${group} needs the ${def.flag} flag` };
        out[group] = {};
        for (const f of def.fields) {
            const v = g[f];
            const path = `ids.${group}.${f}`;
            if (typeof v !== 'string' || /["\\$\r\n]/.test(v) || /replace_me/i.test(v) || !ID_FORMATS[group][f].test(v)) return { error: `${path} has an invalid format` };
            out[group][f] = v;
        }
    }
    return { value: out };
}

function validateGame(input) {
    if (!isObject(input)) return fail('input must be an object');
    const { projectName, appName, packageName } = input;

    let err = checkName('projectName', projectName);
    if (err) return fail(err);

    if (typeof appName !== 'string' || !PV.validateAppName(appName) || appName.length > S.limits.appNameMax) return fail(PV.messages.appNameInvalid.replace('App Name', 'appName'));

    if (typeof packageName !== 'string' || !PACKAGE_RE.test(packageName) || packageName.length > S.limits.packageNameMax) {
        return fail(`packageName must look like com.company.app (lowercase, at least 3 segments, up to ${S.limits.packageNameMax} characters)`);
    }
    const segments = packageName.split('.');
    if (segments.some((s) => inList(CSHARP_KEYWORDS, s, true) || inList(KOTLIN_KEYWORDS, s, true))) return fail('packageName must not contain a keyword segment');
    if (packageName === S.reservedPackagePrefix || packageName.startsWith(S.reservedPackagePrefix + '.')) return fail('packageName must not use the reserved com.kturker prefix');

    const companyName = input.companyName === undefined ? segments[1][0].toUpperCase() + segments[1].slice(1) : input.companyName;
    err = checkName('companyName', companyName);
    if (err) return fail(err);

    const templateType = input.templateType === undefined ? 'showcase' : input.templateType;
    if (!S.templateTypes.includes(templateType)) return fail(`templateType must be one of: ${S.templateTypes.join(', ')}`);
    const render = input.render === undefined ? '2d' : input.render;
    if (!S.renders.includes(render)) return fail(`render must be one of: ${S.renders.join(', ')}`);

    const blank = templateType === 'blank';
    if (!blank && input.flags !== undefined) return fail('flags apply to blank only');
    if (!blank && input.features !== undefined) return fail('features apply to blank only');

    let flags = S.flags.slice();
    if (blank) {
        const wanted = input.flags === undefined ? [] : input.flags;
        if (!Array.isArray(wanted) || wanted.some((f) => !S.flags.includes(f))) return fail(`flags must be an array of: ${S.flags.join(', ')}`);
        const set = new Set(wanted);
        for (const f of wanted) for (const r of S.flagRequires[f] || []) set.add(r);
        flags = S.flags.filter((f) => set.has(f));
    }

    let features = [];
    if (blank && input.features !== undefined) {
        const list = input.features;
        if (!Array.isArray(list)) return fail('features must be an array');
        if (list.length > S.limits.maxModules) return fail(`features allows at most ${S.limits.maxModules} entries`);
        for (const f of list) {
            if (typeof f !== 'string' || !MODULE_RE.test(f)) return fail(`features entry "${f}" must be 1-${S.limits.moduleNameMax} lowercase letters or digits, starting with a letter`);
            if (inList(CSHARP_KEYWORDS, f, true) || inList(KOTLIN_KEYWORDS, f, true)) return fail(`features entry "${f}" is a keyword`);
            if (S.reservedModuleNames.includes(f)) return fail(`features entry "${f}" is reserved`);
        }
        if (new Set(list).size !== list.length) return fail('features must not contain duplicates');
        features = list.slice();
    }

    let minSdk = S.limits.minSdkMin;
    if (input.minSdk !== undefined) {
        const raw = input.minSdk;
        const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN);
        if (!Number.isInteger(n) || n < S.limits.minSdkMin || n > S.limits.minSdkMax) return fail(`minSdk must be an integer from ${S.limits.minSdkMin} to ${S.limits.minSdkMax}`);
        minSdk = n;
    }

    let iosVersion = S.limits.iosVersionMin;
    if (input.iosVersion !== undefined) {
        let v = input.iosVersion;
        if (typeof v === 'number' && Number.isFinite(v)) v = Number.isInteger(v) ? `${v}.0` : String(v);
        if (typeof v !== 'string' || !IOS_VERSION_RE.test(v)
            || cmpVersion(parseIosVersion(v), parseIosVersion(S.limits.iosVersionMin)) < 0
            || cmpVersion(parseIosVersion(v), parseIosVersion(limits.iosVersionMax)) > 0) {
            return fail(`iosVersion must be from ${S.limits.iosVersionMin} to ${limits.iosVersionMax}`);
        }
        iosVersion = v;
    }

    if (input.ci !== undefined && typeof input.ci !== 'boolean') return fail('ci must be a boolean');

    let ids = {};
    if (input.ids !== undefined) {
        const r = validateIds(input.ids, flags);
        if (r.error) return fail(r.error);
        ids = r.value;
    }

    return {
        ok: true,
        value: { projectName, appName, packageName, companyName, templateType, render, flags, features, minSdk, iosVersion, ci: input.ci === true, ids }
    };
}

module.exports = { validateGame };
