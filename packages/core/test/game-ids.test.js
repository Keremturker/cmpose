const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { tmpDir } = require('./support/gameFixtures');

const ADS = 'Assets/_Project/Core/Ads/AdsConfig.cs';
const ADS_SETTINGS = 'Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset';
const PURCHASES = 'Assets/_Project/Core/Purchases/PurchasesConfig.cs';
const LEADERBOARDS = 'Assets/_Project/Core/Leaderboards/LeaderboardsConfig.cs';
const GAMES_XML = 'Assets/_Project/Core/Leaderboards/Plugins/Android/CmposeGames.androidlib/src/main/res/values/games-ids.xml';

// The template's line shapes, as shipped (Google's public test IDs, RevenueCat's Test Store key, placeholders)
const TEMPLATE = {
    [ADS]: [
        'using System;',
        '',
        'namespace Kturker.UnityBase.Core.Ads',
        '{',
        '    public static class AdsConfig',
        '    {',
        '        public const string BannerAndroid = "ca-app-pub-3940256099942544/9214589741";',
        '        public const string InterstitialAndroid = "ca-app-pub-3940256099942544/1033173712";',
        '        public const string RewardedAndroid = "ca-app-pub-3940256099942544/5224354917";',
        '        public const string BannerIos = "ca-app-pub-3940256099942544/2435281174";',
        '        public const string InterstitialIos = "ca-app-pub-3940256099942544/4411468910";',
        '        public const string RewardedIos = "ca-app-pub-3940256099942544/1712485313";',
        '        public const string TrackingUsageDescription = "This identifier will be used to deliver personalized ads to you.";',
        '        public const int InterstitialStartDelaySeconds = 60;',
        '',
        '        private const string GoogleTestPublisher = "ca-app-pub-3940256099942544/";',
        '    }',
        '}',
        ''
    ],
    [ADS_SETTINGS]: [
        '%YAML 1.1',
        '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!114 &11400000',
        'MonoBehaviour:',
        '  m_ObjectHideFlags: 0',
        '  m_Script: {fileID: 11500000, guid: a187246822bbb47529482707f3e0eff8, type: 3}',
        '  m_Name: GoogleMobileAdsSettings',
        '  m_EditorClassIdentifier: ',
        '  adMobAndroidAppId: ca-app-pub-3940256099942544~3347511713',
        '  adMobIOSAppId: ca-app-pub-3940256099942544~1458002511',
        '  enableKotlinXCoroutinesPackagingOption: 1',
        '  userTrackingUsageDescription: ',
        '  userLanguage: en',
        ''
    ],
    [PURCHASES]: [
        'namespace Kturker.UnityBase.Core.Purchases',
        '{',
        '    public static class PurchasesConfig',
        '    {',
        '        public const string ApiKeyApple = "test_qmHxQuucnBoXDlJVLUGsCxcGXrw";',
        '        public const string ApiKeyGoogle = "test_qmHxQuucnBoXDlJVLUGsCxcGXrw";',
        '        public const string PremiumEntitlement = "premium";',
        '',
        '        public static string ApiKey(bool ios) => ios ? ApiKeyApple : ApiKeyGoogle;',
        '    }',
        '}',
        ''
    ],
    [LEADERBOARDS]: [
        'namespace Kturker.UnityBase.Core.Leaderboards',
        '{',
        '    public static class LeaderboardsConfig',
        '    {',
        '        public const string LeaderboardAndroid = "REPLACE_ME_high_score";',
        '        public const string FirstCompletionAndroid = "REPLACE_ME_first_completion";',
        '        public const string TenCompletionsAndroid = "REPLACE_ME_ten_completions";',
        '        public const string LeaderboardIos = "cmpose.replace_me.high_score";',
        '        public const string FirstCompletionIos = "cmpose.replace_me.first_completion";',
        '        public const string TenCompletionsIos = "cmpose.replace_me.ten_completions";',
        '',
        '        public const int TenCompletionsSteps = 10;',
        '    }',
        '}',
        ''
    ],
    [GAMES_XML]: [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        '    <string name="games_app_id" translatable="false">0</string>',
        '</resources>',
        ''
    ]
};

// Clearly fake IDs; one carries `$&` and `$1` so a string replacer would mangle it
const IDS = {
    admob: {
        androidAppId: 'ca-app-pub-1234567890123456~1111111111',
        iosAppId: 'ca-app-pub-1234567890123456~2222222222',
        androidBanner: 'ca-app-pub-1234567890123456/3333333333',
        androidInterstitial: 'ca-app-pub-1234567890123456/4444444444',
        androidRewarded: 'ca-app-pub-1234567890123456/5555555555',
        iosBanner: 'ca-app-pub-1234567890123456/6666666666',
        iosInterstitial: 'ca-app-pub-1234567890123456/7777777777',
        iosRewarded: 'ca-app-pub-1234567890123456/8888888888'
    },
    revenueCat: { appleApiKey: 'appl_fakeAppleKey$&', googleApiKey: 'goog_fakeGoogleKey$1' },
    gameServices: {
        androidAppId: '123456789012',
        leaderboardAndroid: 'CgkIfakeLeaderboard',
        firstCompletionAndroid: 'CgkIfakeFirst',
        tenCompletionsAndroid: 'CgkIfakeTen',
        leaderboardIos: 'com.example.fake.high_score',
        firstCompletionIos: 'com.example.fake.first_completion',
        tenCompletionsIos: 'com.example.fake.ten_completions'
    }
};

async function seed(t, eol = '\n') {
    const dir = await tmpDir(t);
    for (const [rel, lines] of Object.entries(TEMPLATE)) await fs.outputFile(path.join(dir, rel), lines.join(eol));
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');

// The template with the given line substitutions (whole-line, so every other byte must stay identical)
function expected(rel, eol, subs) {
    return TEMPLATE[rel].map((line) => {
        for (const [from, to] of subs) if (line.includes(from)) return line.replace(from, () => to);
        return line;
    }).join(eol);
}

for (const eol of ['\n', '\r\n']) {
    test(`writeGameIds writes all three groups and keeps every other byte (${JSON.stringify(eol)})`, async (t) => {
        const { writeGameIds } = require('../src/game/ids');
        const dir = await seed(t, eol);
        assert.deepEqual(await writeGameIds(dir, IDS), ['admob', 'revenueCat', 'gameServices']);
        const a = IDS.admob;
        assert.equal(await read(dir, ADS), expected(ADS, eol, [
            ['ca-app-pub-3940256099942544/9214589741', a.androidBanner],
            ['ca-app-pub-3940256099942544/1033173712', a.androidInterstitial],
            ['ca-app-pub-3940256099942544/5224354917', a.androidRewarded],
            ['ca-app-pub-3940256099942544/2435281174', a.iosBanner],
            ['ca-app-pub-3940256099942544/4411468910', a.iosInterstitial],
            ['ca-app-pub-3940256099942544/1712485313', a.iosRewarded]
        ]));
        assert.equal(await read(dir, ADS_SETTINGS), expected(ADS_SETTINGS, eol, [
            ['ca-app-pub-3940256099942544~3347511713', a.androidAppId],
            ['ca-app-pub-3940256099942544~1458002511', a.iosAppId]
        ]));
        assert.equal(await read(dir, PURCHASES), expected(PURCHASES, eol, [
            ['ApiKeyApple = "test_qmHxQuucnBoXDlJVLUGsCxcGXrw"', `ApiKeyApple = "${IDS.revenueCat.appleApiKey}"`],
            ['ApiKeyGoogle = "test_qmHxQuucnBoXDlJVLUGsCxcGXrw"', `ApiKeyGoogle = "${IDS.revenueCat.googleApiKey}"`]
        ]));
        const g = IDS.gameServices;
        assert.equal(await read(dir, LEADERBOARDS), expected(LEADERBOARDS, eol, [
            ['REPLACE_ME_high_score', g.leaderboardAndroid],
            ['REPLACE_ME_first_completion', g.firstCompletionAndroid],
            ['REPLACE_ME_ten_completions', g.tenCompletionsAndroid],
            ['cmpose.replace_me.high_score', g.leaderboardIos],
            ['cmpose.replace_me.first_completion', g.firstCompletionIos],
            ['cmpose.replace_me.ten_completions', g.tenCompletionsIos]
        ]));
        assert.equal(await read(dir, GAMES_XML), expected(GAMES_XML, eol, [['>0</string>', `>${g.androidAppId}</string>`]]));

        const all = (await Promise.all(Object.keys(TEMPLATE).map((rel) => read(dir, rel)))).join('');
        for (const old of ['9214589741', '3347511713', '1458002511', 'test_qmHx', 'REPLACE_ME', 'replace_me']) {
            assert.ok(!all.includes(old), `${old} is gone`);
        }
    });
}

test('writeGameIds writes only the groups given', async (t) => {
    const { writeGameIds } = require('../src/game/ids');
    const dir = await seed(t);
    assert.deepEqual(await writeGameIds(dir, { revenueCat: IDS.revenueCat }), ['revenueCat']);
    assert.equal(await read(dir, ADS), TEMPLATE[ADS].join('\n'));
    assert.equal(await read(dir, LEADERBOARDS), TEMPLATE[LEADERBOARDS].join('\n'));
    assert.match(await read(dir, PURCHASES), /ApiKeyGoogle = "goog_fakeGoogleKey\$1";/);
});

test('writeGameIds with no groups changes nothing', async (t) => {
    const { writeGameIds } = require('../src/game/ids');
    const dir = await seed(t);
    assert.deepEqual(await writeGameIds(dir, {}), []);
    for (const [rel, lines] of Object.entries(TEMPLATE)) assert.equal(await read(dir, rel), lines.join('\n'), rel);
});

test('writeGameIds rejects a key that is there twice and writes nothing', async (t) => {
    const { writeGameIds } = require('../src/game/ids');
    const dir = await seed(t);
    const twice = TEMPLATE[ADS].flatMap((l) => (l.includes('RewardedIos =') ? [l, l] : [l])).join('\n');
    await fs.outputFile(path.join(dir, ADS), twice);
    await assert.rejects(writeGameIds(dir, IDS), new RegExp(`${ADS}: RewardedIos found 2 times`));
    assert.equal(await read(dir, ADS), twice);
    assert.equal(await read(dir, PURCHASES), TEMPLATE[PURCHASES].join('\n'));
});

test('writeGameIds rejects a key that is missing', async (t) => {
    const { writeGameIds } = require('../src/game/ids');
    const dir = await seed(t);
    await fs.outputFile(path.join(dir, GAMES_XML), '<resources>\n</resources>\n');
    await assert.rejects(writeGameIds(dir, { gameServices: IDS.gameServices }), /games-ids\.xml: games_app_id found 0 times/);
    assert.equal(await read(dir, LEADERBOARDS), TEMPLATE[LEADERBOARDS].join('\n'));
});

test('writeGameIds rejects a missing file for a present group, naming it', async (t) => {
    const { writeGameIds } = require('../src/game/ids');
    const dir = await seed(t);
    await fs.remove(path.join(dir, PURCHASES));
    await assert.rejects(writeGameIds(dir, { revenueCat: IDS.revenueCat }), (e) => e.message.includes(PURCHASES));
});

test('ID_TARGETS covers every field of every id group in the contract', () => {
    const { ID_TARGETS } = require('../src/game/ids');
    const { GAME_SCHEMA } = require('../src/game/contract');
    assert.deepEqual(Object.keys(ID_TARGETS).sort(), Object.keys(GAME_SCHEMA.idGroups).sort());
    for (const [group, def] of Object.entries(GAME_SCHEMA.idGroups)) {
        const fields = ID_TARGETS[group].flatMap((target) => Object.values(target.keys));
        assert.deepEqual(fields.sort(), [...def.fields].sort(), group);
    }
});
