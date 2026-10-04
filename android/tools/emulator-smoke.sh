#!/usr/bin/env bash
# Invoked as one command by reactivecircus/android-emulator-runner.
# That action runs each script input line in a fresh /usr/bin/sh process, so
# keep Bash syntax in this file and call it with `bash tools/emulator-smoke.sh`.
set -euo pipefail

log_file="${RUNNER_TEMP:-/tmp}/ci-emulator.log"
printf 'Emulator Gradle working directory: %s\n' "$PWD"

set +e
gradle --no-daemon --stacktrace :app:connectedDebugAndroidTest 2>&1 | tee "$log_file"
result=$?
set -e

if [ "$result" -ne 0 ]; then
  {
    echo
    echo '--- foreground activity/window ---'
    adb shell dumpsys activity activities 2>/dev/null \
      | grep -E 'mResumedActivity|topResumedActivity' | tail -6 || true
    adb shell dumpsys window 2>/dev/null \
      | grep -E 'mCurrentFocus|mFocusedApp|mFocusedWindow' | tail -6 || true
    screenshot_file="${RUNNER_TEMP:-/tmp}/ci-emulator-failure.png"
    adb pull /sdcard/Android/data/com.metaloid.app.debug.test/files/metaloid-smoke-failure.png \
      "$screenshot_file" >/dev/null 2>&1 || true
    if [ -s "$screenshot_file" ]; then
      echo "Failure screenshot captured ($screenshot_file, $(du -h "$screenshot_file" | cut -f1))."
    else
      rm -f "$screenshot_file"
      echo 'Failure screenshot was not available.'
    fi
    echo
    echo '--- recent app/emulator logcat ---'
    app_pid=$(adb shell pidof -s com.metaloid.app.debug 2>/dev/null | tr -d '\r' || true)
    if [ -n "$app_pid" ]; then
      adb logcat -d -v time --pid="$app_pid" 2>/dev/null | tail -160 || true
    else
      adb logcat -d -v time -t 1200 2>/dev/null \
        | grep -E 'AndroidRuntime|FATAL EXCEPTION|System.err|com\.metaloid|metaloid|MetaIoid' \
        | tail -120 || true
    fi
    echo
    echo '--- visible emulator window hierarchy ---'
    adb shell uiautomator dump /sdcard/metaloid-window.xml >/dev/null 2>&1 || true
    adb shell cat /sdcard/metaloid-window.xml 2>/dev/null || true
  } | tee -a "$log_file"
fi

exit "$result"
