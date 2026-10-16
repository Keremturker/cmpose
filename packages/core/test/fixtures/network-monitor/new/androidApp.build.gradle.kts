plugins {
    alias(libs.plugins.multiplatform.application.plugin)
}

dependencies {
    implementation(projects.shared)
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
}

// Network monitor: release builds get the no-op artifact, so the real monitor
// (its manifest, call database and notifications) ships only in debug builds.
// The cmpose generator deletes this whole block (first comment line through the closing brace).
configurations.matching { it.isCanBeResolved && (it.name.startsWith("release") || it.name.contains("Release")) }.configureEach {
    resolutionStrategy.dependencySubstitution {
        substitute(module("com.kturker:networkmonitor"))
            .using(module("com.kturker:networkmonitor-noop:${libs.versions.networkMonitor.get()}"))
    }
}
