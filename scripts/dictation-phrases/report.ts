// The Dictation phrase conformance report (issue #285): pure over model
// scores, so the gate lane tests the bars without a model.
import type { ModelSpec } from "@/features/dictation/types";
import {
  SHIP_BAR_HIT_RATE,
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
  return phrase.row.kind === "voice" ? phrase.row.split.id : phrase.row.entry.id;
}

export function renderReport(models: readonly ScoredModel[]): Report {
  const failures: string[] = [];
  const out: string[] = ["# Dictation phrase conformance", ""];
  out.push(
    `Ship bar: every Accurate model hears at least ${pct(SHIP_BAR_HIT_RATE)} of the default phrases, and no model runs anything on the prose set.`,
    "",
    "| Model | Tier | Clips | Hit rate | Prose triggers | Bar |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const { spec, clipCount, score } of models) {
    const own: string[] = [];
    if (score.missingItems.length) own.push(`${score.missingItems.length} clips missing`);
    if (spec.tier === "accurate" && score.hitRate < SHIP_BAR_HIT_RATE) {
      own.push(`hit rate ${pct(score.hitRate)} < ${pct(SHIP_BAR_HIT_RATE)}`);
    }
    if (score.proseTriggers > 0) own.push(`${score.proseTriggers} prose triggers`);
    for (const failure of own) failures.push(`${spec.id}: ${failure}`);
    out.push(
      `| ${spec.id} | ${spec.tier} | ${clipCount} | ${pct(score.hitRate)} | ${score.proseTriggers} | ${own.length ? "FAIL" : "pass"} |`
    );
  }

  for (const language of [...new Set(models.map((model) => model.score.language))]) {
    const ofLanguage = models.filter((model) => model.score.language === language);
    const accurate = ofLanguage.filter((model) => model.spec.tier === "accurate");

    out.push("", `## ${language}: under the bar on Accurate`, "");
    const under = accurate.flatMap((model) =>
      model.score.phrases
        .filter((phrase) => phrase.rate < SHIP_BAR_HIT_RATE)
        .map((phrase) => ({ model, phrase }))
    );
    if (under.length === 0) {
      out.push("None.");
    } else {
      out.push(
        "Each needs an alias default or removal (issue #285). An inferred row fails because its verb or target was misheard in another clip.",
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
  }

  if (failures.length) out.push("", "## Failed bars", "", ...failures.map((f) => `- ${f}`));
  return { markdown: `${out.join("\n")}\n`, failures };
}
