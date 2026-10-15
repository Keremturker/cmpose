'use strict';
const pins = require('../pins');
const { GAME_SCHEMA, gameContractFacts, gameContractVersion } = require('./contract');

/** What the Unity game generator offers: engine, pinned template, defaults and the contract facts */
function describeGame() {
    return {
        engine: GAME_SCHEMA.engine,
        unityVersion: GAME_SCHEMA.unityVersion,
        contractVersion: gameContractVersion(),
        template: pins.game,
        defaults: {
            templateType: 'showcase',
            render: '2d',
            flags: { showcase: GAME_SCHEMA.flags.slice(), blank: [] },
            features: [],
            minSdk: GAME_SCHEMA.limits.minSdkMin,
            iosVersion: GAME_SCHEMA.limits.iosVersionMin
        },
        contract: gameContractFacts()
    };
}

module.exports = { describeGame };
