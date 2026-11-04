import { type Hunspell, loadModule } from "hunspell-asm/dist/cjs/index.js";
import type { WorkerRequest, WorkerResponse } from "@/lib/spellcheck/types";

let hunspell: Hunspell | null = null;

function respond(message: WorkerResponse) {
  self.postMessage(message);
}

async function handleInit(lang: string, aff: Uint8Array, dic: Uint8Array) {
  try {
    const factory = await loadModule();
    const affPath = factory.mountBuffer(aff, "index.aff");
    const dicPath = factory.mountBuffer(dic, "index.dic");
    hunspell = factory.create(affPath, dicPath);

    respond({ type: "ready" });
  } catch (err) {
    respond({
      type: "error",
      message: `Failed to init spellcheck for "${lang}": ${err}`,
    });
  }
}

function handleCheck(id: number, words: string[]) {
  const engine = hunspell;
  const misspelled = engine ? words.filter((word) => !engine.spell(word)) : [];
  respond({ type: "checked", id, misspelled });
}

function handleSuggest(id: number, word: string) {
  const suggestions = hunspell?.suggest(word).slice(0, 8) ?? [];
  respond({ type: "suggestions", id, word, suggestions });
}

function handleAddWord(word: string) {
  hunspell?.addWord(word);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      handleInit(msg.lang, msg.aff, msg.dic);
      break;
    case "check":
      handleCheck(msg.id, msg.words);
      break;
    case "suggest":
      handleSuggest(msg.id, msg.word);
      break;
    case "addWord":
      handleAddWord(msg.word);
      break;
  }
};
