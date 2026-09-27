#!/bin/bash
# PROTOTYPE. cpal always depends on alsa-sys, whose build script asks
# pkg-config for "alsa" (libasound2-dev). This machine has only the runtime
# libasound.so.2, so point pkg-config at a local shim instead of installing the
# dev package. A real build needs libasound2-dev (apt) / alsa-lib-devel (dnf).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
shim="$here/.alsa-shim"
mkdir -p "$shim/lib" "$shim/pkgconfig"
ln -sf /usr/lib/x86_64-linux-gnu/libasound.so.2 "$shim/lib/libasound.so"
cat > "$shim/pkgconfig/alsa.pc" <<PC
libdir=$shim/lib
Name: alsa
Description: shim for the spike
Version: 1.2.11
Libs: -L\${libdir} -lasound
Cflags:
PC
echo "export PKG_CONFIG_PATH=$shim/pkgconfig"
