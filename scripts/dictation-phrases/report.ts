// The Dictation phrase conformance report (issue #285): pure over model
// scores, so the gate lane tests the bars without a model.
import type { ModelSpec } from "@/features/dictation/types";
import {
  SHIP_BAR_HIT_RATE,
  SHIP_BAR_LANGUAGES,
  type ModelScore,
  type PhraseScore,
} from "@/test/support/dictation-phrase-score";
export interface ScoredModel {
  spec: Pick<ModelSpec, "id" | "tier" | "languages">;
  clipCount: number;
  score: ModelScore;
}

export interface Report {
  markdown: string;
  /** Every failed bar; empty means the ship gate passes. */
  failures: string[];
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const cell = (text: string) => text.replace(/\|/g, "\\|") || "(nothing)";

function label(phrase: PhraseScore): string {
  const row = phrase.row;
  if (row.kind === "voice") return row.split.id;
  if (row.kind === "voice_that") return row.id;
  return row.entry.id;
}

/** The ship bars one model fails (issue #285); empty when it passes. */
export function failedBars({ spec, score }: ScoredModel): string[] {
  const failed: string[] = [];
  if (score.missingItems.length) failed.push(`${score.missingItems.length} clips missing`);
  if (
    spec.tier === "accurate" &&
    SHIP_BAR_LANGUAGES.includes(score.language) &&
    score.hitRate < SHIP_BAR_HIT_RATE
  ) {
    failed.push(`hit rate ${pct(score.hitRate)} < ${pct(SHIP_BAR_HIT_RATE)}`);
  }
  // A sentence that runs something on its own text is a command said alone,
  // which the whole-line rule runs by design (ADR 0015); only a mishearing
  // that turns prose into an action fails.
  if (score.misheardProseTriggers > 0) {
    failed.push(`${score.misheardProseTriggers} misheard prose triggers`);
  }
  return failed;
}

export function renderReport(models: readonly ScoredModel[]): Report {
  const failures: string[] = [];
  const out: string[] = ["# Dictation phrase conformance", ""];
  out.push(
    `Ship bar: every Accurate model of ${SHIP_BAR_LANGUAGES.join(", ")} hears at least ${pct(SHIP_BAR_HIT_RATE)} of the default phrases, and no model mishears a prose sentence into an action.`,
    "",
    "Prose triggers count every take that ran something; *misheard* are the ones on sentences that type as text when heard right, and only those fail the bar.",
    "",
    "| Model | Tier | Clips | Hit rate | Voice Commands | Spoken Punctuation | Prose triggers (misheard) | Bar |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const model of models) {
    const { spec, clipCount, score } = model;
    const own = failedBars(model);
    for (const failure of own) failures.push(`${spec.id}: ${failure}`);
    out.push(
      `| ${spec.id} | ${spec.tier} | ${clipCount} | ${pct(score.hitRate)} | ${pct(score.voiceRate)} | ${pct(score.punctuationRate)} | ${score.proseTriggers} (${score.misheardProseTriggers}) | ${own.length ? "FAIL" : "pass"} |`
    );
  }

  for (const language of [...new Set(models.map((model) => model.score.language))]) {
    const ofLanguage = models.filter((model) => model.score.language === language);
    const accurate = ofLanguage.filter((model) => model.spec.tier === "accurate");

    out.push("", `## ${language}: under the bar on Accurate`, "");
    if (!SHIP_BAR_LANGUAGES.includes(language)) {
      out.push("Reported, not gated: this language is outside the ship bar.", "");
    }
    const under = accurate.flatMap((model) =>
      model.score.phrases
        .filter((phrase) => phrase.rate < SHIP_BAR_HIT_RATE)
        .map((phrase) => ({ model, phrase }))
    );
    if (under.length === 0) {
      out.push("None.");
    } else {
      out.push(
        "Each needs a heard form or removal (issue #285). An inferred row fails because its verb or target was misheard in another clip.",
        "",
        "| Phrase | For | Source | Rate | Heard |",
        "| --- | --- | --- | --- | --- |"
      );
      for (const { phrase } of under) {
        const heard = phrase.evidence.map((take) => cell(take.heard)).join("; ") || "—";
        out.push(
          `| ${phrase.row.phrase} | ${label(phrase)} | ${phrase.source} | ${pct(phrase.rate)} | ${heard} |`
        );
      }
    }

    out.push("", `## ${language}: prose`, "");
    out.push(
      `| Sentence | Fires on its text | ${ofLanguage.map((model) => model.spec.id).join(" | ")} |`,
      `| --- | --- | ${ofLanguage.map(() => "---").join(" | ")} |`
    );
    const prose = ofLanguage[0]?.score.prose ?? [];
    for (const [index, row] of prose.entries()) {
      const perModel = ofLanguage.map(({ score }) => {
        const own = score.prose[index];
        const heard = own.heard.map(cell).join("; ");
        return `${own.triggered}/${own.takes} ${heard ? `(${heard})` : ""}`.trim();
      });
      out.push(`| ${row.item.say} | ${row.firesOnText ? "yes" : "no"} | ${perModel.join(" | ")} |`);
    }

    out.push("", `## ${language}: every default phrase`, "");
    out.push(
      `| Phrase | For | Source | ${ofLanguage.map((model) => model.spec.id).join(" | ")} |`,
      `| --- | --- | --- | ${ofLanguage.map(() => "---").join(" | ")} |`
    );
    const rows = ofLanguage[0]?.score.phrases ?? [];
    for (const [index, phrase] of rows.entries()) {
      const rates = ofLanguage.map(({ score }) => pct(score.phrases[index].rate));
      out.push(
        `| ${phrase.row.phrase} | ${label(phrase)} | ${phrase.source} | ${rates.join(" | ")} |`
      );
    }

    out.push("", `## ${language}: App phrases`, "");
    out.push(
      "Whole-line app phrases, one clip each: a clip hits when it comes back as one line that runs what the script line runs. Missing clips are reported as not recorded and never fail the bar.",
      "",
      `| Say | Expected | ${ofLanguage.map((model) => model.spec.id).join(" | ")} |`,
      `| --- | --- | ${ofLanguage.map(() => "---").join(" | ")} |`
    );
    const app = ofLanguage[0]?.score.app ?? [];
    if (app.length === 0) {
      out.push("None.");
    } else {
      for (const [index, row] of app.entries()) {
        const perModel = ofLanguage.map(({ score }) => {
          const own = score.app[index];
          if (!own || own.takes === 0) return "not recorded";
          const heard = own.heard.map(cell).join("; ");
          return `${pct(own.rate)} (${heard || "(nothing)"})`;
        });
        out.push(`| ${row.item.say} | ${row.expected} | ${perModel.join(" | ")} |`);
      }
    }
  }

  if (failures.length) out.push("", "## Failed bars", "", ...failures.map((f) => `- ${f}`));
  return { markdown: `${out.join("\n")}\n`, failures };
}
