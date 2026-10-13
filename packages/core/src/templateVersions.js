'use strict';
const fs = require('fs-extra');
const path = require('path');

// A template cache's own records: the commit it was cloned at and the resolved ref
const COMMIT_FILE_NAME = '.template-commit';
const REF_FILE_NAME = '.template-ref';

function pick(re, text) {
    const m = text && text.match(re);
    return m ? m[1] : null;
}

// Parse the authoritative version files of a template directory: the template cache for the version
// listing, a project copy for its README. Compile/target SDK come from the template's AppConfig.kt.
async function readTemplateVersions(root) {
    const read = (relPath) => fs.readFile(path.join(root, relPath), 'utf8').catch(() => '');
    const toml = await read(path.join('gradle', 'libs.versions.toml'));
    const wrapper = await read(path.join('gradle', 'wrapper', 'gradle-wrapper.properties'));
    const appPlugin = await read(
        path.join('build-logic', 'src', 'main', 'kotlin', 'convention', 'ComposeMultiplatformAppConventionPlugin.kt')
    );
    const appConfig = await read(path.join('build-logic', 'src', 'main', 'kotlin', 'config', 'AppConfig.kt'));

    return {
        kotlin: pick(/^kotlin\s*=\s*"([^"]+)"/m, toml),
        agp: pick(/^agp\s*=\s*"([^"]+)"/m, toml),
        composeMultiplatform: pick(/^composeMultiplatform\s*=\s*"([^"]+)"/m, toml),
        gradle: pick(/gradle-([\d.]+)-bin\.zip/, wrapper),
        jdk: pick(/JavaVersion\.VERSION_(\d+)/, appPlugin),
        compileSdk: pick(/const val compileSdkVersion\s*=\s*(\d+)/, appConfig),
        targetSdk: pick(/const val targetSdkVersion\s*=\s*(\d+)/, appConfig),
        templateRef: (await read(REF_FILE_NAME)).trim() || null,
        templateCommit: (await read(COMMIT_FILE_NAME)).trim() || null
    };
}

module.exports = { readTemplateVersions, COMMIT_FILE_NAME, REF_FILE_NAME };
