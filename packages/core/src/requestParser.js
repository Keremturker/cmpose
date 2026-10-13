/**
 * Shape (type) check of a generation request body (POST /api/generate).
 * Pure function: no HTTP or file system, does not mutate its input.
 * Content rules (regexes, ranges) stay in ProjectValidator; this only
 * guarantees the types so the validators can be called safely.
 */

const REQUIRED_STRING_FIELDS = ['projectName', 'appName', 'packageName', 'minSdk', 'iosVersion'];
const TEMPLATE_TYPES = ['showcase', 'blank'];
const DEFAULT_TEMPLATE_TYPE = 'showcase';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * @param {*} body - req.body
 * @returns {{ ok: true, value: Object } | { ok: false, error: string }}
 */
function parseGenerateBody(body) {
    if (!isPlainObject(body)) {
        return { ok: false, error: 'Request body must be a JSON object' };
    }

    for (const field of REQUIRED_STRING_FIELDS) {
        if (typeof body[field] !== 'string') {
            return { ok: false, error: `${field} is required and must be a string` };
        }
    }

    let features = [];
    if (body.features !== undefined) {
        if (!Array.isArray(body.features) || !body.features.every(f => typeof f === 'string')) {
            return { ok: false, error: 'features must be an array of strings' };
        }
        features = body.features;
    }

    let featuresConfig;
    if (body.featuresConfig !== undefined) {
        if (!isPlainObject(body.featuresConfig)) {
            return { ok: false, error: 'featuresConfig must be an object' };
        }
        featuresConfig = body.featuresConfig;
    }

    let templateType = DEFAULT_TEMPLATE_TYPE;
    if (body.templateType !== undefined) {
        if (!TEMPLATE_TYPES.includes(body.templateType)) {
            return { ok: false, error: `templateType must be one of: ${TEMPLATE_TYPES.join(', ')}` };
        }
        templateType = body.templateType;
    }

    let ci = false;
    if (body.ci !== undefined) {
        if (typeof body.ci !== 'boolean') {
            return { ok: false, error: 'ci must be a boolean' };
        }
        ci = body.ci;
    }

    return {
        ok: true,
        value: {
            projectName: body.projectName,
            appName: body.appName,
            packageName: body.packageName,
            minSdk: body.minSdk,
            iosVersion: body.iosVersion,
            features,
            featuresConfig,
            templateType,
            ci
        }
    };
}

module.exports = { parseGenerateBody, TEMPLATE_TYPES };
