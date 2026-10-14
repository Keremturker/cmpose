'use strict';
// prepublishOnly: refuses to publish while a template pin is still a placeholder (…PENDING)
function pendingPins(pins) {
    return Object.entries(pins).filter(([, pin]) => /PENDING/.test(pin.ref)).map(([name, pin]) => `${name}: ${pin.ref}`);
}

if (require.main === module) {
    const pending = pendingPins(require('../src/pins'));
    if (pending.length) {
        process.stderr.write(`refusing to publish: placeholder template pin(s) in src/pins.js: ${pending.join(', ')}\n`);
        process.exit(1);
    }
}

module.exports = { pendingPins };
