#!/bin/bash
# Script to build Arch Linux package using Docker
# This can be run from any Linux distribution (Mint, Ubuntu, Fedora, etc.)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
echo "Project root: $PROJECT_ROOT"
BUILD_DIR="$SCRIPT_DIR/arch-package"
OUTPUT_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/arch"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Arch Linux Package Builder ===${NC}"

# Get version from package.json
VERSION=$(grep -Po '"version":\s*"\K[^"]+' "$PROJECT_ROOT/package.json" | head -1)
echo -e "${YELLOW}Building version: $VERSION${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if the Tauri build artifacts exist
BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/maibuk"
ICON_PATH="$PROJECT_ROOT/src-tauri/icons/128x128.png"
DEB_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/deb/maibuk_${VERSION}_amd64"
DESKTOP_PATH="$DEB_DIR/usr/share/applications/maibuk.desktop"

if [[ ! -f "$BINARY_PATH" ]]; then
    echo -e "${RED}Error: Binary not found at $BINARY_PATH${NC}"
    echo -e "${YELLOW}Run 'pnpm tauri build' first to generate the release artifacts.${NC}"
    exit 1
fi

if [[ ! -f "$DESKTOP_PATH" ]]; then
    echo -e "${YELLOW}Warning: .desktop file not found at expected path.${NC}"
    echo -e "${YELLOW}Creating a basic .desktop file...${NC}"
    
    # Create a basic .desktop file
    mkdir -p "$(dirname "$DESKTOP_PATH")"
    cat > "$DESKTOP_PATH" << EOF
[Desktop Entry]
Name=Maibuk
Comment=A writing app for authors
Exec=maibuk
Icon=maibuk
Terminal=false
Type=Application
Categories=Office;TextEditor;
StartupWMClass=maibuk
EOF
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Create a temporary build context
TEMP_BUILD_DIR=$(mktemp -d)
trap "rm -rf $TEMP_BUILD_DIR" EXIT

echo -e "${YELLOW}Preparing build context...${NC}"

# Copy necessary files to temp build directory
cp "$BINARY_PATH" "$TEMP_BUILD_DIR/maibuk"
cp "$ICON_PATH" "$TEMP_BUILD_DIR/maibuk.png"
cp "$DESKTOP_PATH" "$TEMP_BUILD_DIR/maibuk.desktop"
cp "$BUILD_DIR/Dockerfile" "$TEMP_BUILD_DIR/"

# Create PKGBUILD with correct version
cat > "$TEMP_BUILD_DIR/PKGBUILD" << EOF
# Maintainer: M4ss1ck
pkgname=maibuk-bin
pkgver=$VERSION
pkgrel=1
pkgdesc="A writing app for authors"
arch=('x86_64')
url="https://maibuk.massick.dev"
license=('MIT')
# Tauri v2 dependencies
depends=('webkit2gtk-4.1' 'gtk3' 'libappindicator-gtk3')
provides=('maibuk')
conflicts=('maibuk')

# Sources are provided as pre-built artifacts
source=("maibuk"
        "maibuk.png"
        "maibuk.desktop")

# We skip checksums for local builds
sha256sums=('SKIP' 'SKIP' 'SKIP')

package() {
    # 1. Install the binary
    install -Dm755 "\${srcdir}/maibuk" "\${pkgdir}/usr/bin/maibuk"

    # 2. Install the icon
    install -Dm644 "\${srcdir}/maibuk.png" "\${pkgdir}/usr/share/icons/hicolor/128x128/apps/maibuk.png"

    # 3. Install the .desktop file
    install -Dm644 "\${srcdir}/maibuk.desktop" "\${pkgdir}/usr/share/applications/maibuk.desktop"
}
EOF

echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t maibuk-arch-builder "$TEMP_BUILD_DIR"

echo -e "${YELLOW}Running makepkg in container...${NC}"
docker run --rm \
    -v "$TEMP_BUILD_DIR:/build-src:ro" \
    -v "$OUTPUT_DIR:/output" \
    --user root \
    maibuk-arch-builder \
    bash -c "
        # Copy source files to writable directory and fix permissions
        cp -r /build-src/* /home/builder/build/ && \
        chown -R builder:builder /home/builder/build /output && \
        cd /home/builder/build && \
        su builder -c 'makepkg -sf --noconfirm' && \
        cp *.pkg.tar.zst /output/ 2>/dev/null || cp *.pkg.tar.* /output/
    "

# Check if package was created
PKG_FILE=$(ls -1 "$OUTPUT_DIR"/maibuk-bin-*.pkg.tar.* 2>/dev/null | head -1)

if [[ -n "$PKG_FILE" ]]; then
    echo -e "${GREEN}=== Success! ===${NC}"
    echo -e "${GREEN}Package created: $PKG_FILE${NC}"
    echo ""
    echo -e "To install on Arch Linux:"
    echo -e "  ${YELLOW}sudo pacman -U $(basename "$PKG_FILE")${NC}"
else
    echo -e "${RED}Error: Package was not created.${NC}"
    exit 1
fi
