# MetaIoid Android — building and releasing

## 1. Where the APK comes from

The APK is built by GitHub Actions, not by hand:
`.github/workflows/android.yml`.

| Trigger | Result |
| --- | --- |
| Any push touching `android/**` or the workflow | unit tests + lint + debug APK + release APK, uploaded as the `metaloid-apk` artifact |
| Push a tag `apk-*` | the same build, plus a GitHub Release carrying the APKs and `SHA256SUMS.txt` |
| Manual run with `publish` ticked | same as the tag, with an auto-numbered tag |

Artifact names are stable on purpose (`metaloid-debug.apk`,
`metaloid-release.apk`) so a download link does not change shape between builds.
Artifacts expire (90 days); a GitHub Release does not.

## 2. Installing

1. Download `metaloid-debug.apk` (or `metaloid-release.apk`) from the run's
   **Artifacts** section, or from the **Releases** page for a tagged build.
2. On the device, allow installing from this source when prompted.
3. Open the app. If the build has no gateway baked in, it asks for the address of
   your MetaIoid server (`https://…`), then for a sign-in.

Android 8.0 (API 26) or newer. The debug APK installs alongside the release APK
(application id suffix `.debug`).

## 3. Baked-in (public) values

The build accepts three **public** values, in this order: `-P` flag →
environment variable → `local.properties` → empty.

| Value | Flag / env | What it is |
| --- | --- | --- |
| Gateway URL | `metaloid.gatewayUrl` / `METALOID_GATEWAY_URL` | e.g. `https://metaloid.example.com` |
| Supabase URL | `metaloid.supabaseUrl` / `METALOID_SUPABASE_URL` | the project URL from the dashboard |
| Supabase anon key | `metaloid.supabaseAnonKey` / `METALOID_SUPABASE_ANON_KEY` | the **public** anon key |

All three are public by design; they ship in every web client too. Nothing else is
acceptable in `local.properties`, and the release checklist below exists to prove
it.

## 4. Signing

* **Debug** builds are signed with the standard debug keystore.
* **Release** builds are signed with a real keystore **if** these secrets exist in
  the repository: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them, the release build
  falls back to the debug key so that every build produces an *installable*
  artifact. This is deliberate and is stated in the release notes — a debug-key
  release must never be mistaken for a store-ready one.
* `local.properties` and any `*.jks` / `*.keystore` are gitignored; a keystore is
  never committed.

## 5. Release checklist (re-read before tagging)

1. Is `main` (or the branch you are releasing) green on the `android` workflow —
   tests, lint, and **both** APKs?
2. Does the APK contain no secret? The workflow's build has no secret to bake in,
   but verify anyway:
   ```bash
   unzip -p metaloid-release.apk classes.dex | strings | grep -iE 'service_role|sk-or-|sk-ant-|BEGIN PRIVATE KEY' || echo clean
   ```
   Also check `res/` and `assets/` for a stray `.env`, `.json` or `.pem`.
3. Does `BUILD_TYPE_NAME` in the diagnostics screen match the artifact
   (`release`/`debug`)?
4. Do the release notes state which key signed the APK?
5. Is the version code bumped in `android/app/build.gradle.kts`?

## 6. Versioning

`versionCode` is a monotonically increasing integer and `versionName` is
`MAJOR.MINOR.PATCH`. Android installs an update only when `versionCode`
increases; forgetting it is the classic "the fix did not arrive" bug.

## 7. The store, if it ever comes to that

Not in scope for V1. If it is picked up, the work is: a real keystore held
outside the repository, `isMinifyEnabled` verified against a device test pass
(R8 can break reflection in ways CI does not see), a Play listing with the data
safety form filled in honestly (this app stores one encrypted session on the
device and sends conversation text to the user's own gateway), and a privacy
policy that names what leaves the device and where it goes.
