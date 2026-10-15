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

test('blank with backend warns once about the Firebase config files and the local server', () => {
    const w = generationWarnings({ templateType: 'blank', featuresConfig: { backend: true } });
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /google-services\.json/);
    assert.match(w[0], /GoogleService-Info\.plist/);
    assert.match(w[0], /:server:runLocal/);
});

test('showcase never warns about the backend', () => {
    for (const featuresConfig of [null, { backend: true }]) {
        const w = generationWarnings({ templateType: 'showcase', featuresConfig });
        assert.ok(!w.some((m) => /Firebase|server/.test(m)), JSON.stringify(w));
    }
});
