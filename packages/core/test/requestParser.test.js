const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGenerateBody } = require('../src/requestParser');

// The exact shape of the blank payload the web wizard sends
function wizardBlankBody() {
    return {
        projectName: 'MyApp',
        appName: 'My App',
        packageName: 'com.example.myapp',
        minSdk: '24',
        iosVersion: '15.0',
        templateType: 'blank',
        featuresConfig: {
            network: true,
            networkInspector: false,
            networkBaseUrl: '',
            theming: true,
            multiLang: false,
            dataStore: true,
            detekt: false,
            detektYamlContent: null
        },
        features: ['profile', 'settings']
    };
}

function minimalBody() {
    return {
        projectName: 'MyApp',
        appName: 'My App',
        packageName: 'com.example.myapp',
        minSdk: '24',
        iosVersion: '15.0'
    };
}

function assertRejected(result) {
    assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
}

test('accepts the web wizard blank payload and returns its fields unchanged', () => {
    const body = wizardBlankBody();
    const result = parseGenerateBody(body);

    assert.deepEqual(Object.keys(result).sort(), ['ok', 'value']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
        projectName: 'MyApp',
        appName: 'My App',
        packageName: 'com.example.myapp',
        minSdk: '24',
        iosVersion: '15.0',
        features: ['profile', 'settings'],
        featuresConfig: body.featuresConfig,
        templateType: 'blank',
        ci: false
    });
});

test('accepts templateType "showcase"', () => {
    const result = parseGenerateBody({ ...wizardBlankBody(), templateType: 'showcase' });

    assert.equal(result.ok, true);
    assert.equal(result.value.templateType, 'showcase');
});

test('applies defaults when optional fields are absent', () => {
    const result = parseGenerateBody(minimalBody());

    assert.equal(result.ok, true);
    assert.deepEqual(result.value.features, []);
    assert.equal(result.value.templateType, 'showcase');
    assert.equal(result.value.featuresConfig, undefined);
});

test('does not trim or rewrite string fields (existing validators decide)', () => {
    const result = parseGenerateBody({ ...minimalBody(), projectName: ' My App ', appName: ' x ' });

    assert.equal(result.ok, true);
    assert.equal(result.value.projectName, ' My App ');
    assert.equal(result.value.appName, ' x ');
});

test('drops unknown fields from the returned value', () => {
    const result = parseGenerateBody({ ...minimalBody(), networkBaseUrl: 'https://x.dev', extra: 1 });

    assert.equal(result.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'extra'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'networkBaseUrl'), false);
});

test('does not mutate the input body', () => {
    const body = minimalBody();
    const snapshot = JSON.parse(JSON.stringify(body));
    parseGenerateBody(body);

    assert.deepEqual(body, snapshot);
});

test('rejects a body that is not a plain object', () => {
    for (const body of [undefined, null, [], ['MyApp'], 'MyApp', 42, true]) {
        assertRejected(parseGenerateBody(body));
    }
});

for (const field of ['projectName', 'appName', 'packageName', 'minSdk', 'iosVersion']) {
    test(`rejects missing or non-string ${field}`, () => {
        const missing = minimalBody();
        delete missing[field];
        const missingResult = parseGenerateBody(missing);
        assertRejected(missingResult);
        assert.match(missingResult.error, new RegExp(field));

        for (const bad of [1, 24, null, true, ['x'], { x: 1 }]) {
            const result = parseGenerateBody({ ...minimalBody(), [field]: bad });
            assertRejected(result);
            assert.match(result.error, new RegExp(field));
        }
    });
}

test('rejects features that are not an array of strings', () => {
    for (const bad of [null, 'profile', 1, { length: 1 }, [null], ['profile', 1], [['profile']], [{}]]) {
        const result = parseGenerateBody({ ...minimalBody(), features: bad });
        assertRejected(result);
        assert.match(result.error, /features/);
    }
});

test('rejects featuresConfig that is not a plain object', () => {
    for (const bad of [null, [], 'network', 1, true]) {
        const result = parseGenerateBody({ ...minimalBody(), featuresConfig: bad });
        assertRejected(result);
        assert.match(result.error, /featuresConfig/);
    }
});

test('rejects templateType other than "showcase" or "blank"', () => {
    for (const bad of ['blnk', '', 'Showcase', 'BLANK', null, 1, ['blank']]) {
        const result = parseGenerateBody({ ...minimalBody(), templateType: bad });
        assertRejected(result);
        assert.match(result.error, /templateType/);
    }
});

test('ci: missing → false, true/false kept, any non-boolean → 400', () => {
    const base = minimalBody();
    assert.equal(parseGenerateBody(base).value.ci, false);
    assert.equal(parseGenerateBody({ ...base, ci: true }).value.ci, true);
    assert.equal(parseGenerateBody({ ...base, ci: false }).value.ci, false);
    for (const bad of ['true', 1, null, {}, []]) {
        const r = parseGenerateBody({ ...base, ci: bad });
        assert.equal(r.ok, false, `ci=${JSON.stringify(bad)}`);
        assert.equal(r.error, 'ci must be a boolean');
    }
});
