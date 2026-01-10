#!/bin/bash

# Simple release script for Maibuk
# Usage: ./scripts/release.sh [version]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if version argument is provided
if [ $# -eq 0 ]; then
    print_error "Please provide a version number"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.1.8"
    exit 1
fi

VERSION=$1

# Validate version format (basic check)
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

print_status "Creating release for version $VERSION"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_warning "You have uncommitted changes. Please commit or stash them first."
    git status --porcelain
    exit 1
fi

# Update version in package.json
print_status "Updating package.json version to $VERSION"
npm version $VERSION --no-git-tag-version

# Update version in Cargo.toml
print_status "Updating Cargo.toml version to $VERSION"
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

# Update version in tauri.conf.json
print_status "Updating tauri.conf.json version to $VERSION"
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

# Update Cargo.lock by running cargo check
print_status "Updating Cargo.lock"
(cd src-tauri && cargo update -p maibuk --precise $VERSION 2>/dev/null || cargo check --quiet 2>/dev/null || true)

# Create git commit
print_status "Creating git commit"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: bump version to $VERSION"

# Create git tag
print_status "Creating git tag v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

# Ask for confirmation before pushing
echo
print_warning "Ready to push changes and tag to remote repository."
print_warning "This will trigger the release workflow on GitHub."
echo "Files updated:"
echo "  - package.json"
echo "  - src-tauri/Cargo.toml"
echo "  - src-tauri/Cargo.lock"
echo "  - src-tauri/tauri.conf.json"
echo
echo "Git tag created: v$VERSION"
echo

read -p "Do you want to push these changes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Pushing changes to remote repository"
    git push origin main
    git push origin "v$VERSION"
    
    print_status "✅ Release v$VERSION has been pushed!"
    print_status "🚀 GitHub Actions will now build and create the release automatically."
    print_status "📦 Check your repository's Actions tab for build progress."
    echo
    print_status "Once the workflow completes, you can:"
    print_status "  1. Go to your repository's Releases page"
    print_status "  2. Edit the draft release to add release notes"
    print_status "  3. Publish the release"
else
    print_warning "Release cancelled. No changes were pushed."
    print_warning "To undo local changes, run:"
    echo "  git reset --hard HEAD~1"
    echo "  git tag -d v$VERSION"
fi
