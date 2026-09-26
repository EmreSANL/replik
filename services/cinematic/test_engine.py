"""Run with: .venv-splitter/bin/python3 -m unittest discover -s services/cinematic"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
import torch

from engine import CinematicSeparator


class CinematicSeparatorTest(unittest.TestCase):
    def test_preserves_original_background_after_removing_speech(self):
        separator = CinematicSeparator.__new__(CinematicSeparator)
        separator.device = 'cpu'
        separator.models = [object(), object(), object()]
        # Distinct stems expose accidentally retaining speech or losing effects.
        stems = torch.zeros((1, 3, 2, 4410))
        stems[:, 0] = 0.1
        stems[:, 1] = 0.2
        stems[:, 2] = 0.6
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.wav'
            output = Path(directory) / 'output.wav'
            sf.write(source, np.full((4410, 2), 0.8), 44100)
            with patch('engine.apply_model', return_value=stems) as apply:
                separator.separate(source, output)
            audio, rate = sf.read(output, always_2d=True)
            self.assertEqual(apply.call_count, 3)
            self.assertEqual(rate, 44100)
            self.assertEqual(audio.shape, (4410, 2))
            # The estimated music + effects would be 0.3; retaining the
            # original mix after removing speech must instead yield 0.2.
            np.testing.assert_allclose(audio, 0.2, atol=1e-6)


if __name__ == '__main__':
    unittest.main()
