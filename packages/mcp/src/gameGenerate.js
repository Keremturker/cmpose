'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const core = require('@cmpose/core');
const { removeEmptyDir, targetProblem } = require('./generate');

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const NEXT_STEPS_GAME = [
    'Open the folder in Unity Hub with editor 6000.3.25f1 (Android and iOS Build Support modules).',
    'Press Play in the Boot scene, or build with File > Build Profiles.',
    'Read README.md for signing, IDs and the release checklist.'
];

// Validate → template cache → generate in a hidden sibling → rename into place.
// Never overwrites anything and never leaves half a project behind.
async function runGameGenerate(args, { cacheDir, remoteUrl, onProgress = () => { }, now } = {}) {
    const { outputDir, templateRef, ...rest } = args || {};
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
        return fail('outputDir must be an absolute path (for example /path/to/projects).');
    }
    const checked = core.game.validateGame(rest);
    if (!checked.ok) return fail(checked.error);
    const value = checked.value;
    const target = path.join(outputDir, value.projectName);
    const problem = await targetProblem(target);
    if (problem) return fail(problem);

    const template = { repo: core.pins.game.repo, ref: templateRef || core.pins.game.ref, cacheDir };
    let cache;
    try {
        const cached = await core.templateCache.isCached(template);
        onProgress(cached ? 'Preparing the template' : 'Downloading the template (first run only)');
        cache = await core.templateCache.ensure({ ...template, remoteUrl });
    } catch (err) {
        if (err instanceof core.TemplateFetchError || err instanceof TypeError) return fail(err.message);
        throw err;
    }

    await fs.ensureDir(outputDir);
    const work = path.join(outputDir, `.cmpose-${crypto.randomBytes(6).toString('hex')}`);
    try {
        onProgress('Generating the project');
        await fs.copy(cache.dir, work);
        const source = { repo: core.pins.game.repo, ref: cache.ref, commit: cache.commit };
        const summary = await core.game.generateGame(value, {
            projectDir: work, template: source, coreVersion: core.version, ...(now ? { now } : {})
        });
        const late = await targetProblem(target);
        if (late) throw new Error(late);
        await removeEmptyDir(target); // never recursive: a concurrent run's project stays intact
        await fs.rename(work, target);
        const result = {
            projectDir: target,
            template: source,
            templateType: summary.templateType,
            render: summary.render,
            flags: summary.flags,
            features: summary.features,
            warnings: summary.warnings,
            nextSteps: NEXT_STEPS_GAME
        };
        const text = [
            `Generated ${value.projectName} at ${target}`,
            `Template: ${source.repo}@${source.ref} (${String(source.commit).slice(0, 7)})`,
            ...result.warnings.map((w) => `Warning: ${w}`),
            'Next steps:', ...NEXT_STEPS_GAME.map((s) => `- ${s}`)
        ].join('\n');
        return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (err) {
        await fs.remove(work).catch(() => { });
        return fail(`Generation failed: ${err.message}`);
    }
}

module.exports = { runGameGenerate, NEXT_STEPS_GAME };
