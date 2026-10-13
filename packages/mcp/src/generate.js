'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const core = require('@cmpose/core');
const { DEFAULTS } = require('./describe');

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const NEXT_STEPS = [
    'Open the project folder in Android Studio (it writes local.properties with your Android SDK path).',
    'Run the Android app from Android Studio; for iOS open iosApp/iosApp.xcodeproj in Xcode.',
    'Read README.md for the modules, requirements and release checklist.'
];

async function targetProblem(target) {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) return null;
    if (!stat.isDirectory()) return `${target} already exists and is a file`;
    if ((await fs.readdir(target)).length > 0) return `${target} already exists and is not empty`;
    return null;
}

// Non-recursive: fails (ENOTEMPTY) if anything appeared at the target since it was checked.
async function removeEmptyDir(dir) {
    await fs.promises.rmdir(dir).catch((err) => { if (err.code !== 'ENOENT') throw err; });
}

// Validate → template cache → generate in a hidden sibling → rename into place.
// Never overwrites anything and never leaves half a project behind.
// A typo in a flag would otherwise just leave the feature out and still report success
function unknownFeaturesConfigKeys(featuresConfig) {
    if (!featuresConfig || typeof featuresConfig !== 'object' || Array.isArray(featuresConfig)) return [];
    return Object.keys(featuresConfig).filter((k) => !core.SCHEMA.featuresConfigKeys.includes(k));
}

// Agents often send numbers; the core takes the hosted generator's strings
function coerceVersions(options) {
    const out = { ...options };
    if (typeof out.minSdk === 'number') out.minSdk = String(out.minSdk);
    if (typeof out.iosVersion === 'number') {
        out.iosVersion = Number.isInteger(out.iosVersion) ? `${out.iosVersion}.0` : String(out.iosVersion);
    }
    return out;
}

async function runGenerate(args, { cacheDir, remoteUrl, onProgress = () => { }, generatorVersion = null } = {}) {
    const { outputDir, templateRef, ...rest } = args || {};
    const options = coerceVersions(rest);
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
        return fail('outputDir must be an absolute path (for example /path/to/projects).');
    }
    const unknown = unknownFeaturesConfigKeys(options.featuresConfig);
    if (unknown.length > 0) {
        return fail(`Unknown featuresConfig key(s): ${unknown.join(', ')}. ` +
            `Valid keys: ${core.SCHEMA.featuresConfigKeys.join(', ')}.`);
    }
    const checked = core.validate({ ...DEFAULTS, ...options });
    if (!checked.ok) return fail(checked.error);
    const value = checked.value;
    const target = path.join(outputDir, value.projectName);
    const problem = await targetProblem(target);
    if (problem) return fail(problem);

    const template = { repo: core.pins.cmp.repo, ref: templateRef || core.pins.cmp.ref, cacheDir };
    let cache;
    try {
        const cached = await core.templateCache.isCached(template);
        onProgress(cached ? 'Preparing the template' : 'Downloading the template (first run only)');
        cache = await core.templateCache.ensure({ ...template, remoteUrl });
    } catch (err) {
        if (err instanceof core.TemplateFetchError || err instanceof TypeError) return fail(err.message);
        throw err;
    }
    const versions = await core.readTemplateVersions(cache.dir);
    const sdkError = core.minSdkAboveTarget(value.minSdk, versions.targetSdk);
    if (sdkError) return fail(sdkError);

    await fs.ensureDir(outputDir);
    const work = path.join(outputDir, `.cmpose-${crypto.randomBytes(6).toString('hex')}`);
    try {
        onProgress('Generating the project');
        await fs.copy(cache.dir, work);
        const summary = await core.generateCmpProject(value, { projectDir: work, generatorVersion });
        const late = await targetProblem(target);
        if (late) throw new Error(late);
        await removeEmptyDir(target); // never recursive: a concurrent run's project stays intact
        await fs.rename(work, target);
        const warnings = [...summary.warnings];
        if (value.templateType === 'showcase' && options.featuresConfig !== undefined) {
            warnings.push('featuresConfig is ignored for showcase (it applies to blank only); the showcase template has its own fixed feature set');
        }
        const result = {
            projectDir: target,
            template: { repo: core.pins.cmp.repo, ref: cache.ref, commit: cache.commit },
            templateType: summary.templateType,
            features: summary.features,
            featuresConfig: value.templateType === 'blank' ? value.featuresConfig : null,
            warnings,
            nextSteps: NEXT_STEPS
        };
        const text = [
            `Generated ${value.projectName} at ${target}`,
            `Template: ${result.template.repo}@${result.template.ref} (${String(cache.commit).slice(0, 7)})`,
            ...warnings.map((w) => `Warning: ${w}`),
            'Next steps:', ...NEXT_STEPS.map((s) => `- ${s}`)
        ].join('\n');
        return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (err) {
        await fs.remove(work).catch(() => { });
        return fail(`Generation failed: ${err.message}`);
    }
}

module.exports = { runGenerate, removeEmptyDir, NEXT_STEPS };
