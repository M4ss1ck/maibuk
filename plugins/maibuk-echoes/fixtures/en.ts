/**
 * Hand-written English prose, one string per case. Each repeats exactly the
 * words its case is about, so a test can assert the whole result.
 */

/** "harbor" returns three times within a few words: one Nearby echo. */
export const nearbyChain =
  "They reached the harbor at dawn. The harbor smelled of salt. Every harbor holds a secret.";

/** "walked" and "walking" are different inflections of one stem. */
export const stemPair = "She walked along the market road. Walking home, she carried bread.";

/** "Door" and "door" fold to the same word. */
export const caseFolding = "The Door creaked open. Beyond it, a door slammed shut.";

/** Only short words and stop words repeat, so nothing is ever eligible. */
export const shortAndStopWords = "The cat sat. The cat ran.";

/** A stop word and a plain word repeat; a language with no stop words still shows them. */
export const limitedSupport = "They walked to the river. They walked to the river again.";

/** "the old lighthouse" returns twice: one Repeated phrase. */
export const phraseTwice =
  "The old lighthouse stood at the cliff edge. Beyond the fence, the old lighthouse watched the sea.";

/** The same three words appear once, so no Repeated phrase is reported. */
export const phraseOnce =
  "The old lighthouse stood at the cliff edge. Beyond the fence, a keeper trimmed the lamp.";

/** "and then the" is stop words only; it returns three times and is never a Repeated phrase. */
export const phraseStopWords =
  "And then the rain came. And then the wind rose. And then the river swelled.";

/**
 * "the old lighthouse keeper waited" appears twice; its inner phrases appear only
 * inside it, except "the old lighthouse", which also stands twice on its own.
 */
export const phraseContainment =
  "The old lighthouse keeper waited beside the door. Again the old lighthouse keeper waited by the shore. The old lighthouse stood empty. Beyond the dunes, the old lighthouse gleamed.";

/** "ha" with no gap: the overlapping runs are the same phrase seen once. */
export const phraseOverlap = "ha ha ha ha ha";
