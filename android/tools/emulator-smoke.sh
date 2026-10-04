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
    echo '--- adb connection and boot state ---'
    adb devices -l 2>&1 || true
    adb get-state 2>&1 || true
    adb shell getprop sys.boot_completed 2>&1 || true

    echo
    echo '--- foreground activity/window ---'
    activity_dump=$(adb shell dumpsys activity activities 2>&1 || true)
    printf '%s\n' "$activity_dump" \
      | grep -Ei 'mResumedActivity|topResumedActivity|error:|offline|no devices|unauthorized' \
      | tail -10 || true
    window_dump=$(adb shell dumpsys window 2>&1 || true)
    printf '%s\n' "$window_dump" \
      | grep -Ei 'mCurrentFocus|mFocusedApp|mFocusedWindow|error:|offline|no devices|unauthorized' \
      | tail -10 || true

    screenshot_file="${RUNNER_TEMP:-/tmp}/ci-emulator-failure.png"
    if adb pull /sdcard/Android/data/com.metaloid.app.debug.test/files/metaloid-smoke-failure.png \
      "$screenshot_file"; then
      pull_result=0
    else
      pull_result=$?
    fi
    if [ -s "$screenshot_file" ]; then
      echo "Failure screenshot captured ($screenshot_file, $(du -h "$screenshot_file" | cut -f1))."
    else
      rm -f "$screenshot_file"
      echo "Failure screenshot was not available (adb pull exit=$pull_result)."
    fi

    echo
    echo '--- recent app/emulator logcat ---'
    app_pid=$(adb shell pidof -s com.metaloid.app.debug 2>&1 \
      | tr -d '\r' | grep -Eo '^[0-9]+' | head -1 || true)
    if [ -n "$app_pid" ]; then
      adb logcat -d -v time --pid="$app_pid" 2>&1 | tail -160 || true
    else
      adb logcat -d -v time -t 1200 2>&1 \
        | grep -Ei 'AndroidRuntime|FATAL EXCEPTION|System.err|com\.metaloid|metaloid|MetaIoid|error:|offline|no devices|unauthorized' \
        | tail -120 || true
    fi

    echo
    echo '--- visible emulator window hierarchy ---'
    hierarchy_dump=$(adb shell uiautomator dump /sdcard/metaloid-window.xml 2>&1 || true)
    printf '%s\n' "$hierarchy_dump"
    adb shell cat /sdcard/metaloid-window.xml 2>&1 || true
  } | tee -a "$log_file"
fi

exit "$result"
