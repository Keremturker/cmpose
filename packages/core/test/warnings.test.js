'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generationWarnings } = require('../src/warnings');

test('showcase warns about ads and purchases test keys', () => {
    assert.strictEqual(generationWarnings({ templateType: 'showcase', featuresConfig: null }).length, 2);
});

test('blank warns only for the flags that are on', () => {
    assert.deepStrictEqual(generationWarnings({ templateType: 'blank', featuresConfig: { ads: false, purchases: false } }), []);
    const w = generationWarnings({ templateType: 'blank', featuresConfig: { ads: true, purchases: false } });
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /AdMob/);
});
