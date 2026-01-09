#!/bin/bash

# Bump patch version in all version files
# Usage: ./bump-version.sh [version]
# If no version provided, increments patch version (x.y.z -> x.y.z+1)

set -e

# Get current version from package.json
CURRENT_VERSION=$(grep -Po '"version"\s*:\s*"\K[0-9]+\.[0-9]+\.[0-9]+' package.json | head -1)

if [ -z "$CURRENT_VERSION" ]; then
    echo "Error: Could not read current version from package.json"
    exit 1
fi

echo "Current version: $CURRENT_VERSION"

if [ -n "$1" ]; then
    # Use provided version
    NEW_VERSION="$1"
else
    # Bump patch version
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    NEW_PATCH=$((PATCH + 1))
    NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
fi

echo "New version: $NEW_VERSION"

# Update package.json
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
echo "Updated package.json"

# Update src-tauri/Cargo.toml
sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
echo "Updated src-tauri/Cargo.toml"

# Update src-tauri/tauri.conf.json
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
echo "Updated src-tauri/tauri.conf.json"

echo "Version bumped to $NEW_VERSION"
