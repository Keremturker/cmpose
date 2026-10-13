'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { log, setLogger } = require('../src/log');

test('log is silent by default and forwards to the logger that is set', () => {
    const seen = [];
    log.info('dropped');
    setLogger({ info: (...a) => seen.push(['info', ...a]), warn: (...a) => seen.push(['warn', ...a]), error: (...a) => seen.push(['error', ...a]) });
    log.info('a', 1);
    log.warn('b');
    log.error('c');
    setLogger(null);
    log.info('dropped again');
    assert.deepStrictEqual(seen, [['info', 'a', 1], ['warn', 'b'], ['error', 'c']]);
});
