const { escapeRe } = require('./unityYaml');

// C# blocks a flag owns: '// cmpose:<name>' … '// /cmpose:<name>' on their own lines (any indent).
// README blocks use ../readmeService's removeMarkedBlock instead.
function markerRes(name) {
    const n = escapeRe(name);
    return {
        open: new RegExp(`^[ \\t]*// cmpose:${n}[ \\t]*\\r?$`),
        close: new RegExp(`^[ \\t]*// /cmpose:${n}[ \\t]*\\r?$`)
    };
}

function removeLineMarkedBlock(text, name) {
    const { open, close } = markerRes(name);
    const out = [];
    let inside = false;
    for (const line of text.split('\n')) {
        if (!inside && open.test(line)) { inside = true; continue; }
        if (inside) { if (close.test(line)) inside = false; continue; }
        if (close.test(line)) throw new Error(`cmpose:${name}: closing marker without an opening one`);
        out.push(line);
    }
    if (inside) throw new Error(`cmpose:${name}: opening marker without a closing one`);
    return out.join('\n');
}

function stripLineMarkers(text, name) {
    const { open, close } = markerRes(name);
    return text.split('\n').filter((line) => !open.test(line) && !close.test(line)).join('\n');
}

module.exports = { removeLineMarkedBlock, stripLineMarkers };
