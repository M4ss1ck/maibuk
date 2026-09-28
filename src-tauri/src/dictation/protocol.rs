use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

// Mirrors src/features/dictation/types.ts. Shared JSON fixtures prove both
// sides serialize the same (src/test/fixtures/dictation/protocol.json).

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Checksum {
    pub algo: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ModelFile {
    pub name: String,
    pub url: String,
    pub bytes: u64,
    pub checksum: Checksum,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Capabilities {
    pub casing: bool,
    pub punctuation: bool,
    pub streaming: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    pub engine: String,
    pub languages: Vec<String>,
    pub tier: String,
    pub platforms: Vec<String>,
    pub files: Vec<ModelFile>,
    pub engine_options: BTreeMap<String, String>,
    pub capabilities: Capabilities,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    MicDenied,
    MicUnavailable,
    ModelMissing,
    ModelCorrupt,
    DownloadFailed,
    DiskFull,
    ModelGone,
    EngineCrashed,
    Unsupported,
    TutorialActive,
    NoTarget,
    Cancelled,
}

/// Rejected commands serialize to `{ code, detail }`; the TS side reads `code`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct DictationError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl DictationError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }
    pub fn code(code: ErrorCode) -> Self {
        Self { code, detail: None }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum DictationEvent {
    Level {
        rms: f32,
    },
    Partial {
        text: String,
    },
    Final {
        text: String,
        #[serde(rename = "latencyMs", skip_serializing_if = "Option::is_none")]
        latency_ms: Option<u32>,
    },
    Error {
        code: ErrorCode,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

/// What the Channel carries: protocol events, then one `stopped` after the
/// last final, so the TS host's stop() resolves only after every event.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum HostMessage {
    Event { event: DictationEvent },
    Stopped,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SupportReport {
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const FIXTURE: &str = include_str!("../../../src/test/fixtures/dictation/protocol.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    fn roundtrip<T: serde::de::DeserializeOwned + Serialize>(value: &Value) -> Value {
        let typed: T = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("{value} does not deserialize: {e}"));
        serde_json::to_value(typed).unwrap()
    }

    // f32 0.25 is exact; a non-dyadic rms in the fixture would need a tolerance.
    #[test]
    fn rust_reads_and_writes_the_same_json_as_typescript() {
        let fixture = fixture();
        assert_eq!(roundtrip::<ModelSpec>(&fixture["spec"]), fixture["spec"]);
        for event in fixture["events"].as_array().unwrap() {
            assert_eq!(&roundtrip::<DictationEvent>(event), event);
        }
        assert_eq!(roundtrip::<DictationError>(&fixture["error"]), fixture["error"]);
    }

    #[test]
    fn every_typescript_error_code_is_a_rust_error_code() {
        for code in fixture()["errorCodes"].as_array().unwrap() {
            assert_eq!(&roundtrip::<ErrorCode>(code), code);
        }
    }

    #[test]
    fn host_messages_serialize_like_the_typescript_host_expects() {
        let msgs = vec![
            HostMessage::Event {
                event: DictationEvent::Partial { text: "a".into() },
            },
            HostMessage::Stopped,
        ];
        assert_eq!(serde_json::to_value(msgs).unwrap(), fixture()["hostMessages"]);
    }
}
