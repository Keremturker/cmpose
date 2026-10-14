const test = require('node:test');
const assert = require('node:assert');
const { hashContract } = require('../src/contract');
const { GAME_SCHEMA, gameContractFacts, gameContractVersion } = require('../src/game/contract');

test('gameContractVersion is 12 hex chars and stable', () => {
    assert.match(gameContractVersion(), /^[0-9a-f]{12}$/);
    assert.strictEqual(gameContractVersion(), gameContractVersion());
});
test('gameContractVersion changes with the limits', () => {
    const facts = gameContractFacts();
    const changed = { ...facts, limits: { ...facts.limits, maxModules: GAME_SCHEMA.limits.maxModules + 1 } };
    assert.notStrictEqual(hashContract(changed), gameContractVersion());
});
