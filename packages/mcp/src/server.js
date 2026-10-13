#!/usr/bin/env node
'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const core = require('@cmpose/core');
const pkg = require('../package.json');
const { describe } = require('./describe');
const { runGenerate } = require('./generate');

const GENERATE_DESCRIPTION = 'Generate a Compose Multiplatform (Android + iOS) project on this machine. ' +
    'Call cmp_describe first for the options, defaults and validation rules. ' +
    'Writes <outputDir>/<projectName>; never overwrites an existing non-empty folder.';

function createServer({ cacheDir, remoteUrl } = {}) {
    const server = new McpServer({ name: 'cmpose', version: pkg.version });

    server.registerTool('cmp_describe', {
        description: 'Describe the cmpose generator: template types, featuresConfig flags and defaults, dependency rules, validation limits and the pinned template.',
        inputSchema: {}
    }, async () => {
        const facts = describe();
        return { content: [{ type: 'text', text: JSON.stringify(facts, null, 2) }], structuredContent: facts };
    });

    server.registerTool('cmp_generate', {
        description: GENERATE_DESCRIPTION,
        inputSchema: {
            projectName: z.string().describe('Letters only, no spaces (e.g. MyApp)'),
            appName: z.string().describe('Display name (e.g. My App)'),
            packageName: z.string().describe('Reverse-domain package (e.g. com.example.myapp)'),
            outputDir: z.string().describe('Absolute path of the folder to create the project in'),
            templateType: z.enum(['showcase', 'blank']).optional(),
            features: z.array(z.string()).optional().describe('Extra feature modules (lower case names)'),
            featuresConfig: z.record(z.string(), z.any()).optional()
                .describe('blank only: flags from cmp_describe (unknown keys are refused; ignored for showcase)'),
            minSdk: z.union([z.string(), z.number()]).optional().describe('Android min SDK, e.g. "24" or 24'),
            iosVersion: z.union([z.string(), z.number()]).optional().describe('iOS deployment target, e.g. "15.0"'),
            ci: z.boolean().optional(),
            templateRef: z.string().optional().describe('Override the pinned template tag')
        }
    }, async (args, extra) => {
        const progressToken = extra && extra._meta && extra._meta.progressToken;
        let step = 0;
        const onProgress = (message) => {
            if (progressToken === undefined) return;
            step += 1;
            extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: step, total: 2, message }
            }).catch(() => { });
        };
        return runGenerate(args, { cacheDir, remoteUrl, onProgress, generatorVersion: `mcp@${pkg.version}` });
    });

    return server;
}

async function main() {
    // stdout carries JSON-RPC: every log line goes to stderr
    const toStderr = (...args) => console.error(...args);
    core.setLogger({ info: toStderr, warn: toStderr, error: toStderr });
    await createServer().connect(new StdioServerTransport());
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { createServer };
