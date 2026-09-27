| Path | Model | First partial from onset p50 / p95 (s) | Final line p50 / p95 (ms) | Compute | Memory | Load (ms) | Long tasks > 50 ms | Typing event max (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Web (Chromium, WASM worker) | small-streaming-en | 0.58 / 0.84 | 101.3 / 210.9 | 40.8% (worker pass time) | +890 MB (browser total) | 3708 | 0 | 16 |
| Web (Chromium, WASM worker) | small-streaming-es | 0.64 / 1.04 | 93.2 / 175.9 | 23.4% (worker pass time) | +812 MB (browser total) | 3124 | 0 | 16 |
| Web (Chromium, WASM worker) | tiny-streaming-en | 0.58 / 0.66 | 33.3 / 122.8 | 15.8% (worker pass time) | +512 MB (browser total) | 1342 | 0 | 16 |
| Web (Chromium, WASM worker) | tiny-streaming-es | 0.88 / 1.22 | 111.1 / 140.1 | 8.5% (worker pass time) | +556 MB (browser total) | 1072 | 0 | 16 |
| Linux native CLI (release) | small-streaming-en | 0.42 / 0.6 | 260.2 / 594.7 | 58.2% of one core | 477 MB peak RSS | 203 | n/a | n/a |
| Linux native CLI (release) | small-streaming-es | 0.46 / 0.84 | 184.7 / 268.3 | 31.6% of one core | 387 MB peak RSS | 192 | n/a | n/a |
| Linux native CLI (release) | tiny-streaming-en | 0.44 / 0.58 | 150 / 298.1 | 39.9% of one core | 219 MB peak RSS | 80 | n/a | n/a |
| Linux native CLI (release) | tiny-streaming-es | 0.84 / 1.22 | 122.8 / 215.7 | 7.3% of one core | 155 MB peak RSS | 75 | n/a | n/a |
| Tauri shell, Linux (debug build) | small-streaming-es | 0.42 / 0.74 | 103 / 159 | 54.7% of one core (whole app) | 555 MB peak RSS (whole app) | 203 | API absent | not driven |
| Tauri shell, Linux (debug build) | tiny-streaming-en | 0.34 / 0.4 | 111.8 / 148.7 | 64.9% of one core (whole app) | 396 MB peak RSS (whole app) | 87 | API absent | not driven |
| Tauri shell, Linux (debug build) | tiny-streaming-es | 0.84 / 1.08 | 53.6 / 113.6 | 13.2% of one core (whole app) | 325 MB peak RSS (whole app) | 81 | API absent | not driven |

| Linux native, Tiny en | CPU (% of one core) | Pass p95 (ms) | First partial from onset p50 (s) | Final p50 / p95 (ms) |
| --- | --- | --- | --- | --- |
| default ORT threads, transcription_interval=0.5 | 496.3 | 263.8 | 0.62 | 373.2 / 672.3 |
| default ORT threads, transcription_interval=0.2 | 701.3 | 228 | 0.44 | 162 / 940.1 |
| MOONSHINE_ORT_SINGLE_THREAD=1, transcription_interval=0.5 | 28.6 | 177.5 | 0.5 | 309.3 / 555.1 |
| MOONSHINE_ORT_SINGLE_THREAD=1, transcription_interval=0.2 | 39.9 | 168.1 | 0.44 | 150 / 298.1 |
