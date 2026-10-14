'use strict';
const path = require('path');
const fs = require('fs-extra');
const { checkGuidIntegrity, readGuidAllowlist } = require('./guidIntegrity');
const { findResidue } = require('./residue');

const IDENTITY_RULE = { name: 'old identity', tokens: ['Kturker.UnityBase', 'UnityBase', 'unitybase', 'com.kturker'] };
const MARKER_RULE = { name: 'marker', tokens: ['// cmpose:', '// /cmpose:'], extensions: ['.cs'] };
// The generated GameInstaller keeps these two lines: the in-game guide tells users to add installers between them
const KEPT_MARKER_LINE = /^[ \t]*\/\/ cmpose:features:(?:start|end)[ \t]*\r?$/gm;
const IGNORE = ['.cmpose/'];

// A marker problem stands only when the token is still there once the kept features marker lines are dropped
async function stillMarked(projectDir, problem) {
    const m = /^marker (.+) in (.+)$/.exec(problem);
    const text = (await fs.readFile(path.join(projectDir, m[2]), 'utf8')).replace(KEPT_MARKER_LINE, '');
    return text.includes(m[1]);
}

/** Problems of a generated Unity game (empty = clean): asset guids, the template's identity, leftover flag markers */
async function verifyGameProject(projectDir) {
    const allowlist = await readGuidAllowlist(path.join(projectDir, '.cmpose', 'package-guids.txt'));
    const guidProblems = await checkGuidIntegrity(projectDir, { allowlist });
    const residue = await findResidue(projectDir, [IDENTITY_RULE, MARKER_RULE], { ignore: IGNORE });
    const kept = [];
    for (const problem of residue) {
        if (!problem.startsWith('marker ') || (await stillMarked(projectDir, problem))) kept.push(problem);
    }
    return [...guidProblems, ...kept];
}

module.exports = { verifyGameProject };
