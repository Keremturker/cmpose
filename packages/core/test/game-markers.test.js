const test = require('node:test');
const assert = require('node:assert/strict');
const { removeLineMarkedBlock, stripLineMarkers } = require('../src/game/markers');

const SRC = [
    'using VContainer;',
    '// cmpose:ads',
    'using Acme.Core.Ads;',
    '// /cmpose:ads',
    'public sealed class Scope {',
    '    void Configure() {',
    '        // cmpose:ads',
    '        builder.Register<AdsService>();',
    '        // /cmpose:ads',
    '        // cmpose:ads-tracking',
    '        builder.Register<Tracking>();',
    '        // /cmpose:ads-tracking',
    '        builder.Register<Logger>();',
    '    }',
    '}',
    ''
].join('\n');

test('removeLineMarkedBlock removes every marked block with its markers, and only that name', () => {
    assert.equal(removeLineMarkedBlock(SRC, 'ads'), [
        'using VContainer;',
        'public sealed class Scope {',
        '    void Configure() {',
        '        // cmpose:ads-tracking',
        '        builder.Register<Tracking>();',
        '        // /cmpose:ads-tracking',
        '        builder.Register<Logger>();',
        '    }',
        '}',
        ''
    ].join('\n'));
});

test('stripLineMarkers keeps the block and drops only its marker lines', () => {
    const out = stripLineMarkers(SRC, 'ads');
    assert.ok(out.includes('using Acme.Core.Ads;\npublic sealed class Scope {'));
    assert.ok(out.includes('        builder.Register<AdsService>();\n        // cmpose:ads-tracking'));
    assert.ok(!/\/\/ \/?cmpose:ads\r?$/m.test(out));
});

test('CRLF text keeps CRLF, unknown names are a no-op, broken markers throw', () => {
    const crlf = SRC.replace(/\n/g, '\r\n');
    assert.equal(removeLineMarkedBlock(crlf, 'ads'), removeLineMarkedBlock(SRC, 'ads').replace(/\n/g, '\r\n'));
    assert.equal(removeLineMarkedBlock(SRC, 'purchases'), SRC);
    assert.throws(() => removeLineMarkedBlock('// cmpose:ads\nx\n', 'ads'), /cmpose:ads/);
    assert.throws(() => removeLineMarkedBlock('x\n// /cmpose:ads\n', 'ads'), /cmpose:ads/);
});
