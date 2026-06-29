import type { WorkerRequest, WorkerResponse } from "@/lib/spellcheck/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nspellInstance: any = null;

function respond(message: WorkerResponse) {
  self.postMessage(message);
}

async function handleInit(lang: string, affUrl: string, dicUrl: string) {
  try {
    const [affResponse, dicResponse] = await Promise.all([fetch(affUrl), fetch(dicUrl)]);

    const aff = await affResponse.text();
    const dic = await dicResponse.text();

    // nspell is CJS; Vite handles the conversion for workers
    const NSpell = (await import("nspell")).default || (await import("nspell"));
    nspellInstance = NSpell(aff, dic);

    respond({ type: "ready" });
  } catch (err) {
    respond({
      type: "error",
      message: `Failed to init spellcheck for "${lang}": ${err}`,
    });
  }
}

function handleCheck(id: number, words: string[]) {
  if (!nspellInstance) {
    respond({ type: "checked", id, misspelled: [] });
    return;
  }

  const misspelled = words.filter((word) => !nspellInstance.correct(word));
  respond({ type: "checked", id, misspelled });
}

function handleSuggest(id: number, word: string) {
  if (!nspellInstance) {
    respond({ type: "suggestions", id, word, suggestions: [] });
    return;
  }

  const suggestions: string[] = nspellInstance.suggest(word);
  respond({ type: "suggestions", id, word, suggestions: suggestions.slice(0, 8) });
}

function handleAddWord(word: string) {
  if (nspellInstance) {
    nspellInstance.add(word);
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      handleInit(msg.lang, msg.affUrl, msg.dicUrl);
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
