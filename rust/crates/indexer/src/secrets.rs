//! Fast secret-candidate pre-filter — mirrors the TS `sweepSecretCandidates`. High-signal patterns
//! only; results are candidates the authoritative secret scanner verifies and reports.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Serialize, Debug, PartialEq)]
pub struct SecretCandidate {
    pub path: String,
    pub line: usize,
    pub kind: String,
}

struct Pattern {
    kind: &'static str,
    re: Regex,
}

fn patterns() -> &'static [Pattern] {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Pattern {
                kind: "aws-access-key",
                re: Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
            },
            Pattern {
                kind: "stripe-secret-key",
                re: Regex::new(r"sk_live_[0-9a-zA-Z]{20,}").unwrap(),
            },
            Pattern {
                kind: "github-token",
                re: Regex::new(r"gh[pousr]_[0-9A-Za-z]{20,}").unwrap(),
            },
            Pattern {
                kind: "private-key-block",
                re: Regex::new(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----").unwrap(),
            },
            Pattern {
                kind: "generic-bearer",
                re: Regex::new(r"(?i)bearer\s+[a-z0-9._-]{20,}").unwrap(),
            },
        ]
    })
}

/// Scan one file's content for secret candidates, capped at `max_per_file` hits.
pub fn sweep(path: &str, content: &str, max_per_file: usize) -> Vec<SecretCandidate> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if out.len() >= max_per_file {
            break;
        }
        for p in patterns() {
            if p.re.is_match(line) {
                out.push(SecretCandidate {
                    path: path.to_string(),
                    line: i + 1,
                    kind: p.kind.to_string(),
                });
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_aws_key_with_line() {
        let content = "const region = 'us-east-1';\nconst key = 'AKIAIOSFODNN7EXAMPLE';";
        let hits = sweep("src/config.ts", content, 20);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].kind, "aws-access-key");
    }

    #[test]
    fn caps_per_file() {
        let line = "token sk_live_abcdefghijklmnopqrstuvwxyz0123456789\n";
        let content = line.repeat(50);
        assert_eq!(sweep("f", &content, 5).len(), 5);
    }

    #[test]
    fn clean_file_has_no_hits() {
        assert!(sweep("a.ts", "export const x = 1;", 20).is_empty());
    }
}
