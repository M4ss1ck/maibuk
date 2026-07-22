#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ANDROID_HOME=${ANDROID_HOME:-"$HOME/Android/Sdk"}
SIGNING_DIR="$HOME/.config/maibuk/android-signing"
KEYSTORE="$SIGNING_DIR/android-release.jks"
CREDENTIALS="$SIGNING_DIR/credentials.env"
ALIAS=maibuk
UNSIGNED_APK="$ROOT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
ALIGNED_APK="$ROOT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-aligned.apk"
SIGNED_APK="$ROOT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
JNI_LIBS_DIR="$ROOT_DIR/src-tauri/gen/android/app/src/main/jniLibs"

fail() {
  printf 'Android release build failed: %s\n' "$1" >&2
  exit 1
}

[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/keytool" ]] || fail "JAVA_HOME must point to a JDK containing keytool"
[[ -d "$ANDROID_HOME/build-tools" ]] || fail "Android SDK build tools not found under $ANDROID_HOME"
command -v openssl >/dev/null 2>&1 || fail "openssl is required to generate signing credentials"

BUILD_TOOLS_VERSION=$(printf '%s\n' "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)
ZIPALIGN="$BUILD_TOOLS_VERSION/zipalign"
APKSIGNER="$BUILD_TOOLS_VERSION/apksigner"
AAPT="$BUILD_TOOLS_VERSION/aapt"

[[ -x "$ZIPALIGN" ]] || fail "zipalign not found in $BUILD_TOOLS_VERSION"
[[ -x "$APKSIGNER" ]] || fail "apksigner not found in $BUILD_TOOLS_VERSION"
[[ -x "$AAPT" ]] || fail "aapt not found in $BUILD_TOOLS_VERSION"

umask 077
mkdir -p "$SIGNING_DIR"
chmod 700 "$SIGNING_DIR"

if [[ -e "$KEYSTORE" || -e "$CREDENTIALS" ]]; then
  [[ -f "$KEYSTORE" && -f "$CREDENTIALS" ]] || fail "signing material is incomplete in $SIGNING_DIR"
else
  PASSWORD=$(openssl rand -hex 32)
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -storepass "$PASSWORD" \
    -keypass "$PASSWORD" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -dname "CN=Maibuk"
  printf 'MAIBUK_ANDROID_KEYSTORE=%q\n' "$KEYSTORE" > "$CREDENTIALS"
  printf 'MAIBUK_ANDROID_KEY_ALIAS=%q\n' "$ALIAS" >> "$CREDENTIALS"
  printf 'MAIBUK_ANDROID_KEYSTORE_PASSWORD=%q\n' "$PASSWORD" >> "$CREDENTIALS"
fi

chmod 600 "$KEYSTORE" "$CREDENTIALS"
# shellcheck disable=SC1090
source "$CREDENTIALS"

[[ "$MAIBUK_ANDROID_KEYSTORE" == "$KEYSTORE" ]] || fail "credentials reference an unexpected keystore"
[[ "$MAIBUK_ANDROID_KEY_ALIAS" == "$ALIAS" ]] || fail "credentials reference an unexpected key alias"
[[ -n "$MAIBUK_ANDROID_KEYSTORE_PASSWORD" ]] || fail "keystore password is empty"

rm -rf "$JNI_LIBS_DIR"
pnpm tauri android build --apk true --aab false --target aarch64 x86_64
[[ -f "$UNSIGNED_APK" ]] || fail "unsigned APK not found at $UNSIGNED_APK"

"$ZIPALIGN" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign \
  --ks "$MAIBUK_ANDROID_KEYSTORE" \
  --ks-key-alias "$MAIBUK_ANDROID_KEY_ALIAS" \
  --ks-pass "pass:$MAIBUK_ANDROID_KEYSTORE_PASSWORD" \
  --key-pass "pass:$MAIBUK_ANDROID_KEYSTORE_PASSWORD" \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"
"$APKSIGNER" verify --verbose "$SIGNED_APK"
rm -f "$ALIGNED_APK"

BADGING=$("$AAPT" dump badging "$SIGNED_APK")
[[ "$BADGING" == *"native-code: 'x86_64' 'arm64-v8a'"* || "$BADGING" == *"native-code: 'arm64-v8a' 'x86_64'"* ]] \
  || fail "signed APK does not contain both arm64-v8a and x86_64"

printf 'Signed Android release APK: %s\n' "$SIGNED_APK"
printf 'Back up %s and %s before distributing this APK.\n' "$KEYSTORE" "$CREDENTIALS"
