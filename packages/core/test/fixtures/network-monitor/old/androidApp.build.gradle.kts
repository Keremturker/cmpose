plugins {
    alias(libs.plugins.multiplatform.application.plugin)
}

dependencies {
    implementation(projects.shared)
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
}
