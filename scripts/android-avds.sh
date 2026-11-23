#!/usr/bin/env bash
# The Android emulator lane's two AVDs (issue #925): API 26 (2 cores, 2 GB RAM)
# and API 36, both on a pinned official Chromium WebView 138.
# No physical device is needed. Documented in e2e/README.md, "Android
# emulator lane".
#
#   scripts/android-avds.sh create      # create both AVDs from scratch
#   scripts/android-avds.sh boot NAME   # boot one headless, print its serial
#   scripts/android-avds.sh stop SERIAL # shut one down
#
# The API 26 WebView: Chrome 139 dropped Android 8, so the build is the last
# Chromium snapshot before the M138 branch point (main position 1465706). Its
# SystemWebView.apk is package com.android.webview, which the Google APIs image
# does not list as a provider (only Chrome and com.google.android.webview, both
# 69). A static framework overlay in /vendor/overlay adds it to the list, and the
# APK installs as an ordinary app. API 36 gets the same build: its image ships
# WebView 133, under the app's 138 floor, and one pinned engine on both AVDs
# keeps the two runs comparable. The overlay lives in each AVD's writable system
# copy, so both always boot with -writable-system.
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
CACHE="${MAIBUK_AVD_CACHE:-$HOME/.cache/maibuk-avds}"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"

API26=maibuk_api26
API36=maibuk_api36
API26_IMAGE="system-images;android-26;google_apis;x86_64"
API36_IMAGE="system-images;android-36;google_apis;x86_64"
WEBVIEW_REV=1465693
WEBVIEW_ZIP_URL="https://storage.googleapis.com/chromium-browser-snapshots/AndroidDesktop_x64/$WEBVIEW_REV/chrome-android-desktop.zip"
WEBVIEW_APK="$CACHE/SystemWebView-$WEBVIEW_REV.apk"
WEBVIEW_PACKAGE=com.android.webview
BUILD_TOOLS_VERSION=36.0.0
PLATFORM=android-36

die() { echo "android-avds: $*" >&2; exit 1; }

set_config() { # avd key value
  local ini="$HOME/.android/avd/$1.avd/config.ini"
  sed -i "/^$2[ =]/d" "$ini"
  echo "$2=$3" >>"$ini"
}

create_avd() { # name image cores ram_mb
  "$AVDMANAGER" create avd --force -n "$1" -k "$2" -d pixel_2 >/dev/null 2>&1 <<<"no"
  set_config "$1" hw.cpu.ncore "$3"
  set_config "$1" hw.ramSize "$4"
  set_config "$1" disk.dataPartition.size 6G
  set_config "$1" hw.keyboard yes
}

wait_boot() { # serial
  "$ADB" -s "$1" wait-for-device
  for _ in $(seq 1 180); do
    [ "$("$ADB" -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && return 0
    sleep 2
  done
  die "$1 did not finish booting"
}

boot() { # name -> prints serial
  local name="$1" port extra=()
  case "$name" in
    "$API26") port=5580; extra=(-writable-system) ;;
    "$API36") port=5582; extra=(-writable-system) ;;
    *) die "unknown AVD $name (expected $API26 or $API36)" ;;
  esac
  local serial="emulator-$port"
  "$ADB" -s "$serial" get-state >/dev/null 2>&1 && die "$serial is already running"
  nohup "$EMULATOR" -avd "$name" -port "$port" "${extra[@]}" -no-window -no-audio \
    -no-boot-anim -no-snapshot -gpu swiftshader_indirect >"$CACHE/$name.log" 2>&1 &
  wait_boot "$serial"
  # API 36 prefers Google's own provider again on every boot, so pick ours each
  # time; a run on the image's WebView 133 would not be comparable.
  "$ADB" -s "$serial" shell cmd webviewupdate set-webview-implementation "$WEBVIEW_PACKAGE" >/dev/null
  local version
  version=$(webview_version "$serial")
  if ! is_floor_webview "$version"; then
    stop "$serial"
    die "$name booted on WebView '$version', not 138+; rerun $0 create"
  fi
  echo "$serial"
}

is_floor_webview() { # version
  case "$1" in 13[89].* | 1[4-9][0-9].*) return 0 ;; *) return 1 ;; esac
}

stop() { # serial
  "$ADB" -s "$1" emu kill >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    "$ADB" -s "$1" get-state >/dev/null 2>&1 || return 0
    sleep 1
  done
}

fetch_webview() {
  [ -f "$WEBVIEW_APK" ] && return 0
  local zip="$CACHE/chromium-$WEBVIEW_REV.zip"
  if [ ! -f "$zip" ]; then
    echo "Downloading Chromium $WEBVIEW_REV (~420 MB)"
    curl -fL --retry 3 -o "$zip.part" "$WEBVIEW_ZIP_URL"
    mv "$zip.part" "$zip"
  fi
  unzip -p "$zip" chrome-android-desktop/apks/SystemWebView.apk >"$WEBVIEW_APK.part"
  mv "$WEBVIEW_APK.part" "$WEBVIEW_APK"
}

# A static overlay of framework-res whose config_webview_packages names only
# the Chromium package, signed with the debug key.
build_overlay() { # out.apk
  local work bt="$SDK/build-tools/$BUILD_TOOLS_VERSION"
  work=$(mktemp -d)
  mkdir -p "$work/res/xml"
  printf '%s\n' \
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.massick.maibuk.webviewoverlay">' \
    '  <overlay android:targetPackage="android" android:isStatic="true" android:priority="99"/>' \
    '</manifest>' >"$work/AndroidManifest.xml"
  printf '%s\n' \
    '<?xml version="1.0" encoding="utf-8"?>' \
    '<webviewproviders>' \
    "  <webviewprovider description=\"Chromium WebView\" packageName=\"$WEBVIEW_PACKAGE\" availableByDefault=\"true\"/>" \
    '</webviewproviders>' >"$work/res/xml/config_webview_packages.xml"
  "$bt/aapt2" compile --dir "$work/res" -o "$work/res.zip"
  "$bt/aapt2" link -o "$work/unsigned.apk" -I "$SDK/platforms/$PLATFORM/android.jar" \
    --manifest "$work/AndroidManifest.xml" --min-sdk-version 26 --target-sdk-version 26 "$work/res.zip"
  [ -f "$HOME/.android/debug.keystore" ] || keytool -genkeypair -keystore "$HOME/.android/debug.keystore" \
    -storepass android -keypass android -alias androiddebugkey -keyalg RSA -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
  "$bt/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$1" "$work/unsigned.apk"
  rm -rf "$work"
}

root() { # serial
  "$ADB" -s "$1" root >/dev/null
  sleep 2
  "$ADB" -s "$1" wait-for-device
}

# API 26 remounts at once; API 36 first disables verity and asks for a reboot.
remount_rw() { # serial
  root "$1"
  if "$ADB" -s "$1" remount 2>&1 | grep -qi 'reboot'; then
    "$ADB" -s "$1" reboot
    wait_boot "$1"
    root "$1"
    "$ADB" -s "$1" remount >/dev/null
  fi
}

install_webview() { # serial
  local serial="$1" adb=("$ADB" -s "$1")
  build_overlay "$CACHE/webview-overlay.apk"
  remount_rw "$serial"
  "${adb[@]}" shell mkdir -p /vendor/overlay
  "${adb[@]}" push "$CACHE/webview-overlay.apk" /vendor/overlay/MaibukWebView.apk >/dev/null
  # Without the overlay label, zygote and system_server cannot read the folder.
  "${adb[@]}" shell "chmod 755 /vendor/overlay && chmod 644 /vendor/overlay/MaibukWebView.apk && chcon -R u:object_r:vendor_overlay_file:s0 /vendor/overlay"
  "${adb[@]}" install -r -t "$WEBVIEW_APK" >/dev/null
  "${adb[@]}" reboot
  wait_boot "$serial"
  # API 36 keeps Google's provider valid too, and prefers it; boot picks ours.
  "${adb[@]}" shell cmd webviewupdate set-webview-implementation "$WEBVIEW_PACKAGE" >/dev/null
}

webview_version() { # serial
  "$ADB" -s "$1" shell dumpsys webviewupdate | tr -d '\r' | sed -n 's/.*Current WebView package (name, version): ([^,]*, \(.*\))/\1/p' | head -1
}

create() {
  mkdir -p "$CACHE"
  [ -x "$SDKMANAGER" ] || die "no sdkmanager at $SDKMANAGER (install the Android cmdline-tools)"
  [ -e /dev/kvm ] || die "no /dev/kvm: the emulator needs hardware acceleration"
  # yes ends on SIGPIPE once sdkmanager exits; the status is sdkmanager's alone.
  (set +o pipefail; yes | "$SDKMANAGER" --install emulator platform-tools "build-tools;$BUILD_TOOLS_VERSION" "platforms;$PLATFORM" "$API26_IMAGE" "$API36_IMAGE" >/dev/null 2>&1)
  create_avd "$API26" "$API26_IMAGE" 2 2048
  create_avd "$API36" "$API36_IMAGE" 4 4096
  fetch_webview

  local name version
  serial=""
  # A failed step never leaves an emulator running.
  trap '[ -z "$serial" ] || stop "$serial"' EXIT
  for name in "$API26" "$API36"; do
    serial=$(boot "$name")
    install_webview "$serial"
    version=$(webview_version "$serial")
    stop "$serial"
    is_floor_webview "$version" ||
      die "$name reports WebView '$version' after the install, not 138+; use the fallback in e2e/README.md"
    echo "$name: WebView $version"
  done
}

case "${1:-}" in
  create) create ;;
  boot) boot "${2:?usage: boot NAME}" ;;
  stop) stop "${2:?usage: stop SERIAL}" ;;
  *) die "usage: $0 create | boot NAME | stop SERIAL" ;;
esac
