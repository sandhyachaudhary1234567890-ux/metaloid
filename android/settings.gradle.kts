// MetaIoid Android — Gradle settings.
//
// One application module with strict package boundaries. The decision (and the
// alternative that was rejected) is recorded in docs/android/DECISIONS.md: a
// single module keeps the build reproducible for anyone who clones the repo,
// which matters more for a client of this size than physical module edges.
//
// Repositories are pinned to google() + mavenCentral() only. No dynamic
// versions, no snapshots, no custom plugin portals.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MetaIoid"
include(":app")
