package com.kturker.multiplatform.core.network.di

import com.kturker.multiplatform.core.network.getPlatformEngine
import com.kturker.multiplatform.core.network.installNetworkMonitor
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import org.koin.core.annotation.ComponentScan
import org.koin.core.annotation.Module
import org.koin.core.annotation.Single

private const val TIME_OUT = 45_000L

@Module
@ComponentScan("com.kturker.multiplatform.core.network")
class NetworkModule {

    @Single
    fun providePlatformEngine(): HttpClientEngine = getPlatformEngine()

    @Single
    fun provideHttpClient(engine: HttpClientEngine): HttpClient = HttpClient(engine) {
        expectSuccess = true

        defaultRequest {
            url("https://api.github.com/")
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

        installNetworkMonitor()
    }
}
