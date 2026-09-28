use base64::Engine as _;

/// CRC32C (Castagnoli), as Moonshine publishes per file: base64 of 4 big-endian bytes.
pub struct Crc32c {
    crc: u32,
}

const fn table() -> [u32; 256] {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                (c >> 1) ^ 0x82F6_3B78
            } else {
                c >> 1
            };
            k += 1;
        }
        t[i] = c;
        i += 1;
    }
    t
}
static TABLE: [u32; 256] = table();

impl Crc32c {
    pub fn new() -> Self {
        Self { crc: 0xFFFF_FFFF }
    }
    pub fn update(&mut self, bytes: &[u8]) {
        let mut c = self.crc;
        for &b in bytes {
            c = TABLE[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
        }
        self.crc = c;
    }
    pub fn digest_base64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode((self.crc ^ 0xFFFF_FFFF).to_be_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::Crc32c;

    #[derive(serde::Deserialize)]
    struct Vector {
        hex: String,
        crc32c: String,
    }

    #[test]
    fn matches_the_shared_vectors() {
        let vectors: Vec<Vector> = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/dictation/crc32c.json"
        ))
        .unwrap();
        for v in vectors {
            let bytes: Vec<u8> = (0..v.hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&v.hex[i..i + 2], 16).unwrap())
                .collect();
            let mut crc = Crc32c::new();
            let (a, b) = bytes.split_at(bytes.len() / 2);
            crc.update(a);
            crc.update(b);
            assert_eq!(crc.digest_base64(), v.crc32c);
        }
    }
}
