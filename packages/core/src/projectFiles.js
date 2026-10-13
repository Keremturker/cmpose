const fs = require('fs-extra');
const path = require('path');

// File types scanned as text in a generated project (binary files are not read)
const TEXT_FILE_EXTENSIONS = new Set(['.kt', '.kts', '.toml', '.xml', '.swift', '.plist', '.xcconfig', '.pbxproj', '.properties', '.yml', '.md', '.json', '.xcprivacy']);

// Node 16-compatible recursive listing (fs.readdir's recursive option needs Node 18.17+)
async function listTextFiles(dir) {
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listTextFiles(full));
        } else if (TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(full);
        }
    }
    return files;
}

module.exports = { TEXT_FILE_EXTENSIONS, listTextFiles };
