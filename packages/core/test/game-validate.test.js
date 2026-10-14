const test = require('node:test');
const assert = require('node:assert');
const { validateGame } = require('../src/game/validate');

const base = { projectName: 'SkyHopper', appName: 'Sky Hopper', packageName: 'com.acme.skyhopper' };
const ok = (input) => { const r = validateGame(input); assert.strictEqual(r.ok, true, r.error); return r.value; };
const bad = (input, field) => { const r = validateGame(input); assert.strictEqual(r.ok, false); assert.match(r.error, new RegExp(field)); };
const ADMOB = { androidAppId: 'ca-app-pub-1234567890123456~1234567890', iosAppId: 'ca-app-pub-1234567890123456~0987654321',
    androidBanner: 'ca-app-pub-1234567890123456/1111111111', androidInterstitial: 'ca-app-pub-1234567890123456/2222222222',
    androidRewarded: 'ca-app-pub-1234567890123456/3333333333', iosBanner: 'ca-app-pub-1234567890123456/4444444444',
    iosInterstitial: 'ca-app-pub-1234567890123456/5555555555', iosRewarded: 'ca-app-pub-1234567890123456/6666666666' };

test('defaults for showcase', () => {
    const v = ok(base);
    assert.deepStrictEqual([v.templateType, v.render, v.minSdk, v.iosVersion, v.ci, v.companyName], ['showcase', '2d', 25, '15.0', false, 'Acme']);
    assert.deepStrictEqual(v.flags, ['saveSystem', 'uiTheme', 'multiLang', 'network', 'networkInspector', 'purchases', 'ads', 'leaderboards']);
    assert.deepStrictEqual([v.features, v.ids], [[], {}]);
});
test('blank flags: requires are added, order follows the schema', () => {
    assert.deepStrictEqual(ok({ ...base, templateType: 'blank', flags: ['networkInspector', 'ads'] }).flags, ['network', 'networkInspector', 'ads']);
});
test('showcase rejects flags and features', () => {
    bad({ ...base, flags: ['ads'] }, 'flags');
    bad({ ...base, features: ['shop'] }, 'features');
});
test('reserved and colliding project names', () => {
    for (const projectName of ['UnityBase', 'Kturker', 'class', '1Game', 'Sky Hopper', 'A'.repeat(31)]) bad({ ...base, projectName }, 'projectName');
    for (const projectName of ['Sample', 'Shell', 'Showcase', 'App', 'Core', 'Unity']) ok({ ...base, projectName });
});
test('company name: derived, overridable, validated', () => {
    assert.strictEqual(ok({ ...base, packageName: 'io.my2company.game' }).companyName, 'My2company');
    assert.strictEqual(ok({ ...base, companyName: 'Studio' }).companyName, 'Studio');
    bad({ ...base, companyName: 'Kturker' }, 'companyName');
    bad({ ...base, companyName: 'my studio' }, 'companyName');
});
test('package name rules', () => {
    for (const packageName of ['com.acme', 'Com.acme.game', 'com.kturker.game', 'com.in.game', 'com.acme.' + 'a'.repeat(45)]) bad({ ...base, packageName }, 'packageName');
});
test('features: count, names, duplicates, reserved', () => {
    const b = { ...base, templateType: 'blank' };
    ok({ ...b, features: ['shop', 'quests', 'daily2'] });
    for (const features of [['a', 'b', 'c', 'd'], ['Shop'], ['shop', 'shop'], ['sample'], ['class'], ['x'.repeat(21)]]) bad({ ...b, features }, 'features');
});
test('minSdk and iosVersion ranges, numbers accepted', () => {
    assert.strictEqual(ok({ ...base, minSdk: '30' }).minSdk, 30);
    assert.strictEqual(ok({ ...base, iosVersion: 16 }).iosVersion, '16.0');
    bad({ ...base, minSdk: 24 }, 'minSdk');
    bad({ ...base, iosVersion: '14.0' }, 'iosVersion');
});
test('ids: full groups only, matching formats, flag must be on', () => {
    const b = { ...base, templateType: 'blank', flags: ['ads', 'purchases', 'leaderboards'] };
    ok({ ...b, ids: { admob: ADMOB, revenueCat: { appleApiKey: 'appl_' + 'a'.repeat(24), googleApiKey: 'goog_' + 'b'.repeat(24) } } });
    const { iosRewarded, ...partial } = ADMOB;
    bad({ ...b, ids: { admob: partial } }, 'ids.admob');
    bad({ ...b, ids: { admob: { ...ADMOB, androidBanner: 'ca-app-pub-1/2' } } }, 'ids.admob.androidBanner');
    bad({ ...base, templateType: 'blank', ids: { admob: ADMOB } }, 'ids.admob');
    bad({ ...b, ids: { unknown: {} } }, 'ids');
});
test('id values that would break C#, XML or YAML', () => {
    const b = { ...base, templateType: 'blank', flags: ['leaderboards'] };
    const gs = { androidAppId: '123456789012', leaderboardAndroid: 'CgkI_abc', firstCompletionAndroid: 'CgkI_def', tenCompletionsAndroid: 'CgkI_ghi',
        leaderboardIos: 'com.acme.high', firstCompletionIos: 'com.acme.first', tenCompletionsIos: 'com.acme.ten' };
    ok({ ...b, ids: { gameServices: gs } });
    for (const v of ['a"b', 'a\\b', 'a$b', 'a\nb', 'replace_me.x']) bad({ ...b, ids: { gameServices: { ...gs, leaderboardIos: v } } }, 'ids.gameServices.leaderboardIos');
});
