//! The pinned-hash scheme (ADR 0020): Go's `dirhash.Hash1` over a Plugin
//! folder's files, so desktop, Android, and web all pin the same value.
//!
//! One summary line per file — lowercase hex SHA-256, two spaces, the
//! POSIX-relative path, newline — with the lines sorted by the path's UTF-8
//! bytes; SHA-256 of the summary, standard base64, prefixed `h1:`. A path
//! containing a newline is refused because it would write two summary lines
//! for one file. The web implementation (`src/features/plugins/directory-hash.ts`)
//! reads the same fixtures (`src/test/fixtures/plugins/hash-fixture` and its
//! `hash-fixture-newline` sibling), so the two cannot drift.

use base64::Engine;
use sha2::{Digest, Sha256};

/// The refusal code the shared `hash-fixture-newline` contract pins.
pub const NEWLINE_CODE: &str = "filename-newline";
pub const NEWLINE_MESSAGE: &str = "dirhash: filenames with newlines are not supported";

/// A folder whose paths the Go `dirhash.Hash1` scheme cannot represent.
#[derive(Debug, PartialEq, Eq)]
pub struct HashError {
    /// The offending path, for the refusal the webview reports.
    pub path: String,
}

impl HashError {
    pub fn code(&self) -> &'static str {
        NEWLINE_CODE
    }

    pub fn message(&self) -> &'static str {
        NEWLINE_MESSAGE
    }
}

impl std::fmt::Display for HashError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code(), self.message())
    }
}

fn digest_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sorted<'a>(files: &'a [(String, Vec<u8>)]) -> Result<Vec<&'a (String, Vec<u8>)>, HashError> {
    let mut sorted: Vec<_> = files.iter().collect();
    // Byte order over UTF-8, matching Go's `sort.Strings` on paths.
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (path, _) in &sorted {
        if path.contains('\n') {
            return Err(HashError { path: path.clone() });
        }
    }
    Ok(sorted)
}

/// Every file's lowercase hex SHA-256, in path order: the per-file list a
/// re-review diff shows.
pub fn file_digests(files: &[(String, Vec<u8>)]) -> Result<Vec<(String, String)>, HashError> {
    Ok(sorted(files)?
        .into_iter()
        .map(|(path, bytes)| (path.clone(), digest_hex(bytes)))
        .collect())
}

/// The folder's pinned `h1:` hash.
pub fn hash1(files: &[(String, Vec<u8>)]) -> Result<String, HashError> {
    let mut summary = String::new();
    for (path, digest) in file_digests(files)? {
        summary.push_str(&format!("{digest}  {path}\n"));
    }
    let digest = Sha256::digest(summary.as_bytes());
    Ok(format!(
        "h1:{}",
        base64::engine::general_purpose::STANDARD.encode(digest)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// Every regular file under `dir` as `(POSIX-relative path, bytes)`; the
    /// production walker's behavior is proven in `directory.rs`, and this
    /// reader keeps the fixture tests independent of it.
    fn read_fixture(dir: &Path) -> Vec<(String, Vec<u8>)> {
        fn walk(root: &Path, dir: &Path, files: &mut Vec<(String, Vec<u8>)>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    walk(root, &path, files);
                } else {
                    let relative = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    files.push((relative, std::fs::read(&path).unwrap()));
                }
            }
        }
        let mut files = Vec::new();
        walk(dir, dir, &mut files);
        files
    }

    fn fixture_dir(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/test/fixtures/plugins")
            .join(name)
    }

    fn expected(name: &str) -> serde_json::Value {
        let path = fixture_dir(name).with_file_name(format!("{name}.expected.json"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn matches_the_shared_h1_fixture_the_web_implementation_also_matches() {
        let files = read_fixture(&fixture_dir("hash-fixture"));
        let expected = expected("hash-fixture");

        assert_eq!(
            hash1(&files).unwrap(),
            expected["hash"].as_str().unwrap(),
            "the h1: value must equal the fixture the web side pins"
        );
    }

    #[test]
    fn reports_every_file_digest_matching_the_fixture_per_file_list() {
        let files = read_fixture(&fixture_dir("hash-fixture"));
        let expected = expected("hash-fixture");

        let digests: serde_json::Value = file_digests(&files)
            .unwrap()
            .into_iter()
            .map(|(path, digest)| (path, serde_json::Value::String(digest)))
            .collect::<serde_json::Map<_, _>>()
            .into();
        assert_eq!(digests, expected["files"]);
    }

    #[test]
    fn hashes_an_empty_folder_to_the_h1_of_the_empty_summary() {
        // Independent known value: base64(SHA-256("")) with the Go dirhash prefix.
        assert_eq!(
            hash1(&[]).unwrap(),
            "h1:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
        );
    }

    #[test]
    fn is_independent_of_the_order_the_folder_was_listed_in() {
        let files = read_fixture(&fixture_dir("hash-fixture"));
        let mut reversed = files.clone();
        reversed.reverse();

        assert_eq!(hash1(&files).unwrap(), hash1(&reversed).unwrap());
    }

    #[test]
    fn changes_when_one_file_s_bytes_change() {
        let files = read_fixture(&fixture_dir("hash-fixture"));
        let changed: Vec<_> = files
            .iter()
            .map(|(path, bytes)| {
                if path == "index.js" {
                    (path.clone(), b"changed".to_vec())
                } else {
                    (path.clone(), bytes.clone())
                }
            })
            .collect();

        assert_ne!(hash1(&files).unwrap(), hash1(&changed).unwrap());
    }

    #[test]
    fn refuses_a_path_with_a_newline_as_the_shared_contract_pins() {
        let expected = expected("hash-fixture-newline");
        let files: Vec<(String, Vec<u8>)> = expected["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| {
                let path = path.as_str().unwrap().to_string();
                let bytes = format!("contents of {path}").into_bytes();
                (path, bytes)
            })
            .collect();

        let error = hash1(&files).unwrap_err();
        assert_eq!(error.code(), expected["refusal"]["code"].as_str().unwrap());
        assert_eq!(
            error.message(),
            expected["refusal"]["message"].as_str().unwrap()
        );
        assert_eq!(error.path, "data/a\nb.txt");
    }
}
