# Vendored Snowball

Official Snowball stemmers and stop word lists for English and Spanish, used by
Echoes to match words that share a stem. BSD-3-Clause, see `COPYING`.

| File | Source |
| --- | --- |
| `base-stemmer.js` | `javascript/base-stemmer.js` from snowballstem/snowball `v3.1.1` |
| `english-stemmer.js`, `spanish-stemmer.js` | generated from `algorithms/<lang>.sbl` at `v3.1.1` |
| `stop-words.ts` | `algorithms/<lang>/stop.txt` from snowballstem/snowball-website `a5c23fcf` |

The npm ports bundle every language in one 850 KB file, over the Plugin's
150 KB gzip budget; these three files are about 9 KB gzip.

Do not edit the `.js` files. To regenerate the stemmers:

```bash
git clone --depth 1 --branch v3.1.1 https://github.com/snowballstem/snowball.git
cd snowball && make snowball
./snowball algorithms/english.sbl -js -o english-stemmer
./snowball algorithms/spanish.sbl -js -o spanish-stemmer
cp javascript/base-stemmer.js english-stemmer.js spanish-stemmer.js <this folder>
```
