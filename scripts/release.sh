#!/bin/bash

# Release script for Maibuk
#
# Usage:
#   ./scripts/release.sh <version> [--dry-run]
#
# What it does:
#   1. Loads optional config from .env (AI changelog settings).
#   2. Ensures you are on a release/v<version> branch (creates it if needed).
#   3. Bumps the version across package.json, Cargo.toml, Cargo.lock and tauri.conf.json.
#   4. Generates a CHANGELOG.md section for commits since the last tag
#      (AI-assisted if configured, otherwise a grouped commit list).
#   5. Commits the bump + changelog, creates an annotated tag, and pushes
#      the release branch and the tag (the tag triggers the GitHub release workflow).
#
# AI changelog is fully optional: with no .env config it falls back to a
# plain grouped commit list and never errors out.
#
# See .env.example and the "Releasing" section of README.md for details.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status()  { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# Resolve repo root so the script works from any directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load optional config from .env (used for AI changelog settings).
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# --- Parse arguments -------------------------------------------------------
VERSION=""
DRY_RUN=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        -h|--help)
            echo "Usage: $0 <version> [--dry-run]"
            echo "Example: $0 0.4.13"
            echo "         $0 0.4.13 --dry-run"
            exit 0
            ;;
        -*)
            print_error "Unknown option: $arg"
            exit 1
            ;;
        *)
            if [ -z "$VERSION" ]; then
                VERSION="$arg"
            else
                print_error "Unexpected argument: $arg"
                exit 1
            fi
            ;;
    esac
done

if [ -z "$VERSION" ]; then
    print_error "Please provide a version number"
    echo "Usage: $0 <version> [--dry-run]"
    echo "Example: $0 0.4.13"
    exit 1
fi

if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

RELEASE_BRANCH="release/v$VERSION"
TAG="v$VERSION"

if [ "$DRY_RUN" = true ]; then
    print_warning "Running in --dry-run mode: no files, commits, tags or pushes will be made."
fi

# --- Changelog generation --------------------------------------------------
#
# Lives in scripts/lib/changelog.sh so scripts/test-changelog.sh can exercise
# it without running a real release.
# shellcheck source=scripts/lib/changelog.sh
source "$REPO_ROOT/scripts/lib/changelog.sh"

# --- Determine commit range ------------------------------------------------
LAST_TAG="$(git tag --list 'v*' --sort=-version:refname | head -n1)"
if [ -n "$LAST_TAG" ]; then
    RANGE="$LAST_TAG..HEAD"
    print_status "Generating changelog for commits in $RANGE"
else
    RANGE="HEAD"
    print_warning "No previous tag found; using full history."
fi

CHANGELOG_SECTION="$(generate_changelog "$RANGE")"
TODAY="$(date +%Y-%m-%d)"
NEW_ENTRY="## [$VERSION] - $TODAY"$'\n\n'"$CHANGELOG_SECTION"

# --- Dry run: show what would happen and stop ------------------------------
if [ "$DRY_RUN" = true ]; then
    echo
    echo -e "${BLUE}=== Dry run summary ===${NC}"
    echo "Version:        $VERSION"
    echo "Release branch: $RELEASE_BRANCH (current: $(git rev-parse --abbrev-ref HEAD))"
    echo "Tag:            $TAG"
    echo "Commit range:   $RANGE"
    echo
    echo -e "${BLUE}=== Generated CHANGELOG entry ===${NC}"
    echo
    printf '%s\n' "$NEW_ENTRY"
    echo
    print_warning "Dry run complete. Nothing was changed."
    exit 0
fi

# --- From here on we mutate the repo; require a clean tree -----------------
if ! git diff-index --quiet HEAD --; then
    print_warning "You have uncommitted changes. Please commit or stash them first."
    git status --porcelain
    exit 1
fi

# --- Ensure we are on the release branch -----------------------------------
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$RELEASE_BRANCH" ]; then
    if git show-ref --verify --quiet "refs/heads/$RELEASE_BRANCH"; then
        print_status "Switching to existing branch $RELEASE_BRANCH"
        git checkout "$RELEASE_BRANCH"
    else
        print_status "Creating release branch $RELEASE_BRANCH"
        git checkout -b "$RELEASE_BRANCH"
    fi
else
    print_status "Already on $RELEASE_BRANCH"
fi

# --- Bump version ----------------------------------------------------------
print_status "Updating package.json version to $VERSION"
npm version "$VERSION" --no-git-tag-version > /dev/null

print_status "Updating Cargo.toml version to $VERSION"
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

print_status "Updating tauri.conf.json version to $VERSION"
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

print_status "Updating Cargo.lock"
(cd src-tauri && cargo update -p maibuk --precise "$VERSION" 2>/dev/null || cargo check --quiet 2>/dev/null || true)

# --- Update CHANGELOG.md ---------------------------------------------------
print_status "Updating CHANGELOG.md"
CHANGELOG_HEADER="# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
"

if [ -f CHANGELOG.md ]; then
    # Insert the new entry right after the header, before the first existing entry.
    TMP_CHANGELOG="$(mktemp)"
    EXISTING_BODY="$(awk 'found || /^## \[/{found=1; print}' CHANGELOG.md)"
    {
        printf '%s\n' "$CHANGELOG_HEADER"
        printf '%s\n\n' "$NEW_ENTRY"
        [ -n "$EXISTING_BODY" ] && printf '%s\n' "$EXISTING_BODY"
    } > "$TMP_CHANGELOG"
    mv "$TMP_CHANGELOG" CHANGELOG.md
else
    {
        printf '%s\n' "$CHANGELOG_HEADER"
        printf '%s\n' "$NEW_ENTRY"
    } > CHANGELOG.md
fi

# --- Commit, tag, push -----------------------------------------------------
print_status "Creating git commit"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump version to $VERSION"

print_status "Creating git tag $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo
print_warning "Ready to push the release branch and tag to the remote repository."
print_warning "Pushing the tag triggers the GitHub release workflow."
echo "Branch: $RELEASE_BRANCH"
echo "Tag:    $TAG"
echo

read -p "Do you want to push these changes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Pushing $RELEASE_BRANCH"
    git push -u origin "$RELEASE_BRANCH"
    print_status "Pushing tag $TAG"
    git push origin "$TAG"

    print_status "✅ Release $TAG has been pushed!"
    print_status "🚀 GitHub Actions will build every platform and publish the release"
    print_status "   automatically once all the binaries are attached."
    echo
    print_status "Next steps:"
    print_status "  1. Open a PR from $RELEASE_BRANCH into main and merge it."
    print_status "  2. Watch the Release workflow. No manual publish step is needed."
    print_status "     If a build fails the release stays a draft; fix the build and re-run."
else
    print_warning "Release cancelled. No changes were pushed."
    print_warning "To undo local changes, run:"
    echo "  git reset --hard HEAD~1"
    echo "  git tag -d $TAG"
fi
