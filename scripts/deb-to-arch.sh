#!/bin/bash
# Alternative script to create Arch package from .deb without Docker
# This uses a manual approach to assemble the package structure

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/arch"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Arch Package from DEB (No Docker) ===${NC}"

# Get version from package.json
VERSION=$(grep -Po '"version":\s*"\K[^"]+' "$PROJECT_ROOT/package.json" | head -1)
echo -e "${YELLOW}Version: $VERSION${NC}"

# Check for required tools
for tool in ar tar zstd; do
    if ! command -v $tool &> /dev/null; then
        echo -e "${RED}Error: '$tool' is required but not installed.${NC}"
        echo -e "Install with: sudo apt install binutils tar zstd"
        exit 1
    fi
done

# Find the .deb file
DEB_FILE="$PROJECT_ROOT/src-tauri/target/release/bundle/deb/Maibuk_${VERSION}_amd64.deb"

if [[ ! -f "$DEB_FILE" ]]; then
    echo -e "${RED}Error: .deb file not found at $DEB_FILE${NC}"
    echo -e "${YELLOW}Run 'pnpm tauri build --bundles deb' first.${NC}"
    exit 1
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo -e "${YELLOW}Extracting .deb file...${NC}"

# Extract .deb (it's an ar archive)
cd "$TEMP_DIR"
ar x "$DEB_FILE"

# Extract data.tar.* (contains the actual files)
DATA_TAR=$(ls data.tar.* 2>/dev/null | head -1)
if [[ -z "$DATA_TAR" ]]; then
    echo -e "${RED}Error: Could not find data.tar in .deb${NC}"
    exit 1
fi

mkdir -p pkgroot
tar -xf "$DATA_TAR" -C pkgroot

# Create .PKGINFO file (required for Arch packages)
PKGNAME="maibuk-bin"
INSTALLED_SIZE=$(du -sb pkgroot | cut -f1)

cat > pkgroot/.PKGINFO << EOF
pkgname = $PKGNAME
pkgver = $VERSION-1
pkgdesc = A writing app for authors
url = https://maibuk.massick.dev
builddate = $(date +%s)
packager = M4ss1ck
size = $INSTALLED_SIZE
arch = x86_64
license = MIT
depend = webkit2gtk-4.1
depend = gtk3
depend = libappindicator-gtk3
provides = maibuk
conflict = maibuk
EOF

# Create .MTREE file (file manifest with checksums)
echo -e "${YELLOW}Creating package manifest...${NC}"

cd pkgroot
# Generate MTREE
{
    echo "#mtree"
    find . -type f -o -type l | while read -r file; do
        file="${file#./}"
        if [[ -L "$file" ]]; then
            echo "$file type=link link=$(readlink "$file")"
        elif [[ -f "$file" ]]; then
            mode=$(stat -c '%a' "$file")
            size=$(stat -c '%s' "$file")
            md5=$(md5sum "$file" | cut -d' ' -f1)
            sha256=$(sha256sum "$file" | cut -d' ' -f1)
            echo "$file mode=$mode size=$size md5digest=$md5 sha256digest=$sha256"
        fi
    done
} | gzip > .MTREE

# Create the final package
echo -e "${YELLOW}Creating .pkg.tar.zst package...${NC}"
mkdir -p "$OUTPUT_DIR"
PKG_FILENAME="${PKGNAME}-${VERSION}-1-x86_64.pkg.tar.zst"

# Create the package (files must be in specific order)
tar --create \
    --zstd \
    --file="$OUTPUT_DIR/$PKG_FILENAME" \
    .PKGINFO .MTREE \
    $(find . -mindepth 1 -not -name '.PKGINFO' -not -name '.MTREE' | sort)

echo -e "${GREEN}=== Success! ===${NC}"
echo -e "${GREEN}Package created: $OUTPUT_DIR/$PKG_FILENAME${NC}"
echo ""
echo -e "To install on Arch Linux:"
echo -e "  ${YELLOW}sudo pacman -U $PKG_FILENAME${NC}"
echo ""
echo -e "${YELLOW}Note: This package was created without makepkg.${NC}"
