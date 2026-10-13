package com.kturker.multiplatform.core.network

import kotlin.experimental.ExperimentalNativeApi
import kotlin.native.Platform

// Release frameworks still link the real monitor, so it must only be installed in debug binaries.
@OptIn(ExperimentalNativeApi::class)
internal actual val isNetworkMonitorEnabled: Boolean = Platform.isDebugBinary
