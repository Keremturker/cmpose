// Removes one Swift package from an Xcode project.pbxproj by its repository URL: the
// XCRemoteSwiftPackageReference, the XCSwiftPackageProductDependency objects that point at it,
// the PBXBuildFile objects that link those products, and every list entry naming one of those
// IDs. Sections left empty are dropped. Anything it does not recognise is left untouched, but a
// package it finds by URL and cannot take out is an error, never a silently unchanged project.

const OBJECT_START = /^\t\t([0-9A-F]{24})(?: \/\*.*?\*\/)? = \{/;
const OBJECT_END = '\t\t};';

// github.com/a/b, github.com/a/b.git and github.com/a/b/ name the same repository
function normalizeRepositoryUrl(url) {
    return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

// The objects of the file, line based: { id, start, end, text } (end inclusive). A one-line
// object (`\t\tID /* … */ = {isa = PBXBuildFile; …; };`) has start === end.
function parseObjects(lines) {
    const objects = [];
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(OBJECT_START);
        if (!match) continue;
        if (lines[i].endsWith('};')) {
            objects.push({ id: match[1], start: i, end: i, text: lines[i] });
            continue;
        }
        let end = i + 1;
        while (end < lines.length && lines[end] !== OBJECT_END) end++;
        if (end >= lines.length) break;
        objects.push({ id: match[1], start: i, end, text: lines.slice(i, end + 1).join('\n') });
        i = end;
    }
    return objects;
}

function isa(object) {
    const match = object.text.match(/\bisa = (\w+);/);
    return match ? match[1] : null;
}

// Every repositoryURL value in the file, wherever and however it is indented
function repositoryUrls(content) {
    return [...content.matchAll(/\brepositoryURL = "?([^";\n]+)"?;/g)].map((match) => normalizeRepositoryUrl(match[1]));
}

// The parser is LF based: a project with any CRLF line is parsed as LF and written back with CRLF
// on every line (a mixed-ending file comes back all CRLF; Xcode itself writes LF)
function removeSwiftPackage(content, repositoryUrl) {
    const crlf = content.includes('\r\n');
    const result = removeSwiftPackageLf(crlf ? content.replace(/\r\n/g, '\n') : content, repositoryUrl);
    if (repositoryUrls(result).includes(normalizeRepositoryUrl(repositoryUrl))) {
        throw new Error(`removeSwiftPackage: ${repositoryUrl} is in project.pbxproj but its objects could not be parsed (unexpected formatting)`);
    }
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

function removeSwiftPackageLf(content, repositoryUrl) {
    const wanted = normalizeRepositoryUrl(repositoryUrl);
    const lines = content.split('\n');
    const objects = parseObjects(lines);

    // 1. The package reference(s) with this URL
    const references = new Set(objects
        .filter((object) => isa(object) === 'XCRemoteSwiftPackageReference')
        .filter((object) => {
            const url = object.text.match(/\brepositoryURL = "?([^";\n]+)"?;/);
            return url && normalizeRepositoryUrl(url[1]) === wanted;
        })
        .map((object) => object.id));
    if (references.size === 0) return content;

    // 2. The products of that package
    const products = new Set(objects
        .filter((object) => isa(object) === 'XCSwiftPackageProductDependency')
        .filter((object) => {
            const pkg = object.text.match(/\bpackage = ([0-9A-F]{24})\b/);
            return pkg && references.has(pkg[1]);
        })
        .map((object) => object.id));

    // 3. The build files linking those products
    const buildFiles = new Set(objects
        .filter((object) => isa(object) === 'PBXBuildFile')
        .filter((object) => {
            const ref = object.text.match(/\bproductRef = ([0-9A-F]{24})\b/);
            return ref && products.has(ref[1]);
        })
        .map((object) => object.id));

    const removed = new Set([...references, ...products, ...buildFiles]);

    // 4. Their objects
    const drop = new Set();
    for (const object of objects) {
        if (!removed.has(object.id)) continue;
        for (let i = object.start; i <= object.end; i++) drop.add(i);
    }

    // 5. List entries naming them (`\t\t\t\tID /* … */,`)
    const listEntry = /^\t+([0-9A-F]{24})(?: \/\*.*?\*\/)?,$/;
    lines.forEach((line, i) => {
        const match = line.match(listEntry);
        if (match && removed.has(match[1])) drop.add(i);
    });

    let result = lines.filter((_, i) => !drop.has(i)).join('\n');

    // 6. Sections left empty, with the blank line that separated them
    result = result.replace(/\n\n\/\* Begin (\w+) section \*\/\n\/\* End \1 section \*\/(?=\n)/g, '');

    // 7. The project's packageReferences list, when it is now empty. A target's empty
    // packageProductDependencies list stays: Xcode writes it for every target.
    result = result.replace(/\n\t\t\tpackageReferences = \(\n\t\t\t\);(?=\n)/g, '');

    return result;
}

module.exports = { removeSwiftPackage };
