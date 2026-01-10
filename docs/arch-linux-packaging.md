# Building Arch Linux Packages

Since Arch Linux packages (`.pkg.tar.zst`) require `makepkg` which only runs on Arch-based systems, we provide multiple options for building from non-Arch distributions like Linux Mint or Ubuntu.

## Options

### Option 1: Docker-based Build (Recommended)

Uses an Arch Linux Docker container to run `makepkg` properly.

**Requirements:**

- Docker installed and running
- Tauri build artifacts (run `pnpm tauri build` first)

**Usage:**

```bash
# First, build the Tauri app
pnpm tauri build

# Then create the Arch package
./scripts/build-arch-package.sh
```

**Output:** `src-tauri/target/release/bundle/arch/maibuk-bin-<version>-1-x86_64.pkg.tar.zst`

### Option 2: Convert from .deb (No Docker)

Manually converts the `.deb` package to Arch format without Docker.

**Requirements:**

- `ar`, `tar`, `zstd` (available via `sudo apt install binutils tar zstd`)
- A `.deb` file from `pnpm tauri build --bundles deb`

**Usage:**

```bash
# Build the .deb first
pnpm tauri build --bundles deb

# Convert to Arch format
./scripts/deb-to-arch.sh
```

**Note:** This creates a package that will work, but it's less "official" since it wasn't built with `makepkg`.

### Option 3: Using `debtap` (On Arch Linux only)

If you have access to an Arch Linux system, you can use `debtap`:

```bash
# Install debtap from AUR
yay -S debtap

# Update debtap database (first time only)
sudo debtap -u

# Convert .deb to Arch package
debtap maibuk_0.1.4_amd64.deb
```

## Installing the Package

On Arch Linux or derivatives (Manjaro, EndeavourOS, etc.):

```bash
sudo pacman -U maibuk-bin-<version>-1-x86_64.pkg.tar.zst
```

## Files

- `scripts/build-arch-package.sh` - Docker-based builder
- `scripts/deb-to-arch.sh` - DEB to Arch converter (no Docker)
- `scripts/arch-package/Dockerfile` - Docker image definition
