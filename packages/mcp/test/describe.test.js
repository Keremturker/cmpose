'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('@cmpose/core');
const { describe } = require('../src/describe');

test('cmp_describe gives the featuresConfig defaults outside the hashed contract', () => {
    const facts = describe();
    assert.deepStrictEqual(facts.defaults.featuresConfig, { ...core.featuresConfig.DEFAULTS });
    assert.strictEqual(facts.contract.defaults, undefined);
    assert.strictEqual(facts.contractVersion, core.hashContract(core.contractFacts()));
    facts.defaults.featuresConfig.network = true; // a caller's copy, not the core's object
    assert.strictEqual(describe().defaults.featuresConfig.network, false);
});
