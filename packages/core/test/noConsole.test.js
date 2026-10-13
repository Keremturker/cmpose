'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The MCP server speaks JSON-RPC on stdout: core code must log through src/log.js only.
// ProjectValidator.js is shared with the browser wizard and is exempt.
test('core sources never call console directly', () => {
    const dir = path.join(__dirname, '..', 'src');
    const offenders = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.js') && f !== 'ProjectValidator.js')
        .filter((f) => /\bconsole\.(log|info|warn|error|debug)\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepStrictEqual(offenders, []);
});
