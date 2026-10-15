package com.kturker.multiplatform.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.authProvider
import io.ktor.client.plugins.auth.providers.BearerAuthProvider
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.statement.request
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** Koin name of the backend's [HttpClient]; the unnamed one stays the public API's client (NetworkModule). */
const val BACKEND_CLIENT = "backend"

private const val TIME_OUT = 45_000L

/**
 * Builds the backend client: base URL, JSON, timeouts, logging, and the signed-in user's bearer token.
 * Provided under [BACKEND_CLIENT] (core:auth), so it never replaces the app's unnamed HttpClient.
 */
fun buildBackendClient(
    engine: HttpClientEngine,
    baseUrl: String,
    tokens: TokenSource,
    isDebug: Boolean
): HttpClient {
    val api = Url(baseUrl)

    // The token goes only to the backend (same host and port): this client also loads Coil's images from any host
    fun Url.isApi(): Boolean = host == api.host && port == api.port

    return HttpClient(engine) {
        expectSuccess = true

        defaultRequest {
            url(baseUrl)
        }

        install(HttpTimeout) {
            requestTimeoutMillis = TIME_OUT
        }

        install(ContentNegotiation) {
            json(
                Json {
                    ignoreUnknownKeys = true
                    isLenient = true
                    prettyPrint = true
                }
            )
        }

        // Every backend request carries the ID token; a 401 refreshes it once and retries, a second 401 surfaces.
        // Another host's 401 is a plain error: Auth would otherwise retry it with the token attached.
        install(Auth) {
            reAuthorizeOnResponse { response ->
                response.status == HttpStatusCode.Unauthorized && response.request.url.isApi()
            }
            bearer {
                loadTokens { tokens.token(forceRefresh = false)?.let { BearerTokens(it, null) } }
                refreshTokens { tokens.token(forceRefresh = true)?.let { BearerTokens(it, null) } }
                sendWithoutRequest { request -> request.url.build().isApi() }
            }
        }

        installRequestLogging(isDebug = isDebug)

        // Debug builds only, like the request log: the monitor records each call (Authorization header masked)
        if (isDebug) installNetworkMonitor()
    }
}

/** Drops the cached bearer token; call on sign-out and account deletion. */
fun HttpClient.forgetToken() {
    authProvider<BearerAuthProvider>()?.clearToken()
}
