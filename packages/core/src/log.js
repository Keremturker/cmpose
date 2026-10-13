'use strict';
// The core never writes to stdout by itself: the MCP server speaks JSON-RPC on stdout.
// The backend sets console; the MCP server sets a stderr logger.
const SILENT = { info() { }, warn() { }, error() { } };
let sink = SILENT;

function setLogger(logger) {
    sink = logger || SILENT;
}

const log = {
    info: (...args) => sink.info(...args),
    warn: (...args) => sink.warn(...args),
    error: (...args) => sink.error(...args)
};

module.exports = { log, setLogger };
