# MetaIoid Android — building and releasing

## 0. Published build status

| | |
| --- | --- |
| Latest published release | [`apk-v3`](https://github.com/sandhyachaudhary1234567890-ux/metaloid/releases/tag/apk-v3) |
| APKs | [`metaloid-debug.apk`](https://github.com/sandhyachaudhary1234567890-ux/metaloid/releases/download/apk-v3/metaloid-debug.apk) · [`metaloid-release.apk`](https://github.com/sandhyachaudhary1234567890-ux/metaloid/releases/download/apk-v3/metaloid-release.apk) |
| Checksums | [`SHA256SUMS.txt`](https://github.com/sandhyachaudhary1234567890-ux/metaloid/releases/download/apk-v3/SHA256SUMS.txt) |
| V4 status | **Not published.** [Run 37211404025](https://github.com/sandhyachaudhary1234567890-ux/metaloid/actions/runs/37211404025) passed unit tests, lint, and the debug APK build, but failed the API 34 emulator startup test. Release build, APK secret scan, and APK artifact upload were skipped. Do not treat V4 as a verified installable release. |
| Next Android version | `versionCode = 3`, `versionName = 1.0.2` (greater than V3's `2` / `1.0.1`). An in-place update also requires the signing certificate to match V3; that continuity is not yet verified. |

The debug APK is easier to diagnose because it is not minified. The release APK
is not signed with a Play Store release keystore unless the repository secrets
below are configured; the build workflow intentionally falls back to the debug
signing key otherwise. A higher `versionCode` alone does not make an APK
installable over V3: Android also requires the same signing certificate. V3/V4
signing continuity has not been verified, so do not promise an in-place update
until the certificate fingerprints are compared. Neither the old V3 APK nor
any future APK should be called device-verified unless it has actually been
installed and exercised on a device.

## 1. Where the APK comes from

The APK is built by GitHub Actions, not by hand:
`.github/workflows/android.yml`.

| Trigger | Result |
| --- | --- |
| Any push touching `android/**`, `docs/android/**`, or the workflow | On a successful run: unit tests + lint + emulator smoke test + debug/release APKs + secret scan, uploaded as the `metaloid-apk` artifact |
| Push a tag `apk-*` | the same successful build, plus a GitHub Release carrying the APKs and `SHA256SUMS.txt` |
| Manual run with `publish` ticked | same as the tag, with an auto-numbered tag |

Artifacts expire (90 days); a GitHub Release does not. Do not tag `apk-v4` until
the branch's Android unit tests, lint, API 34 emulator smoke test, both APK
builds, and APK secret scan pass.

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
| Gateway URL | `metaloid.gatewayUrl` / `METALOID_GATEWAY_URL` | e.g. `https://metaloid.example.com`. **The release workflow sets this** to the project's own deployment (`https://metaloid.vercel.app`) unless the repository variable `METALOID_GATEWAY_URL` overrides it, so an installed APK connects straight to the backend and only asks for a sign-in. |
| Supabase URL | `metaloid.supabaseUrl` / `METALOID_SUPABASE_URL` | the project URL from the dashboard |
| Supabase anon key | `metaloid.supabaseAnonKey` / `METALOID_SUPABASE_ANON_KEY` | the **public** anon key |

All three are public by design; they ship in every web client too. Nothing else is
acceptable in `local.properties`, and the release checklist below exists to prove
it.

The Supabase pair may also be left empty on purpose: the app reads them at runtime
from `GET /api/config`, which is how an APK built with no Supabase values still
offers email sign-in against a Supabase-backed gateway (see DECISIONS.md D24).

## 4. Signing

* **Debug** builds are signed with the standard debug keystore.
* **Release** builds are signed with a real keystore **if** these secrets exist in
the repository: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them, the release build
falls back to the debug key so that every build produces an *installable*
artifact. This is deliberate, and a debug-key release must never be mistaken
for a Play Store-ready one.
* `local.properties` and any `*.jks` / `*.keystore` are gitignored; a keystore is
  never committed.

## 4b. R8 rules that must name real classes

`proguard-rules.pro` keeps the manifest's entry points explicitly. They live in
`com.metaloid` (`MetaIoidApplication`, `MainActivity`,
`feature.share.ShareReceiverActivity`), **not** in the namespace
`com.metaloid.app` that the `R` class and `BuildConfig` come from — a rule that
names the wrong package protects nothing, and the symptom would be a release APK
that starts and immediately dies with `ClassNotFoundException` while the debug
build works. AGP also feeds the manifest to R8; the explicit rules are there so
the file does not depend on that.

## 5. Release checklist (re-read before tagging)

1. Is the exact source revision green on the `android` workflow — unit tests,
   lint, the API 34 emulator startup smoke test, and **both** APK builds?
2. Does the **Secret scan of the APKs** pass on both APKs? It scans every `*.dex`
   and `resources.arsc` for service-role keys, provider keys, JWT secrets and
   private-key patterns. To re-run by hand:
   ```bash
   unzip -p metaloid-release.apk '*.dex' resources.arsc | strings -n 8 \
     | grep -iE 'service_role|sk-or-v1|sk-ant-|sk-proj-|BEGIN [A-Z ]*PRIVATE KEY|jwt_secret|encryption_key' || echo clean
   ```
   Also check `res/` and `assets/` for a stray `.env`, `.json` or `.pem`.
3. Does `BUILD_TYPE_NAME` in the diagnostics screen match the artifact
   (`release`/`debug`)?
4. Is the server change deployed before advertising Android provider setup and
   model selection? The V4 APK depends on the backend catalog fields and message
   PATCH extension documented in `BACKEND_CHANGES.md`.
5. Has the exact APK been installed and exercised on a supported device? If not,
   state plainly that device behavior remains unverified.
6. Does the APK signing-certificate fingerprint match V3? A `versionCode` bump is
   not sufficient for an in-place update. Use the same persistent release
   keystore, or clearly state that users must uninstall V3 first (with the
   associated local-data loss).
7. Create the `apk-v4` release only after the above gates pass, attach the two
   APKs and `SHA256SUMS.txt`, and verify the release page actually serves them.
