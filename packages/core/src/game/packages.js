const path = require('path');
const fs = require('fs-extra');

// A scope covers a package when it equals the package name or is a dotted prefix of it (UPM's rule)
function scopeInUse(scope, names) {
    return names.some((n) => n === scope || n.startsWith(`${scope}.`));
}

function removePackages(manifest, ids) {
    const out = JSON.parse(JSON.stringify(manifest));
    const drop = new Set(ids);
    out.dependencies = Object.fromEntries(Object.entries(out.dependencies || {}).filter(([name]) => !drop.has(name)));
    if (Array.isArray(out.scopedRegistries)) {
        const names = Object.keys(out.dependencies);
        out.scopedRegistries = out.scopedRegistries
            .map((r) => ({ ...r, scopes: (r.scopes || []).filter((s) => scopeInUse(s, names)) }))
            .filter((r) => r.scopes.length > 0);
        if (out.scopedRegistries.length === 0) delete out.scopedRegistries;
    }
    return out;
}

// Unity rebuilds packages-lock.json on the next open; a stale lock would pin removed packages
async function removePackagesInProject(projectPath, ids) {
    const manifestPath = path.join(projectPath, 'Packages', 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await fs.writeFile(manifestPath, `${JSON.stringify(removePackages(manifest, ids), null, 2)}\n`);
    await fs.remove(path.join(projectPath, 'Packages', 'packages-lock.json'));
}

module.exports = { removePackages, removePackagesInProject };
