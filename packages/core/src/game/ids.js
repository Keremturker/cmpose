const path = require('path');
const fs = require('fs-extra');

// Where each id group lands in the Unity template. `keys` maps the line's key to the field of the group.
// kind 'cs': `public const string <Key> = "<value>";`, 'yaml': `  <key>: <value>`, 'xml': the games_app_id string.
const ID_TARGETS = Object.freeze({
    admob: [
        {
            file: 'Assets/_Project/Core/Ads/AdsConfig.cs',
            kind: 'cs',
            keys: {
                BannerAndroid: 'androidBanner', InterstitialAndroid: 'androidInterstitial', RewardedAndroid: 'androidRewarded',
                BannerIos: 'iosBanner', InterstitialIos: 'iosInterstitial', RewardedIos: 'iosRewarded'
            }
        },
        {
            file: 'Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset',
            kind: 'yaml',
            keys: { adMobAndroidAppId: 'androidAppId', adMobIOSAppId: 'iosAppId' }
        }
    ],
    revenueCat: [
        {
            file: 'Assets/_Project/Core/Purchases/PurchasesConfig.cs',
            kind: 'cs',
            keys: { ApiKeyApple: 'appleApiKey', ApiKeyGoogle: 'googleApiKey' }
        }
    ],
    gameServices: [
        {
            file: 'Assets/_Project/Core/Leaderboards/LeaderboardsConfig.cs',
            kind: 'cs',
            keys: {
                LeaderboardAndroid: 'leaderboardAndroid', FirstCompletionAndroid: 'firstCompletionAndroid',
                TenCompletionsAndroid: 'tenCompletionsAndroid', LeaderboardIos: 'leaderboardIos',
                FirstCompletionIos: 'firstCompletionIos', TenCompletionsIos: 'tenCompletionsIos'
            }
        },
        {
            file: 'Assets/_Project/Core/Leaderboards/Plugins/Android/CmposeGames.androidlib/src/main/res/values/games-ids.xml',
            kind: 'xml',
            keys: { games_app_id: 'androidAppId' }
        }
    ]
});

// Each pattern captures what comes before the value (1) and after it (2), within one line: [ \t] instead of \s
// so a match never spans lines, and \r stays outside the value so CRLF files keep their line ends.
const PATTERNS = {
    cs: (key) => new RegExp(`^([ \\t]*public const string ${key} = ")[^"\\r\\n]*(";)(?=[ \\t]*\\r?$)`, 'gm'),
    yaml: (key) => new RegExp(`^([ \\t]*${key}: )[^\\r\\n]*()`, 'gm'),
    xml: (key) => new RegExp(`(<string name="${key}"[^>]*>)[^<]*(</string>)`, 'g')
};

function replaceOnce(text, file, kind, key, value) {
    const re = PATTERNS[kind](key);
    const n = (text.match(re) || []).length;
    if (n !== 1) throw new Error(`${file}: ${key} found ${n} times`);
    // A function replacer, so `$` sequences in the value are never interpreted
    return text.replace(re, (_, before, after) => `${before}${value}${after}`);
}

// Writes the given id groups into the project; every target line must be there exactly once. All files are checked
// before any is written, so a failure leaves the project as it was. Returns the groups written.
async function writeGameIds(projectDir, ids) {
    const written = [];
    const updates = [];
    for (const group of Object.keys(ID_TARGETS)) {
        const values = ids && ids[group];
        if (!values) continue;
        for (const { file, kind, keys } of ID_TARGETS[group]) {
            const abs = path.join(projectDir, file);
            let text;
            try {
                text = await fs.readFile(abs, 'utf8');
            } catch (e) {
                throw new Error(`${file}: cannot read (${e.code || e.message})`);
            }
            for (const [key, field] of Object.entries(keys)) text = replaceOnce(text, file, kind, key, values[field]);
            updates.push([abs, text]);
        }
        written.push(group);
    }
    for (const [abs, text] of updates) await fs.writeFile(abs, text);
    return written;
}

module.exports = { ID_TARGETS, writeGameIds };
