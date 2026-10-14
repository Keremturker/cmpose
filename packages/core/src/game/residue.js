const path = require('path');
const fs = require('fs-extra');

// Unity caches and local state never ship and are never scanned
const ALWAYS_SKIPPED = new Set(['Library', 'Temp', 'Logs', 'UserSettings', 'obj', '.git']);
const TEXT_EXTENSIONS = new Set(['.cs', '.asmdef', '.asmref', '.json', '.asset', '.unity', '.prefab', '.mat', '.xml',
    '.plist', '.xcprivacy', '.md', '.txt', '.gradle', '.properties', '.mm', '.m', '.h', '.swift', '.meta', '.yml', '.yaml']);

async function walk(abs, rel, out) {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (!rel && ALWAYS_SKIPPED.has(entry.name)) continue;
            if (entry.name === '.git') continue;
            await walk(path.join(abs, entry.name), r, out);
        } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(r);
        }
    }
}

const ignoredBy = (prefixes, rel) => prefixes.some((p) => rel === p || rel.startsWith(p));

async function findResidue(dir, rules, { ignore = [] } = {}) {
    const files = [];
    await walk(dir, '', files);
    const problems = new Set();
    for (const rel of files.sort()) {
        if (ignoredBy(ignore, rel)) continue;
        const text = await fs.readFile(path.join(dir, rel), 'utf8');
        for (const rule of rules) {
            if (rule.extensions && !rule.extensions.includes(path.extname(rel))) continue;
            if (ignoredBy(rule.ignore || [], rel)) continue;
            for (const token of rule.tokens) if (text.includes(token)) problems.add(`${rule.name} ${token} in ${rel}`);
        }
    }
    return [...problems].sort();
}

module.exports = { findResidue };
