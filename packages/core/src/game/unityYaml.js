// cmpose.dev/game: Unity's serialized YAML (ProjectSettings.asset, EditorBuildSettings.asset) is edited
// line by line, never through a YAML library: Unity's tags (--- !u!129 &1) and layout must survive.
// Every editor works inside one document and refuses to guess: no match or more than one throws.

class UnityYamlError extends Error {
    constructor(message, { key, matches } = {}) {
        super(message);
        this.name = 'UnityYamlError';
        this.key = key;
        this.matches = matches;
    }
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function eolOf(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

function findDocument(text, classId, fileId = 1) {
    const header = new RegExp(`^--- !u!${classId} &${fileId}(?![0-9])[^\\r\\n]*`, 'm').exec(text);
    if (!header) throw new UnityYamlError(`document !u!${classId} &${fileId} not found`);
    const bodyStart = header.index + header[0].length;
    const next = /^--- /m.exec(text.slice(bodyStart));
    return { start: header.index, end: next ? bodyStart + next.index : text.length };
}

function withScope(text, doc, edit) {
    const { start, end } = doc ? findDocument(text, doc.classId, doc.fileId === undefined ? 1 : doc.fileId) : { start: 0, end: text.length };
    const segment = text.slice(start, end);
    const result = edit(segment);
    return result === undefined ? undefined : { text: text.slice(0, start) + result + text.slice(end), segment };
}

// Lines keep their own line ending; the last one may have none
function splitLines(segment) {
    return segment.split(/(?<=\n)/);
}

function body(line) {
    return line.replace(/\r?\n$/, '');
}

function ending(line) {
    const m = /\r?\n$/.exec(line);
    return m ? m[0] : '';
}

function topLevelIndexes(lines, key) {
    const re = new RegExp(`^  ${escapeRe(key)}:(?:[ \\t]|$)`);
    const found = [];
    lines.forEach((line, i) => { if (re.test(body(line))) found.push(i); });
    return found;
}

function onlyOne(found, key) {
    if (found.length !== 1) {
        throw new UnityYamlError(`${key}: expected 1 match, found ${found.length}`, { key, matches: found.length });
    }
    return found[0];
}

function valueOf(line, key) {
    return body(line).slice(`  ${key}:`.length).trim();
}

function setScalar(text, key, value, { doc } = {}) {
    return withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const i = onlyOne(topLevelIndexes(lines, key), key);
        lines[i] = `  ${key}: ${value}${ending(lines[i])}`;
        return lines.join('');
    }).text;
}

function getScalar(text, key, { doc } = {}) {
    let value;
    withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const found = topLevelIndexes(lines, key);
        if (found.length > 1) onlyOne(found, key);
        value = found.length === 1 ? valueOf(lines[found[0]], key) : undefined;
        return segment;
    });
    return value;
}

// A block map: '  key:' followed by deeper-indented lines; an empty one is written '  key: {}'
function locateMap(lines, mapKey) {
    const header = onlyOne(topLevelIndexes(lines, mapKey), mapKey);
    const inline = valueOf(lines[header], mapKey);
    let end = header + 1;
    if (!inline) while (end < lines.length && /^ {4,}\S/.test(body(lines[end]))) end++;
    if (inline && !/^\{\s*\}$/.test(inline)) {
        throw new UnityYamlError(`${mapKey}: inline map '${inline}' is not supported`, { key: mapKey });
    }
    return { header, end, empty: Boolean(inline) || end === header + 1 };
}

function entryIndexes(lines, header, end, subKey) {
    const re = new RegExp(`^    ${escapeRe(subKey)}:(?:[ \\t]|$)`);
    const found = [];
    for (let i = header + 1; i < end; i++) if (re.test(body(lines[i]))) found.push(i);
    if (found.length > 1) onlyOne(found, subKey);
    return found;
}

function setMapEntry(text, mapKey, subKey, value, { doc } = {}) {
    const eol = eolOf(text);
    return withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const { header, end } = locateMap(lines, mapKey);
        const entry = `    ${subKey}: ${value}`;
        if (end === header + 1) {
            lines[header] = `  ${mapKey}:${eol}${entry}${ending(lines[header])}`;
            return lines.join('');
        }
        const found = entryIndexes(lines, header, end, subKey);
        if (found.length === 1) {
            lines[found[0]] = entry + ending(lines[found[0]]);
        } else {
            // The new entry takes the last entry's line ending; at the very end of the file it has none
            const last = end - 1;
            const lastEnding = ending(lines[last]);
            if (!lastEnding) lines[last] += eol;
            lines.splice(end, 0, entry + lastEnding);
        }
        return lines.join('');
    }).text;
}

function getMapEntry(text, mapKey, subKey, { doc } = {}) {
    let value;
    withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const { header, end } = locateMap(lines, mapKey);
        const found = entryIndexes(lines, header, end, subKey);
        value = found.length === 1 ? body(lines[found[0]]).slice(`    ${subKey}:`.length).trim() : undefined;
        return segment;
    });
    return value;
}

// The sub-keys of a block map, in file order ([] for an empty map)
function getMapKeys(text, mapKey, { doc } = {}) {
    let keys = [];
    withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const { header, end } = locateMap(lines, mapKey);
        keys = [];
        for (let i = header + 1; i < end; i++) {
            const m = /^ {4}([^\s:][^:]*):(?:[ \t]|$)/.exec(body(lines[i]));
            if (m) keys.push(m[1]);
        }
        return segment;
    });
    return keys;
}

function removeMapEntry(text, mapKey, subKey, { doc } = {}) {
    return withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const { header, end } = locateMap(lines, mapKey);
        const found = entryIndexes(lines, header, end, subKey);
        if (found.length === 0) return segment;
        lines.splice(found[0], 1);
        if (end - 1 === header + 1) lines[header] = `  ${mapKey}: {}${ending(lines[header])}`;
        return lines.join('');
    }).text;
}

// A list under a top-level key: Unity writes its items at the key's own indent ('  - item')
function setList(text, key, items, { doc } = {}) {
    const eol = eolOf(text);
    return withScope(text, doc, (segment) => {
        const lines = splitLines(segment);
        const header = onlyOne(topLevelIndexes(lines, key), key);
        let end = header + 1;
        while (end < lines.length && /^  - /.test(body(lines[end]))) end++;
        const after = ending(lines[end - 1]);
        const block = items.length === 0
            ? `  ${key}: []${after}`
            : [`  ${key}:`, ...items.map((item) => `  - ${item}`)].join(eol) + after;
        lines.splice(header, end - header, block);
        return lines.join('');
    }).text;
}

module.exports = {
    UnityYamlError, escapeRe, findDocument, setScalar, getScalar, setMapEntry, getMapEntry, getMapKeys, removeMapEntry, setList
};
