package com.metaloid.core.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.metaloid.di.AppContainer

/**
 * Creates a feature ViewModel with the app's container, scoped to the composable
 * that asked for it.
 *
 * Every feature obtains its dependencies this way and nowhere else: a screen
 * never constructs a repository, and a ViewModel never looks anything up in a
 * global. The factory is rebuilt only when the container changes (never, in
 * practice), so a recomposition cannot mint a second ViewModel.
 */
@Composable
inline fun <reified VM : ViewModel> rememberFeatureViewModel(
    container: AppContainer,
    crossinline create: (AppContainer) -> VM,
): VM {
    val factory = androidx.compose.runtime.remember(container) {
        viewModelFactory { initializer { create(container) } }
    }
    return viewModel(factory = factory)
}
