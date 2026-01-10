# Dockerfile for building Arch Linux packages from non-Arch systems
FROM archlinux:latest

# Update system and install build dependencies
RUN pacman -Syu --noconfirm && \
  pacman -S --noconfirm \
  base-devel \
  git \
  fakeroot \
  binutils \
  zstd

# Create a non-root user for makepkg (it refuses to run as root)
RUN useradd -m builder && \
  echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Create build directory and set permissions
RUN mkdir -p /home/builder/build /output && chown builder:builder /home/builder/build /output

# Set working directory
WORKDIR /home/builder/build

# Switch to builder user
USER builder

# Entry point will be provided by the script
CMD ["/bin/bash"]
