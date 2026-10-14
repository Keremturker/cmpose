const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const { GUID_RE, newGuid, readMetaGuid, remapGuids, cloneWithNewGuids } = require('../src/game/guid');
const { G, IDS, writeMiniProject, tmpDir } = require('./support/gameFixtures');

test('newGuid is 32 lowercase hex characters and deterministic', () => {
    const a = newGuid('seed', IDS.view, 'Shop/Presentation/ShopView.cs.meta');
    assert.match(a, GUID_RE);
    assert.equal(a, newGuid('seed', IDS.view, 'Shop/Presentation/ShopView.cs.meta'));
    assert.notEqual(a, newGuid('other', IDS.view, 'Shop/Presentation/ShopView.cs.meta'));
});

test('readMetaGuid reads the guid line (LF or CRLF) and rejects a meta without one', () => {
    assert.equal(readMetaGuid(`fileFormatVersion: 2\nguid: ${IDS.view}\n`), IDS.view);
    assert.equal(readMetaGuid(`fileFormatVersion: 2\r\nguid: ${IDS.view}\r\n`), IDS.view);
    assert.throws(() => readMetaGuid('fileFormatVersion: 2\n'));
    assert.throws(() => readMetaGuid('guid: XYZ\n'));
});

test('remapGuids rewrites guid: and GUID: references only for mapped guids', () => {
    const text = `a: {fileID: 1, guid: ${G('a2')}, type: 3}\n"GUID:${G('a5')}"\nguid: ${G('ff')}\nproductGUID: ${G('a2')}\n`;
    const out = remapGuids(text, new Map([[G('a2'), G('d2')], [G('a5'), G('d5')]]));
    assert.equal(out, `a: {fileID: 1, guid: ${G('d2')}, type: 3}\n"GUID:${G('d5')}"\nguid: ${G('ff')}\nproductGUID: ${G('a2')}\n`);
});

test('cloneWithNewGuids copies a feature under a new name with fresh, consistent guids', async (t) => {
    const dir = await tmpDir(t);
    await writeMiniProject(dir);
    const feat = path.join(dir, 'Assets/_Project/Features');
    const { map } = await cloneWithNewGuids(path.join(feat, 'Sample'), path.join(feat, 'Shop'),
        { seed: 'dev.cmpose.game', rename: [{ from: 'Sample', to: 'Shop' }] });

    for (const k of ['sample', 'presentation', 'view', 'presAsmdef', 'prefab', 'domainAsmdef', 'domain']) {
        assert.match(map.get(IDS[k]), GUID_RE, k);
        assert.notEqual(map.get(IDS[k]), IDS[k], k);
    }
    const shop = (rel) => fs.readFileSync(path.join(feat, 'Shop', rel), 'utf8');
    assert.match(shop('Presentation/ShopView.cs'), /namespace Kturker\.UnityBase\.Features\.Shop\.Presentation/);
    assert.match(shop('Presentation/ShopView.cs'), /class ShopView/);
    assert.equal(readMetaGuid(shop('Presentation/ShopView.cs.meta')), map.get(IDS.view));
    assert.ok(shop('Presentation/ShopScreen.prefab').includes(`guid: ${map.get(IDS.view)}, type: 3`));
    assert.ok(shop('Presentation/ShopScreen.prefab').includes('guid: 0000000000000000e000000000000000'));
    const asm = JSON.parse(shop('Presentation/Kturker.UnityBase.Features.Shop.Presentation.asmdef'));
    assert.deepEqual(asm.references, ['Kturker.UnityBase.Features.Shop.Domain', `GUID:${map.get(IDS.domainAsmdef)}`]);
    assert.equal(readMetaGuid(fs.readFileSync(path.join(feat, 'Shop.meta'), 'utf8')), map.get(IDS.sample));
    assert.equal(readMetaGuid(fs.readFileSync(path.join(feat, 'Sample/Presentation/SampleView.cs.meta'), 'utf8')), IDS.view,
        'the source is untouched');
});

test('cloneWithNewGuids is deterministic for a seed and refuses an existing destination', async (t) => {
    const a = await tmpDir(t);
    const b = await tmpDir(t);
    await writeMiniProject(a);
    await writeMiniProject(b);
    const opts = { seed: 'dev.cmpose.game', rename: [{ from: 'Sample', to: 'Shop' }] };
    const feat = (d) => path.join(d, 'Assets/_Project/Features');
    const first = await cloneWithNewGuids(path.join(feat(a), 'Sample'), path.join(feat(a), 'Shop'), opts);
    const second = await cloneWithNewGuids(path.join(feat(b), 'Sample'), path.join(feat(b), 'Shop'), opts);
    assert.deepEqual([...first.map], [...second.map]);
    await assert.rejects(cloneWithNewGuids(path.join(feat(a), 'Sample'), path.join(feat(a), 'Shop'), opts), /exists/);
});
