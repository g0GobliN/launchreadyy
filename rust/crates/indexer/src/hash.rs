//! FNV-1a content hashing.
//!
//! Iterates UTF-16 code units so the output is byte-for-byte identical to the TypeScript
//! `hashContent` (which uses `charCodeAt`). This parity keeps content-addressed cache keys stable
//! whether the TS or the Rust path produced them.

/// FNV-1a over UTF-16 code units, returned as 8-char lowercase hex.
pub fn fnv1a_hex(s: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for unit in s.encode_utf16() {
        h ^= unit as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{:08x}", h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_and_distinct() {
        assert_eq!(fnv1a_hex("hello"), fnv1a_hex("hello"));
        assert_ne!(fnv1a_hex("hello"), fnv1a_hex("hello!"));
        assert_eq!(fnv1a_hex("").len(), 8);
    }
}
