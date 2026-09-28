/// To 16 kHz mono. Same algorithm as src/lib/platform/web/dictation/resampler.ts:
/// box average when downsampling, linear interpolation when upsampling.
pub struct Resampler {
    step: f64,
    pos: f64,
    carry: Vec<f32>,
    passthrough: bool,
}

impl Resampler {
    pub fn new(in_rate: u32) -> Self {
        Self {
            step: in_rate as f64 / 16_000.0,
            pos: 0.0,
            carry: Vec::new(),
            passthrough: in_rate == 16_000,
        }
    }

    pub fn push(&mut self, input: &[f32]) -> Vec<f32> {
        if self.passthrough {
            return input.to_vec();
        }
        let mut buf = std::mem::take(&mut self.carry);
        buf.extend_from_slice(input);
        let mut out = Vec::with_capacity((buf.len() as f64 / self.step) as usize + 1);
        if self.step > 1.0 {
            while self.pos + self.step <= buf.len() as f64 {
                let a = self.pos.floor() as usize;
                let b = (self.pos + self.step).floor() as usize;
                let sum: f32 = buf[a..b].iter().sum();
                out.push(sum / (b - a) as f32);
                self.pos += self.step;
            }
        } else {
            while self.pos + 1.0 < buf.len() as f64 {
                let i = self.pos.floor() as usize;
                let f = (self.pos - i as f64) as f32;
                out.push(buf[i] * (1.0 - f) + buf[i + 1] * f);
                self.pos += self.step;
            }
        }
        let drop = self.pos.floor() as usize;
        self.carry = buf[drop..].to_vec();
        self.pos -= drop as f64;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::Resampler;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        in_rate: u32,
        input: Vec<f32>,
        chunks: Vec<usize>,
        output: Vec<f32>,
    }

    #[test]
    fn matches_the_shared_reference_fed_in_chunks() {
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/dictation/resampler.json"
        ))
        .unwrap();
        for case in cases {
            let mut r = Resampler::new(case.in_rate);
            let mut got = r.push(&case.input[..case.chunks[0]]);
            got.extend(r.push(&case.input[case.chunks[0]..]));
            assert_eq!(got.len(), case.output.len(), "{} Hz length", case.in_rate);
            for (a, b) in got.iter().zip(&case.output) {
                assert!((a - b).abs() < 1e-5, "{} Hz: {a} vs {b}", case.in_rate);
            }
        }
    }
}
