package com.kturker.multiplatform

import androidx.compose.runtime.Composable
import com.kturker.multiplatform.core.auth.CurrentActivity
import com.kturker.multiplatform.core.navigation.NavigationCommand
import com.kturker.multiplatform.core.navigation.NavigationManager
import com.kturker.multiplatform.feature.account.presentation.di.AccountModule
import com.kturker.multiplatform.feature.onboarding.contract.OnboardingDestination
import com.kturker.multiplatform.feature.sharing.presentation.di.SharingModule
import org.koin.compose.koinInject

@Composable
fun MainScreen(navigationManager: NavigationManager = koinInject()) {
    val providers = remember(koin) { koin.getAll<NavGraphProvider>() }

    // cmpose:backend
    // The sign-in gate (SessionGate.kt): nothing until the restored session is known
    CurrentActivity.touch()
    listOf(AccountModule(), SharingModule())
    // /cmpose:backend
    // cmpose:backend-off: val start: NavigationCommand.Destination = OnboardingDestination
    val start: NavigationCommand.Destination = rememberSessionStart(OnboardingDestination, navigationManager) ?: return

    AppTheme {
        NavHost(startDestination = start)
    }
}
