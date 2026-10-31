//! Disk space Maibuk takes, one total per tray line.
//!
//! Every byte is counted once: a root nested inside another line's root (the
//! default Backup Directory inside the app config folder) is left out of the
//! outer walk and counted on its own line, a root repeated or nested within
//! the same line is walked once, and a file with several hard links counts
//! once, as `du` does. Sizes are the apparent sizes of files and symlinks;
//! a folder's own entry counts 0, as in GNU `du -sb` (coreutils 9), which is
//! what the lines are checked against. Symlinks are never followed inside a
//! root.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// The size of each line, in the order given. `None` when none of a line's
/// roots could be read: the tray shows the dash and counts it as 0.
#[cfg(test)]
pub fn measure(lines: &[Vec<PathBuf>]) -> Vec<Option<u64>> {
    let mut sizes = vec![None; lines.len()];
    measure_each(lines, |line, size| sizes[line] = size);
    sizes
}

/// Reports each line's size, in order, as soon as its roots are walked, so
/// a slow line never holds back the ones before it.
pub fn measure_each(lines: &[Vec<PathBuf>], mut on_line: impl FnMut(usize, Option<u64>)) {
    let owned = assign_roots(lines);
    let all_roots: HashSet<&Path> = owned.iter().map(|(_, root)| root.as_path()).collect();
    let mut seen_inodes = HashSet::new();
    for line in 0..lines.len() {
        let mut size = None;
        for (_, root) in owned.iter().filter(|(owner, _)| *owner == line) {
            if let Some(bytes) = walk(root, &all_roots, &mut seen_inodes) {
                *size.get_or_insert(0) += bytes;
            }
        }
        on_line(line, size);
    }
}

/// Each distinct root with the line that owns it. A root identical to an
/// earlier one belongs to the earlier line; a root inside another root of the
/// same line is already counted by that walk.
fn assign_roots(lines: &[Vec<PathBuf>]) -> Vec<(usize, PathBuf)> {
    let mut owned: Vec<(usize, PathBuf)> = Vec::new();
    for (line, roots) in lines.iter().enumerate() {
        for root in roots {
            // Compare real locations, so a root reached through a symlink still
            // nests where it really lives. A missing root keeps its own path.
            let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
            if owned.iter().any(|(_, other)| *other == root) {
                continue;
            }
            owned.push((line, root));
        }
    }
    owned
        .iter()
        .filter(|(line, root)| {
            !owned.iter().any(|(other_line, other)| {
                other_line == line && other != root && root.starts_with(other)
            })
        })
        .cloned()
        .collect()
}

/// Bytes under `root`, skipping any other root inside it. `None` when the
/// root itself is missing or unreadable; an unreadable entry inside counts 0.
fn walk(
    root: &Path,
    all_roots: &HashSet<&Path>,
    seen_inodes: &mut HashSet<(u64, u64)>,
) -> Option<u64> {
    // The root itself is followed if it is a symlink; nothing below it is.
    let metadata = std::fs::metadata(root).ok()?;
    let mut total = counted(&metadata, seen_inodes);
    if !metadata.is_dir() {
        return Some(total);
    }
    let mut stack = vec![std::fs::read_dir(root).ok()?];
    while let Some(entries) = stack.last_mut() {
        let Some(entry) = entries.next() else {
            stack.pop();
            continue;
        };
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if all_roots.contains(path.as_path()) {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        total += counted(&metadata, seen_inodes);
        if metadata.is_dir() {
            if let Ok(children) = std::fs::read_dir(&path) {
                stack.push(children);
            }
        }
    }
    Some(total)
}

#[cfg(unix)]
fn counted(metadata: &std::fs::Metadata, seen_inodes: &mut HashSet<(u64, u64)>) -> u64 {
    use std::os::unix::fs::MetadataExt;
    if metadata.is_dir()
        || (metadata.nlink() > 1 && !seen_inodes.insert((metadata.dev(), metadata.ino())))
    {
        return 0;
    }
    metadata.len()
}

#[cfg(not(unix))]
fn counted(metadata: &std::fs::Metadata, _seen_inodes: &mut HashSet<(u64, u64)>) -> u64 {
    if metadata.is_dir() {
        0
    } else {
        metadata.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("maibuk-storage-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn file(&self, relative: &str, bytes: usize) -> PathBuf {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, vec![b'x'; bytes]).unwrap();
            path
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            std::fs::create_dir_all(&path).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn link_size(path: &Path) -> u64 {
        std::fs::symlink_metadata(path).unwrap().len()
    }

    #[test]
    fn a_nested_root_of_another_line_is_counted_once_on_its_own_line() {
        let tmp = TempDir::new("nested");
        let config = tmp.dir("config");
        tmp.file("config/settings.json", 100);
        let backups = tmp.dir("config/backups");
        tmp.file("config/backups/a.sql", 5_000);

        let sizes = measure(&[vec![config.clone()], vec![backups.clone()]]);
        assert_eq!(sizes[0], Some(100), "Data leaves the Backup Directory out");
        assert_eq!(sizes[1], Some(5_000));
    }

    #[test]
    fn repeated_and_nested_roots_of_one_line_are_walked_once() {
        let tmp = TempDir::new("same-line");
        let data = tmp.dir("data");
        tmp.file("data/library.db", 1_000);
        let models = tmp.dir("data/models");
        tmp.file("data/models/m.onnx", 2_000);

        // Linux has one folder for app data and app local data.
        let sizes = measure(&[vec![data.clone(), data.clone(), models.clone()]]);
        assert_eq!(sizes[0], Some(3_000));
    }

    #[test]
    fn an_identical_root_on_two_lines_belongs_to_the_first() {
        let tmp = TempDir::new("identical");
        let shared = tmp.dir("shared");
        tmp.file("shared/x", 10);
        let sizes = measure(&[vec![shared.clone()], vec![shared.clone()]]);
        assert_eq!(sizes, [Some(10), None]);
    }

    #[test]
    fn each_line_is_reported_once_in_order() {
        let tmp = TempDir::new("each");
        let a = tmp.dir("a");
        tmp.file("a/x", 7);
        let mut reports = Vec::new();
        measure_each(
            &[vec![a], vec![], vec![tmp.0.join("gone")]],
            |line, size| reports.push((line, size)),
        );
        assert_eq!(reports, [(0, Some(7)), (1, None), (2, None)]);
    }

    #[test]
    fn a_missing_root_is_unknown_and_never_drops_the_line() {
        let tmp = TempDir::new("missing");
        let plugins = tmp.0.join("Plugins");
        let sizes = measure(&[vec![plugins], vec![]]);
        assert_eq!(sizes, [None, None]);
    }

    #[test]
    fn a_line_with_one_readable_root_counts_what_it_can_read() {
        let tmp = TempDir::new("partial");
        let app = tmp.file("maibuk.AppImage", 4_096);
        let sizes = measure(&[vec![app, tmp.0.join("no-log-dir")]]);
        assert_eq!(sizes, [Some(4_096)]);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_and_hard_links_count_once() {
        let tmp = TempDir::new("links");
        let outside = tmp.dir("outside");
        tmp.file("outside/big", 50_000);
        let root = tmp.dir("root");
        let file = tmp.file("root/a", 300);
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::fs::hard_link(&file, root.join("b")).unwrap();

        let link = link_size(&root.join("link"));
        let sizes = measure(&[vec![root.clone()]]);
        assert_eq!(sizes[0], Some(300 + link));
    }
}
