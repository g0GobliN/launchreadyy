//! Hash-parity test: Rust `fnv1a_hex` must match the shared fixture, which is byte-identical to the
//! TypeScript `hashContent` (FNV-1a over UTF-16 code units). The TS side asserts the same fixture in
//! `src/lib/indexer/parity.test.ts`, so both implementations are proven equal transitively — this is
//! what keeps content-addressed cache keys stable across the TS↔Rust boundary.

use launchreadyy_indexer::hash::fnv1a_hex;

#[test]
fn rust_hash_matches_shared_fixture() {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/hash-parity.json"
    ))
    .expect("read hash-parity.json");
    let entries: serde_json::Value = serde_json::from_str(&raw).expect("parse fixture");
    let arr = entries.as_array().expect("fixture is an array");
    assert!(!arr.is_empty(), "fixture must not be empty");
    for e in arr {
        let input = e["input"].as_str().expect("input string");
        let expected = e["hex"].as_str().expect("hex string");
        assert_eq!(
            fnv1a_hex(input),
            expected,
            "hash mismatch for input {input:?}"
        );
    }
}
