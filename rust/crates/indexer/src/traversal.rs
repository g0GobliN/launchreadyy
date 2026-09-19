//! Directory traversal and file filtering.
//!
//! `should_index` is a pure path filter available in every build (native + wasm). `walk_dir` is a
//! native-only filesystem walk (std::fs isn't available on `wasm32-unknown-unknown`); the Worker
//! passes file contents in directly, so it never needs the walker.

/// Directory names never worth indexing (matched as a path segment).
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    "vendor",
    "coverage",
    ".turbo",
    ".cache",
    "__pycache__",
];

/// File extensions that are binary/asset/generated and never indexed.
const SKIP_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "woff", "woff2", "ttf", "eot", "mp4", "mov",
    "webm", "mp3", "wav", "pdf", "zip", "gz", "tar", "map", "wasm", "bin", "exe", "dll", "so",
    "dylib", "lock",
];

/// Return the lowercase extension of a path's final segment, if any.
fn extension(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => Some(&name[i + 1..]),
        _ => None,
    }
}

/// Whether a repo-relative path (file or directory) should be indexed.
pub fn should_index(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    for dir in SKIP_DIRS {
        if lower == *dir
            || lower.starts_with(&format!("{dir}/"))
            || lower.contains(&format!("/{dir}/"))
        {
            return false;
        }
    }
    if lower.ends_with(".min.js") || lower.ends_with(".min.css") {
        return false;
    }
    if let Some(ext) = extension(&lower) {
        if SKIP_EXTS.contains(&ext) {
            return false;
        }
    }
    true
}

/// Recursively list indexable repo-relative file paths under `root` (native builds only).
#[cfg(not(target_arch = "wasm32"))]
pub fn walk_dir(root: &std::path::Path) -> std::io::Result<Vec<String>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                if should_index(&rel) {
                    stack.push(path);
                }
            } else if should_index(&rel) {
                out.push(rel);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_vendor_dirs_and_binaries() {
        assert!(!should_index("node_modules/react/index.js"));
        assert!(!should_index("src/vendor/lib.js"));
        assert!(!should_index("dist/bundle.js"));
        assert!(!should_index("assets/logo.png"));
        assert!(!should_index("app.min.js"));
        assert!(!should_index("yarn.lock"));
    }

    #[test]
    fn indexes_source() {
        assert!(should_index("src/app.ts"));
        assert!(should_index("cmd/server/main.go"));
        assert!(should_index("Makefile"));
    }
}
