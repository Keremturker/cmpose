'use strict';
const path = require('path');
const fs = require('fs-extra');
const { removeMarkedBlock } = require('../readmeService');
const { GAME_SCHEMA } = require('./contract');

// The generated README keeps the <!-- cmpose:<flag> --> sections of the flags that are on; an older template's
// <!-- cmpose:ci --> section always goes (GameCI is not offered for games). Returns false when the project has no README.
async function applyGameReadme(projectDir, { flags }) {
    const file = path.join(projectDir, 'README.md');
    if (!(await fs.pathExists(file))) return false;
    const on = new Set(flags);
    const before = await fs.readFile(file, 'utf8');
    let text = before;
    for (const flag of GAME_SCHEMA.flags) if (!on.has(flag)) text = removeMarkedBlock(text, `cmpose:${flag}`);
    text = removeMarkedBlock(text, 'cmpose:ci');
    if (text !== before) await fs.writeFile(file, text);
    return true;
}

module.exports = { applyGameReadme };
