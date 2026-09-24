#!/usr/bin/env python3
"""
Saf AI Vokal Ayırıcı Motor (Meta Hybrid Transformer Demucs - htdemucs)
Girdi: input_audio.wav
Çıktı:
  Hiçbir hibrit ses kısma (ducking / gate / filtre) olmadan,
  doğrudan htdemucs --two-stems=vocals yapay zeka modelinin ürettiği
  saf 'no_vocals.wav' (arka plan ses efektleri, müzik ve ortam sesleri) çıktısını verir.
"""

import sys
import os
import shutil
import subprocess
import torch


def run_splitter(input_wav: str, output_wav: str):
    work_dir = os.path.dirname(os.path.abspath(output_wav))
    sep_dir = os.path.join(work_dir, "htdemucs_out")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[Splitter-AI] Saf AI Modu | Cihaz: {device} | Model: htdemucs (--two-stems=vocals)")

    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "--two-stems=vocals",
        "--shifts",
        "2",
        "--overlap",
        "0.25",
        "-n",
        "htdemucs",
        "-d",
        device,
        "-o",
        sep_dir,
        input_wav,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 and device == "mps":
        print("[Splitter-AI] MPS fallback -> CPU")
        cmd[cmd.index("-d") + 1] = "cpu"
        res = subprocess.run(cmd, capture_output=True, text=True)

    if res.returncode != 0:
        raise RuntimeError(f"Demucs AI hatası: {res.stderr}")

    base_name = os.path.splitext(os.path.basename(input_wav))[0]
    track_dir = os.path.join(sep_dir, "htdemucs", base_name)
    no_vocals_path = os.path.join(track_dir, "no_vocals.wav")

    if not os.path.exists(no_vocals_path):
        raise FileNotFoundError(f"no_vocals.wav bulunamadı: {no_vocals_path}")

    # Doğrudan htdemucs'un ürettiği saf no_vocals.wav dosyasını hiçbir ses kısma/filtre olmadan kopyala
    shutil.copyfile(no_vocals_path, output_wav)
    print(f"[Splitter-AI] Saf AI çıktısı tamamlandı -> {output_wav}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Kullanım: splitter_engine.py <input.wav> <output.wav>")
        sys.exit(1)
    run_splitter(sys.argv[1], sys.argv[2])
