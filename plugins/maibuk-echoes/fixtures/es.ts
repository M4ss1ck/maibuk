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
export const shortAndStopWords = "La sal fina. La sal gruesa.";

/** "mamá" and "mama" differ only by an accent. */
export const accentPair = "Su mamá cocinaba. La mama del niño dormía.";

/** A stop word and a plain word repeat; a language with no stop words still shows them. */
export const limitedSupport = "Esta casa tiene esta ventana.";

/** "la casa vieja" returns twice: one Repeated phrase. */
export const phraseTwice =
  "La casa vieja estaba al borde del acantilado. Tras la valla, la casa vieja miraba el mar.";

/** The same three words appear once, so no Repeated phrase is reported. */
export const phraseOnce =
  "La casa vieja estaba al borde del acantilado. Tras la valla, un guardián limpiaba la lámpara.";

/** "de la que" is stop words only; it returns three times and is never a Repeated phrase. */
export const phraseStopWords = "De la que hablaban, de la que escribían, de la que callaban.";

/**
 * "el viejo farero esperaba junto" appears twice; its inner phrases appear only
 * inside it, except "el viejo farero", which also stands twice on its own.
 */
export const phraseContainment =
  "El viejo farero esperaba junto a la puerta. De nuevo el viejo farero esperaba junto al muelle. El viejo farero estaba vacío. Más allá de las dunas, el viejo farero brillaba.";

/** "ja" with no gap: the overlapping runs are the same phrase seen once. */
export const phraseOverlap = "ja ja ja ja ja";
