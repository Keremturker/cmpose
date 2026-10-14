'use strict';
const path = require('path');
const fs = require('fs-extra');
const { OLD_PACKAGE_NAME, OLD_PROJECT_NAME } = require('../../src/templateIdentity');

const OLD_PACKAGE_PATH = OLD_PACKAGE_NAME.replace(/\./g, '/');

/**
 * Seeds a tiny but realistic slice of the template under `dir`: one Gradle module holding
 * code in the template package, the iOS project/config files the pipeline rewrites, and the
 * cache/IDE leftovers that must never reach the generated project.
 */
async function seedTemplate(dir, { commit = 'f'.repeat(40), ref = 'refs/tags/template-test' } = {}) {
    const files = {
        '.template-commit': `${commit}\n`,
        '.template-ref': `${ref}\n`,
        'local.properties': 'sdk.dir=/home/dev/Android/sdk\n',
        '.idea/workspace.xml': '<project version="4" />\n',
        'Multiplatform.iml': '<module type="JAVA_MODULE" version="4" />\n',
        'LICENSE': 'MIT License\n\nCopyright (c) 2026 cmpose contributors\n',
        'settings.gradle.kts': `rootProject.name = "${OLD_PROJECT_NAME}"\ninclude(":composeApp")\n`,
        'build.gradle.kts': 'plugins { }\n',
        'gradle/libs.versions.toml': '[versions]\nandroid-minSdk = "24"\n',
        'composeApp/build.gradle.kts': `android {\n    namespace = "${OLD_PACKAGE_NAME}"\n    defaultConfig { minSdk = 24 }\n}\n`,
        [`composeApp/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/App.kt`]:
            `package ${OLD_PACKAGE_NAME}\n\nfun app() = Unit\n`,
        'composeApp/src/main/res/values/strings.xml':
            '<resources>\n    <string name="app_name">Multiplatform</string>\n</resources>\n',
        // blank's shell overlay (the real template has MainScreen.kt + GuideScreen.kt here)
        [`blank/shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/MainScreen.kt`]:
            `package ${OLD_PACKAGE_NAME}\n\nfun mainScreen() = Unit\n`,
        // the shell's layers (the real template: AppTheme.kt for Theming off; MainScreen.kt and
        // string resources for Multi-Language)
        [`blank/layers/theming-off/shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/AppTheme.kt`]:
            `package ${OLD_PACKAGE_NAME}\n\nfun appTheme() = Unit\n`,
        [`blank/layers/multilang/shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/MainScreen.kt`]:
            `package ${OLD_PACKAGE_NAME}\n\nfun mainScreen() = Unit\n`,
        // Key files the verifier requires (the hosted generator's tests add them after the seed),
        // under the old package path so the package move relocates them like the real pipeline
        'androidApp/build.gradle.kts': 'plugins { }\n',
        'shared/build.gradle.kts': 'plugins { }\n',
        [`shared/src/commonMain/kotlin/${OLD_PACKAGE_PATH}/MainScreen.kt`]: `package ${OLD_PACKAGE_NAME}\n`,
        'iosApp/iosApp.xcodeproj/project.pbxproj':
            `PRODUCT_BUNDLE_IDENTIFIER = ${OLD_PACKAGE_NAME};\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\n`,
        'iosApp/Configuration/Config.xcconfig':
            `PRODUCT_BUNDLE_IDENTIFIER=${OLD_PACKAGE_NAME}\nPRODUCT_NAME=Multiplatform\nIPHONEOS_DEPLOYMENT_TARGET=15.0\n`
    };
    for (const [rel, content] of Object.entries(files)) {
        await fs.outputFile(path.join(dir, rel), content);
    }
}

module.exports = { seedTemplate, OLD_PACKAGE_PATH };
