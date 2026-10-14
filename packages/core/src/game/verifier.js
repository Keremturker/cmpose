'use strict';
const path = require('path');
const fs = require('fs-extra');
const { checkGuidIntegrity, readGuidAllowlist } = require('./guidIntegrity');
const { findResidue } = require('./residue');
const { escapeRe } = require('./unityYaml');

const IDENTITY_RULE = { name: 'old identity', tokens: ['Kturker.UnityBase', 'UnityBase', 'unitybase', 'com.kturker'] };
const MARKER_RULE = { name: 'marker', tokens: ['// cmpose:', '// /cmpose:'], extensions: ['.cs'] };
// Extension points stay as whole lines (// cmpose:features:start … // cmpose:features:end in the GameInstaller,
// // cmpose:boot-steps:start … :end in the BootInstaller): users add their own lines between them. A name may be
// kebab-case or camelCase (// cmpose:myExt:start).
const KEPT_MARKER_LINE = /^[ \t]*\/\/ cmpose:[a-z][A-Za-z0-9-]*:(?:start|end)[ \t]*\r?$/gm;
const MARKER_PROBLEM = new RegExp(`^marker (${MARKER_RULE.tokens.map(escapeRe).join('|')}) in (.+)$`);
const IGNORE = ['.cmpose/'];

// A marker problem stands only when the token is still there once the kept extension-point lines are dropped.
// The token is one of the rule's own, so a path holding ' in ' is read whole. Each file is read (and stripped)
// once, however many marker problems it has.
function markerCheck(projectDir) {
    const stripped = new Map();
    return async (problem) => {
        const m = MARKER_PROBLEM.exec(problem);
        if (!stripped.has(m[2])) {
            stripped.set(m[2], (await fs.readFile(path.join(projectDir, m[2]), 'utf8')).replace(KEPT_MARKER_LINE, ''));
        }
        return stripped.get(m[2]).includes(m[1]);
    };
}

/** Problems of a generated Unity game (empty = clean), as one sorted list: asset guids, the template's identity,
 * leftover flag markers */
async function verifyGameProject(projectDir) {
    const allowlist = await readGuidAllowlist(path.join(projectDir, '.cmpose', 'package-guids.txt'));
    const guidProblems = await checkGuidIntegrity(projectDir, { allowlist });
    const residue = await findResidue(projectDir, [IDENTITY_RULE, MARKER_RULE], { ignore: IGNORE });
    const stillMarked = markerCheck(projectDir);
    const problems = [...guidProblems];
    for (const problem of residue) {
        if (!problem.startsWith('marker ') || (await stillMarked(problem))) problems.push(problem);
    }
    return problems.sort();
}

module.exports = { verifyGameProject };
