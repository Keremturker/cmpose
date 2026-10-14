const path = require('path');
const fs = require('fs-extra');
const { idProblem } = require('./validate');

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

// One regex pass: the replacer counts the matches; a function replacer never interprets `$` sequences
function replaceOnce(text, file, kind, key, value) {
    let n = 0;
    const next = text.replace(PATTERNS[kind](key), (_, before, after) => {
        n += 1;
        return `${before}${value}${after}`;
    });
    if (n !== 1) throw new Error(`${file}: ${key} found ${n} times`);
    return next;
}

// The values land inside C#, YAML and XML lines: the same rules as validateGame, checked here too
function checkValues(group, values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`ids.${group} must be an object`);
    for (const { keys } of ID_TARGETS[group]) {
        for (const field of Object.values(keys)) {
            const problem = idProblem(group, field, values[field]);
            if (problem) throw new Error(`ids.${group}.${field} ${problem}`);
        }
    }
}

// Writes the given id groups into the project; every value must pass validateGame's ID rules and every target line
// must be there exactly once. All are checked before any file is written, so a failure leaves the project as it was.
// Returns the groups written.
async function writeGameIds(projectDir, ids) {
    const groups = Object.keys(ID_TARGETS).filter((group) => ids && ids[group]);
    for (const group of groups) checkValues(group, ids[group]);
    const written = [];
    const updates = [];
    for (const group of groups) {
        const values = ids[group];
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
