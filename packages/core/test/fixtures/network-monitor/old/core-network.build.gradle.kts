plugins {
    alias(libs.plugins.kmp.library.plugin)
}

kotlin {
    sourceSets {
        commonMain {
            dependencies {
                implementation(projects.core.domain)
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.content.negotiation)
                implementation(libs.ktor.serialization.kotlinx.json)
                implementation(libs.androidx.lifecycle.viewmodelCompose)


                // Add this only to the debug buildType/flavor
                implementation(libs.networkMonitor.debug)
                // Add this to the release buildType/flavor so the no-op implementation is used
                //implementation(libs.networkMonitor.release)
            }
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.android)

        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
    }
}