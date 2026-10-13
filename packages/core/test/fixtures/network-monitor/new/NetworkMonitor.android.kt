package com.kturker.multiplatform.core.network

// Release APKs link networkmonitor-noop (see androidApp/build.gradle.kts), so installing is always safe.
internal actual val isNetworkMonitorEnabled: Boolean = true
