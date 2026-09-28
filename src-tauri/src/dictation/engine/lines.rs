use std::collections::HashSet;

use crate::dictation::protocol::DictationEvent;

/// Moonshine's one-mutable-line model mapped to partials and immutable finals.
#[derive(Default)]
pub struct LineMapper {
    finished: HashSet<u64>,
    last_partial: String,
}

pub struct LineView<'a> {
    pub id: u64,
    pub text: &'a str,
    pub is_complete: bool,
    pub has_text_changed: bool,
    pub latency_ms: u32,
}

impl LineMapper {
    pub fn reset(&mut self) {
        self.finished.clear();
        self.last_partial.clear();
    }

    pub fn map(&mut self, line: LineView, out: &mut Vec<DictationEvent>) {
        if self.finished.contains(&line.id) {
            return;
        }
        let text = line.text.trim();
        if line.is_complete {
            self.finished.insert(line.id);
            self.last_partial.clear();
            if !text.is_empty() {
                out.push(DictationEvent::Final {
                    text: text.to_string(),
                    latency_ms: Some(line.latency_ms),
                });
            }
        } else if line.has_text_changed && !text.is_empty() && text != self.last_partial {
            self.last_partial = text.to_string();
            out.push(DictationEvent::Partial {
                text: text.to_string(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(id: u64, text: &str, complete: bool) -> LineView<'_> {
        LineView {
            id,
            text,
            is_complete: complete,
            has_text_changed: true,
            latency_ms: 30,
        }
    }

    #[test]
    fn partials_then_one_final_per_line() {
        let mut m = LineMapper::default();
        let mut out = Vec::new();
        m.map(view(1, "hola", false), &mut out);
        m.map(view(1, "hola", false), &mut out);
        m.map(view(1, " hola mundo ", true), &mut out);
        m.map(view(1, "hola mundo", true), &mut out);
        m.map(view(1, "late", false), &mut out);
        assert_eq!(
            out,
            vec![
                DictationEvent::Partial {
                    text: "hola".into()
                },
                DictationEvent::Final {
                    text: "hola mundo".into(),
                    latency_ms: Some(30)
                },
            ]
        );
    }

    #[test]
    fn empty_lines_emit_nothing() {
        let mut m = LineMapper::default();
        let mut out = Vec::new();
        m.map(view(2, "  ", true), &mut out);
        assert!(out.is_empty());
    }
}
