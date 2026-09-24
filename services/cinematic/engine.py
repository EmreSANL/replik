"""CDX23 speech/music/effects separation, prepared once per source video.

Weights: https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing
Unlike the music-only htdemucs checkpoint, these weights were trained on DnR.
"""
import hashlib
import os
from pathlib import Path
import urllib.request

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.states import load_model

WEIGHTS = (
    '97d170e1-dbb4db15.th',
    '97d170e1-a778de4a.th',
    '97d170e1-e41a5468.th',
)
RELEASE = 'https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing/releases/download/v.1.0.0/'
ROOT = Path(__file__).resolve().parents[2]


class CinematicSeparator:
    def __init__(self):
        self.cache = Path(os.getenv('CINEMATIC_MODEL_DIR', str(ROOT / '.venv-splitter/cache/cinematic')))
        self.cache.mkdir(parents=True, exist_ok=True)
        self.device = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')
        self.models = []
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        for name in WEIGHTS:
            path = self.cache / name
            if not path.exists():
                temporary = path.with_suffix('.download')
                urllib.request.urlretrieve(RELEASE + name, temporary)
                temporary.replace(path)
            expected = name.split('-')[1].split('.')[0]
            if not hashlib.sha256(path.read_bytes()).hexdigest().startswith(expected):
                raise RuntimeError('Cinematic model checksum mismatch: ' + name)
            # Only load publisher weights whose release checksum was verified above.
            package = torch.load(path, map_location='cpu', weights_only=False)
            model = load_model(package).eval()
            if list(model.sources) != ['music', 'effect', 'dialog']:
                raise RuntimeError('Unexpected cinematic model sources: ' + str(model.sources))
            self.models.append(model)
        print(f'Cinematic separator ready: 3 checkpoints, device={self.device}', flush=True)

    def separate(self, source, destination):
        audio, sample_rate = sf.read(source, dtype='float32', always_2d=True)
        if sample_rate != 44100 or audio.shape[1] != 2:
            raise ValueError('Expected 44.1 kHz stereo input')
        if not 0 < len(audio) / sample_rate <= 180:
            raise ValueError('Video en fazla 180 saniye olmalı.')
        if not np.isfinite(audio).all():
            raise ValueError('Invalid input audio')
        mixture = torch.from_numpy(audio.T.copy()).unsqueeze(0)
        background = np.zeros_like(audio)
        for index, model in enumerate(self.models):
            try:
                with torch.inference_mode():
                    stems = apply_model(model, mixture, device=self.device, shifts=1, overlap=0.8)[0].cpu().numpy()
            except (RuntimeError, NotImplementedError):
                if self.device != 'mps':
                    raise
                self.device = 'cpu'
                model.cpu()
                with torch.inference_mode():
                    stems = apply_model(model, mixture, device='cpu', shifts=1, overlap=0.8)[0].cpu().numpy()
            # Keep the model's music and effects channels, excluding spoken dialogue.
            background += (stems[0] + stems[1]).T / len(self.models)
            print(f'Cinematic checkpoint {index + 1}/3 finished', flush=True)
        if len(background) != len(audio) or not np.isfinite(background).all():
            raise ValueError('Invalid separated audio')
        peak = float(np.max(np.abs(background)))
        if peak > 0.99:
            background *= 0.99 / peak
        sf.write(destination, background, sample_rate, subtype='PCM_24')
