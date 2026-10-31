//! The tray's Resource Usage lines, worded in the app language.
//!
//! The frontend sends each line as a template with a `{value}` placeholder
//! (`"CPU {value}"`) plus the locale's decimal separator; Rust fills in the
//! numbers, so a sample never has to cross the IPC bridge to be shown.

use serde::Deserialize;

const MIB: f64 = 1024.0 * 1024.0;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Labels {
    pub show: String,
    pub quit: String,
    pub cpu: String,
    pub ram: String,
    pub storage: String,
    pub app: String,
    pub data: String,
    pub backups: String,
    pub plugins: String,
    /// Shown in place of a number that could not be read.
    pub unknown: String,
    pub decimal_separator: String,
}

impl Default for Labels {
    /// English, for the tray built before the frontend reports its language.
    fn default() -> Self {
        Self {
            show: "Show Maibuk".into(),
            quit: "Quit".into(),
            cpu: "CPU {value}".into(),
            ram: "RAM {value}".into(),
            storage: "Storage {value}".into(),
            app: "App {value}".into(),
            data: "Data {value}".into(),
            backups: "Backups {value}".into(),
            plugins: "Plugins {value}".into(),
            unknown: "—".into(),
            decimal_separator: ".".into(),
        }
    }
}

impl Labels {
    /// `share` is the fraction of the whole machine, 0.0 to 1.0.
    pub fn cpu_line(&self, share: Option<f64>) -> String {
        let value = share.map(|share| format!("{}%", (share * 100.0).clamp(0.0, 100.0).round()));
        self.fill(&self.cpu, value)
    }

    /// Bytes in use and their fraction of the machine's RAM.
    pub fn ram_line(&self, ram: Option<(u64, f64)>) -> String {
        let value = ram.map(|(bytes, share)| {
            let percent = self.one_decimal((share * 100.0).clamp(0.0, 100.0));
            format!("{} ({percent}%)", self.size(bytes))
        });
        self.fill(&self.ram, value)
    }

    pub fn size_line(&self, template: &str, bytes: Option<u64>) -> String {
        self.fill(template, bytes.map(|bytes| self.size(bytes)))
    }

    /// 1024-based: whole MB below 1 GB, GB with one decimal from there.
    pub fn size(&self, bytes: u64) -> String {
        let mb = (bytes as f64 / MIB).round();
        if mb < 1024.0 {
            format!("{mb} MB")
        } else {
            format!("{} GB", self.one_decimal(bytes as f64 / MIB / 1024.0))
        }
    }

    fn one_decimal(&self, value: f64) -> String {
        format!("{value:.1}").replace('.', &self.decimal_separator)
    }

    fn fill(&self, template: &str, value: Option<String>) -> String {
        template.replace("{value}", value.as_deref().unwrap_or(&self.unknown))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * MB;

    fn spanish() -> Labels {
        Labels {
            show: "Mostrar Maibuk".into(),
            quit: "Salir".into(),
            cpu: "CPU {value}".into(),
            ram: "RAM {value}".into(),
            storage: "Almacenamiento {value}".into(),
            app: "Aplicación {value}".into(),
            data: "Datos {value}".into(),
            backups: "Copias de seguridad {value}".into(),
            plugins: "Plugins {value}".into(),
            unknown: "—".into(),
            decimal_separator: ",".into(),
        }
    }

    #[test]
    fn cpu_is_a_whole_percent_of_the_machine() {
        let en = Labels::default();
        assert_eq!(en.cpu_line(Some(0.034)), "CPU 3%");
        assert_eq!(en.cpu_line(Some(0.0)), "CPU 0%");
        assert_eq!(
            en.cpu_line(Some(1.2)),
            "CPU 100%",
            "rounding noise never passes 100"
        );
        assert_eq!(en.cpu_line(None), "CPU —");
    }

    #[test]
    fn ram_shows_size_and_one_decimal_share_in_the_locale() {
        let ram = Some((412 * MB, 0.026));
        assert_eq!(Labels::default().ram_line(ram), "RAM 412 MB (2.6%)");
        assert_eq!(spanish().ram_line(ram), "RAM 412 MB (2,6%)");
        assert_eq!(spanish().ram_line(None), "RAM —");
    }

    #[test]
    fn sizes_are_whole_mb_below_a_gigabyte_and_one_decimal_gb_above() {
        let en = Labels::default();
        assert_eq!(en.size(0), "0 MB");
        assert_eq!(en.size(98 * MB), "98 MB");
        assert_eq!(en.size(1023 * MB), "1023 MB");
        assert_eq!(
            en.size(GB - 1),
            "1.0 GB",
            "1023.99 MB rounds into the GB form"
        );
        assert_eq!(en.size(GB * 14 / 10), "1.4 GB");
        assert_eq!(spanish().size(GB * 12 / 10), "1,2 GB");
    }

    #[test]
    fn a_storage_line_that_could_not_be_read_shows_the_dash() {
        let es = spanish();
        assert_eq!(
            es.size_line(&es.backups, Some(610 * MB)),
            "Copias de seguridad 610 MB"
        );
        assert_eq!(es.size_line(&es.data, None), "Datos —");
    }
}
