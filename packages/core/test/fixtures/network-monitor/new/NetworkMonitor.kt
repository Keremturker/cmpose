package com.kturker.multiplatform.core.network

import com.kturker.networkmonitor.MonitorLogging
import io.ktor.client.HttpClientConfig
import io.ktor.http.HttpHeaders

/**
 * Whether the network monitor may record calls. Android: always, because release APKs link
 * `networkmonitor-noop` (see androidApp/build.gradle.kts). iOS: debug binaries only.
 */
internal expect val isNetworkMonitorEnabled: Boolean

private val SENSITIVE_HEADERS = listOf(
    HttpHeaders.Authorization,
    HttpHeaders.Cookie,
    HttpHeaders.SetCookie,
    HttpHeaders.ProxyAuthorization
)

internal fun HttpClientConfig<*>.installNetworkMonitor() {
    if (!isNetworkMonitorEnabled) return
    install(MonitorLogging) {
        sanitizeHeader { header -> SENSITIVE_HEADERS.any { it.equals(header, ignoreCase = true) } }
    }
}
