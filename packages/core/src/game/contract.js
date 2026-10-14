'use strict';
const { hashContract } = require('../contract');
const limits = require('../limits');

// The Unity game generator's contract: what the game_* tools accept. Published facts feed contractVersion.
const GAME_SCHEMA = Object.freeze({
    engine: 'unity',
    unityVersion: '6000.3.25f1',
    templateTypes: ['showcase', 'blank'],
    renders: ['2d', '3d'],
    flags: ['saveSystem', 'uiTheme', 'multiLang', 'network', 'networkInspector', 'purchases', 'ads', 'leaderboards'],
    flagRequires: { networkInspector: ['network'] },
    idGroups: {
        admob: { flag: 'ads', fields: ['androidAppId', 'iosAppId', 'androidBanner', 'androidInterstitial', 'androidRewarded', 'iosBanner', 'iosInterstitial', 'iosRewarded'] },
        revenueCat: { flag: 'purchases', fields: ['appleApiKey', 'googleApiKey'] },
        gameServices: { flag: 'leaderboards', fields: ['androidAppId', 'leaderboardAndroid', 'firstCompletionAndroid', 'tenCompletionsAndroid', 'leaderboardIos', 'firstCompletionIos', 'tenCompletionsIos'] }
    },
    limits: { minSdkMin: 25, minSdkMax: 36, iosVersionMin: '15.0', maxModules: 3, nameMax: 30, appNameMax: 30, packageNameMax: 50, moduleNameMax: 20 },
    reservedNames: ['UnityBase', 'Kturker'],
    reservedModuleNames: ['sample', 'shell', 'showcase', 'build'],
    reservedPackagePrefix: 'com.kturker'
});

function gameContractFacts() {
    return { ...GAME_SCHEMA, limits: { ...GAME_SCHEMA.limits, iosVersionMax: limits.iosVersionMax } };
}

function gameContractVersion() {
    return hashContract(gameContractFacts());
}

module.exports = { GAME_SCHEMA, gameContractFacts, gameContractVersion };
