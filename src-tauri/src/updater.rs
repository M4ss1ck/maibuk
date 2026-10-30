//! The Update feed override for debug builds (ADR 0037).
//!
//! `MAIBUK_UPDATER_ENDPOINT` points a debug build at a local `latest.json`, so
//! a full Update can be tested against a locally signed build without
//! publishing a Release. The function is compiled only under
//! `cfg(debug_assertions)`; a release build has no code that reads the
//! variable, so nothing in a user's environment can redirect their Update.

#[cfg(debug_assertions)]
pub fn apply_endpoint_override(config: &mut tauri::Config, endpoint: Option<String>) {
    let Some(endpoint) = endpoint.filter(|value| !value.is_empty()) else {
        return;
    };
    let Some(updater) = config.plugins.0.get_mut("updater") else {
        return;
    };
    if let Some(object) = updater.as_object_mut() {
        object.insert("endpoints".into(), serde_json::json!([endpoint]));
        // A local test feed is plain http.
        object.insert("dangerousInsecureTransportProtocol".into(), true.into());
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;

    fn config_with_updater() -> tauri::Config {
        let mut config = tauri::Config::default();
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({ "pubkey": "k", "endpoints": ["https://example.com/latest.json"] }),
        );
        config
    }

    #[test]
    fn override_replaces_the_endpoints() {
        let mut config = config_with_updater();
        apply_endpoint_override(&mut config, Some("http://127.0.0.1:8123/latest.json".into()));
        let updater = &config.plugins.0["updater"];
        assert_eq!(updater["endpoints"], serde_json::json!(["http://127.0.0.1:8123/latest.json"]));
        assert_eq!(updater["dangerousInsecureTransportProtocol"], true);
        assert_eq!(updater["pubkey"], "k");
    }

    #[test]
    fn no_override_leaves_the_config_alone() {
        let mut config = config_with_updater();
        apply_endpoint_override(&mut config, None);
        apply_endpoint_override(&mut config, Some(String::new()));
        assert_eq!(
            config.plugins.0["updater"]["endpoints"],
            serde_json::json!(["https://example.com/latest.json"])
        );
    }
}
