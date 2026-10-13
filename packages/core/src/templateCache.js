'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { COMMIT_FILE_NAME, REF_FILE_NAME } = require('./templateVersions');

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_TMP_MS = 60 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9_.-]+$/;

class TemplateFetchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TemplateFetchError';
    }
}

function defaultCacheDir(env = process.env) {
    if (env.CMPOSE_CACHE_DIR) return env.CMPOSE_CACHE_DIR;
    return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cmpose');
}

async function readCommit(dir) {
    return fs.readFile(path.join(dir, COMMIT_FILE_NAME), 'utf8').then((v) => v.trim() || null, () => null);
}

// Interrupted clones leave .tmp-* directories; drop the old ones
async function removeStaleTemps(parent) {
    const entries = await fs.readdir(parent).catch(() => []);
    for (const name of entries.filter((n) => n.startsWith('.tmp-'))) {
        const full = path.join(parent, name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > STALE_TMP_MS) await fs.remove(full).catch(() => { });
    }
}

function validateTarget(repo, ref) {
    if (!REPO_RE.test(repo || '') || repo.split('/').some((p) => p === '.' || p === '..')) throw new TypeError(`invalid template repo: ${repo}`);
    if (!REF_RE.test(ref || '') || ref.startsWith('.')) throw new TypeError(`invalid template ref: ${ref}`);
}

function templateDir(cacheDir, repo, ref) {
    return path.join(cacheDir, 'templates', repo.replace('/', '__'), ref);
}

// True when ensure() will serve this tag from disk without cloning
async function isCached({ repo, ref, cacheDir = defaultCacheDir() } = {}) {
    validateTarget(repo, ref);
    return Boolean(await readCommit(templateDir(cacheDir, repo, ref)));
}

// A template tag is immutable: clone it once (shallow, no credentials), then serve it from disk.
// The clone lands in a temporary sibling and is renamed into place, so readers never see half a template.
async function ensure({ repo, ref, cacheDir = defaultCacheDir(), remoteUrl } = {}) {
    validateTarget(repo, ref);

    const dir = templateDir(cacheDir, repo, ref);
    const parent = path.dirname(dir);
    const cached = await readCommit(dir);
    if (cached) return { dir, ref, commit: cached };

    await fs.ensureDir(parent);
    await removeStaleTemps(parent);
    const tmp = path.join(parent, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
    const url = remoteUrl || `https://github.com/${repo}.git`;
    try {
        // An empty credential.helper: no credential manager can pop up a prompt (public repo)
        await run('git', ['-c', 'credential.helper=', 'clone', '--quiet', '--depth', '1', '--branch', ref, url, tmp], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            timeout: CLONE_TIMEOUT_MS
        });
        const { stdout } = await run('git', ['-C', tmp, 'rev-parse', 'HEAD']);
        await fs.remove(path.join(tmp, '.git'));
        await fs.writeFile(path.join(tmp, COMMIT_FILE_NAME), `${stdout.trim()}\n`);
        await fs.writeFile(path.join(tmp, REF_FILE_NAME), `refs/tags/${ref}\n`);
        if (await fs.pathExists(dir) && !(await readCommit(dir))) await fs.remove(dir); // broken cache
        try {
            await fs.rename(tmp, dir);
        } catch (err) {
            if (!(await readCommit(dir))) throw err; // lost the race to a complete clone: use it
            await fs.remove(tmp);
        }
        return { dir, ref, commit: await readCommit(dir) };
    } catch (err) {
        await fs.remove(tmp).catch(() => { });
        const reason = err.code === 'ENOENT'
            ? 'git is not installed or not on PATH'
            : String(err.stderr || err.message).trim().split('\n').pop();
        throw new TemplateFetchError(
            `Could not download the template ${repo}@${ref}: ${reason}. Check that git is installed and the network is reachable.`
        );
    }
}

module.exports = { ensure, isCached, defaultCacheDir, TemplateFetchError };
