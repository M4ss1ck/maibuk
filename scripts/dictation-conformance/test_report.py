# Tests for the conformance report and the onset matching rule.
#   python3 -m unittest discover -s scripts/dictation-conformance
import contextlib
import io
import json
import os
import struct
import tempfile
import unittest
import wave
from unittest import mock

import onsets
import report


def write_wav(path, segments, rate=16000):
    """segments: list of ``(seconds, amplitude)``, mono 16-bit."""
    frames = bytearray()
    for seconds, amplitude in segments:
        frames += struct.pack("<h", amplitude) * int(seconds * rate)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


class OnsetMatchingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.wav = os.path.join(self.tmp.name, "synth.wav")
        # 1 s silence, 1 s speech, 1 s silence, 1 s speech, 1 s silence.
        write_wav(
            self.wav,
            [(1.0, 0), (1.0, 1000), (1.0, 0), (1.0, 1000), (1.0, 0)],
        )

    def test_onsets_are_speech_after_300ms_of_silence(self):
        self.assertEqual(onsets.onsets(self.wav), [1.0, 3.0])

    def test_matching_uses_interval_after_previous_completed(self):
        trace = [
            {"firstTextAudio": 1.4, "completedAudio": 2.0},
            {"firstTextAudio": 3.3, "completedAudio": 4.0},
        ]
        lags = onsets.first_partial_lags(self.wav, trace)
        self.assertEqual(len(lags), 2)
        self.assertAlmostEqual(lags[0], 0.4, places=6)
        self.assertAlmostEqual(lags[1], 0.3, places=6)

    def test_picks_the_last_candidate(self):
        # Two onsets (1.0 and 3.0) fall before firstTextAudio; the last wins.
        lags = onsets.first_partial_lags(
            self.wav, [{"firstTextAudio": 3.3, "completedAudio": 4.0}]
        )
        self.assertEqual(len(lags), 1)
        self.assertAlmostEqual(lags[0], 0.3, places=6)

    def test_skips_entries_whose_line_began_mid_speech(self):
        trace = [
            {"firstTextAudio": 3.0, "completedAudio": 3.1},
            {"firstTextAudio": 3.2, "completedAudio": 3.5},
        ]
        # The second entry has no onset in (3.1, 3.2].
        self.assertEqual(onsets.first_partial_lags(self.wav, trace), [0.0])

    def test_skips_null_first_text(self):
        self.assertEqual(
            onsets.first_partial_lags(
                self.wav, [{"firstTextAudio": None, "completedAudio": 2.0}]
            ),
            [],
        )


def analysis(**overrides):
    base = {
        "backend": "web",
        "model": "moonshine-tiny-en-260821",
        "first_partial_p50": 0.4,
        "first_partial_p95": 0.6,
        "final_p50_ms": 100.0,
        "final_p95_ms": 200.0,
        "cpu_pct": None,
        "long_tasks": 0,
        "typing_max_ms": 10,
        "load_ms": 1000,
        "contract": [],
        "bars": {},
    }
    base.update(overrides)
    return base


def native_analysis(**overrides):
    defaults = {
        "backend": "native",
        "model": "moonshine-tiny-en-260821",
        "cpu_pct": 20,
        "long_tasks": None,
        "typing_max_ms": None,
    }
    defaults.update(overrides)
    return analysis(**defaults)


class BarsTest(unittest.TestCase):
    def test_passing_set_has_no_failures(self):
        self.assertEqual(report.evaluate_bars([analysis(), native_analysis()]), [])

    def test_failing_final_latency_fails(self):
        failures = report.evaluate_bars([analysis(final_p50_ms=350.0)])
        self.assertTrue(any("final" in failure for failure in failures))

    def test_tiny_es_first_partial_over_bar_is_recorded_not_failed(self):
        es = analysis(
            model="moonshine-tiny-es-260824",
            first_partial_p50=1.2,
            first_partial_p95=1.5,
        )
        self.assertEqual(report.evaluate_bars([es]), [])
        self.assertEqual(es["bars"]["first_partial_p50"], "recorded")

    def test_typing_max_over_bar_fails_on_web(self):
        failures = report.evaluate_bars([analysis(typing_max_ms=20)])
        self.assertTrue(any("typing" in failure for failure in failures))

    def test_cpu_bar_only_applies_to_native_tiny_en(self):
        # A native non-tiny-en model is not CPU-gated.
        other = native_analysis(model="moonshine-small-en-260821", cpu_pct=99)
        self.assertEqual(report.evaluate_bars([other]), [])


def web_doc(final_latency_ms):
    return {
        "backend": "web",
        "model": "moonshine-tiny-en-260821",
        "language": "en",
        "audio": "two_cities_16k.wav",
        "summary": {
            "loadMs": 1000,
            "cpuPctOfOneCore": None,
            "longTasksOver50": 0,
            "typingEventMaxMs": 10,
            "contractViolations": [],
        },
        "events": [
            {"t": 0.5, "type": "partial", "text": "the"},
            {"t": 1.4, "type": "final", "text": "the"},
            {"t": 1.6, "type": "stopped"},
        ],
        "trace": [
            {
                "firstTextAudio": 1.4,
                "completedAudio": 1.4,
                "finalLatencyMs": final_latency_ms,
                "text": "the",
            }
        ],
    }


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conformance = os.path.join(self.tmp.name, "conformance")
        self.audio = os.path.join(self.tmp.name, "audio")
        os.makedirs(self.conformance)
        os.makedirs(self.audio)
        write_wav(
            os.path.join(self.audio, "two_cities_16k.wav"),
            [(1.0, 0), (1.0, 1000), (1.0, 0), (1.0, 1000), (1.0, 0)],
        )

    def run_main(self, final_latency_ms):
        with open(
            os.path.join(self.conformance, "web-moonshine-tiny-en-260821.json"), "w"
        ) as f:
            json.dump(web_doc(final_latency_ms), f)
        with mock.patch.object(report, "CONFORMANCE_DIR", self.conformance), mock.patch.object(
            report, "AUDIO_DIR", self.audio
        ):
            with contextlib.redirect_stdout(io.StringIO()):
                return report.main([])

    def test_passing_doc_set_exits_zero(self):
        self.assertEqual(self.run_main(100.0), 0)

    def test_failing_final_latency_exits_non_zero(self):
        self.assertEqual(self.run_main(500.0), 1)

    def test_no_files_exits_non_zero(self):
        with mock.patch.object(report, "CONFORMANCE_DIR", self.conformance), mock.patch.object(
            report, "AUDIO_DIR", self.audio
        ):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(report.main([]), 1)


if __name__ == "__main__":
    unittest.main()
