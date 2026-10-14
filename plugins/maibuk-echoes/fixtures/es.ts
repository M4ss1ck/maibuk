/**
 * Hand-written Spanish prose, one string per case. Each repeats exactly the
 * words its case is about, so a test can assert the whole result.
 */

/** "puerto" returns three times within a few words: one Nearby echo. */
export const nearbyChain =
  "Llegaron al puerto al amanecer. El puerto olía a sal. Cada puerto guarda un secreto.";

/** "puerta" and "puertas" are different inflections of one stem. */
export const stemPair = "Abrió la puerta despacio. Las puertas crujieron.";

/** "Puerta" and "puerta" fold to the same word. */
export const caseFolding = "La Puerta estaba abierta. Una puerta cerrada esperaba.";

/** Only short words and stop words repeat, so nothing is ever eligible. */
export const shortAndStopWords = "Ve a la luz. Ve a la luz otra vez.";

/** "mamá" and "mama" differ only by an accent. */
export const accentPair = "Su mamá cocinaba. La mama del niño dormía.";

/** A stop word and a plain word repeat; a language with no stop words still shows them. */
export const limitedSupport = "Esta casa tiene esta ventana.";
