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
export const shortAndStopWords = "Go to the inn. Go to the inn again.";

/** A stop word and a plain word repeat; a language with no stop words still shows them. */
export const limitedSupport = "They walked to the river. They walked to the river again.";
