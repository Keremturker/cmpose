const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const { escapeRe } = require('./unityYaml');

// Unity asset identity: every asset's .meta carries 'guid: <32 lowercase hex>'; scenes, prefabs and assets
// point at it ('guid: <hex>'), asmdefs may too ('GUID:<hex>'). A cloned folder gets new guids, derived from
// a seed so the same request always produces the same project.
const GUID_RE = /^[0-9a-f]{32}$/;
const TEXT_EXTENSIONS = new Set(['.meta', '.unity', '.prefab', '.asset', '.mat', '.asmdef', '.asmref', '.cs',
    '.controller', '.anim', '.json', '.txt']);

function newGuid(seed, oldGuid, name) {
    return crypto.createHash('md5').update(`${seed}:${oldGuid}:${name}`).digest('hex');
}

function readMetaGuid(metaText) {
    const m = /^guid: ([0-9a-f]{32})\r?$/m.exec(metaText);
    if (!m) throw new Error('the .meta file has no valid guid line');
    return m[1];
}

function remapGuids(text, map) {
    return text.replace(/(guid: |GUID:)([0-9a-f]{32})(?![0-9a-f])/g,
        (match, prefix, guid) => (map.has(guid) ? prefix + map.get(guid) : match));
}

// One pass, longest 'from' first, so a replacement is never replaced again
function renamer(pairs) {
    if (!pairs.length) return (s) => s;
    const sorted = [...pairs].sort((a, b) => b.from.length - a.from.length);
    const lookup = new Map(sorted.map((p) => [p.from, p.to]));
    const re = new RegExp(sorted.map((p) => escapeRe(p.from)).join('|'), 'g');
    return (s) => s.replace(re, (m) => lookup.get(m));
}

async function walk(dir) {
    const out = [];
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await walk(full));
        else out.push(full);
    }
    return out;
}

async function cloneWithNewGuids(srcDir, dstDir, { seed, rename = [] }) {
    if (await fs.pathExists(dstDir)) throw new Error(`destination exists: ${dstDir}`);
    const apply = renamer(rename);
    // The folder's own .meta sits next to it
    const sources = await walk(srcDir);
    const jobs = sources.map((file) => ({ from: file, to: path.join(dstDir, apply(path.relative(srcDir, file))) }));
    if (await fs.pathExists(`${srcDir}.meta`)) jobs.push({ from: `${srcDir}.meta`, to: `${dstDir}.meta` });

    const map = new Map();
    for (const job of jobs.filter((j) => j.from.endsWith('.meta'))) {
        const old = readMetaGuid(await fs.readFile(job.from, 'utf8'));
        const name = path.relative(path.dirname(dstDir), job.to).split(path.sep).join('/');
        map.set(old, newGuid(seed, old, name));
    }
    for (const job of jobs) {
        if (TEXT_EXTENSIONS.has(path.extname(job.from))) {
            await fs.outputFile(job.to, remapGuids(apply(await fs.readFile(job.from, 'utf8')), map));
        } else {
            await fs.copy(job.from, job.to);
        }
    }
    return { map };
}

module.exports = { GUID_RE, newGuid, readMetaGuid, remapGuids, renamer, cloneWithNewGuids };
