'use strict';
const core = require('@cmpose/core');
const pkg = require('../package.json');

const DEFAULTS = Object.freeze({
    templateType: 'showcase',
    features: [],
    minSdk: String(core.limits.minSdkMin),
    iosVersion: core.limits.iosVersionMin,
    ci: false
});

function describe() {
    const contract = core.contractFacts();
    return {
        contractVersion: core.hashContract(contract),
        coreVersion: core.version,
        mcpVersion: pkg.version,
        template: { ...core.pins.cmp },
        // Outside `contract`: contractVersion hashes the contract only
        defaults: { ...DEFAULTS, featuresConfig: { ...core.featuresConfig.DEFAULTS } },
        contract
    };
}

module.exports = { describe, DEFAULTS };
