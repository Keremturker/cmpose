'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { contractFacts, hashContract, SCHEMA } = require('../src/contract');
const LIMITS = require('../src/limits');

test('local contract carries product limits only', () => {
    const facts = contractFacts();
    assert.deepStrictEqual(facts.limits, { ...LIMITS });
    assert.strictEqual(facts.reservedPackagePrefix, 'com.kturker.multiplatform');
    assert.deepStrictEqual(facts.templateTypes, SCHEMA.templateTypes);
});

test('server limits join the limits and change the hash', () => {
    const local = contractFacts();
    const hosted = contractFacts({ serverLimits: { rateLimitMax: 5, rateLimitWindowMinutes: 15, maxBodyLimit: '500kb' } });
    assert.strictEqual(hosted.limits.rateLimitMax, 5);
    assert.notStrictEqual(hashContract(local), hashContract(hosted));
    assert.match(hashContract(local), /^[0-9a-f]{12}$/);
});

test('custom limits reconfigure the validator messages', () => {
    const facts = contractFacts({ limits: { ...LIMITS, maxModules: 7 } });
    assert.strictEqual(facts.limits.maxModules, 7);
    assert.match(facts.messages.maxModulesReached, /7/);
    contractFacts(); // restore defaults for other tests
});
