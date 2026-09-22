"""Small HTTP wrapper around the project's open-source Demucs separator.

POST /separate accepts 16-bit PCM WAV and returns Demucs' no_vocals.wav.
The service intentionally runs one separation at a time to bound RAM usage.
"""

import os
import subprocess
import sys
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


MAX_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(40 * 1024 * 1024)))
MAX_SECONDS = int(os.getenv("MAX_AUDIO_SECONDS", "180"))
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "").rstrip("/")
SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "splitter_engine.py"
BUSY = threading.Lock()


def valid_wav(path: Path) -> bool:
    try:
        with wave.open(str(path), "rb") as audio:
            return (
                audio.getnchannels() in (1, 2)
                and audio.getsampwidth() == 2
                and audio.getframerate() > 0
                and 0 < audio.getnframes() / audio.getframerate() <= MAX_SECONDS
            )
    except (EOFError, wave.Error):
        return False


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        if ALLOWED_ORIGIN and self.headers.get("Origin") == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")

    def reply(self, status: int, message: str):
        body = message.encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if self.path != "/separate":
            self.reply(404, "Not found")
            return
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, "ok")
        else:
            self.reply(404, "Not found")

    def do_POST(self):
        if self.path != "/separate":
            self.reply(404, "Not found")
            return
        if ALLOWED_ORIGIN and self.headers.get("Origin") != ALLOWED_ORIGIN:
            self.reply(403, "Origin not allowed")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 44 or length > MAX_BYTES or self.headers.get("Content-Type", "").split(";")[0] != "audio/wav":
            self.reply(400, "Expected a 16-bit PCM WAV below the upload limit")
            return
        if not BUSY.acquire(blocking=False):
            self.reply(503, "Separator is busy; retry shortly")
            return
        try:
            self.connection.settimeout(120)
            with tempfile.TemporaryDirectory(prefix="replik-demucs-") as directory:
                source = Path(directory) / "source.wav"
                output = Path(directory) / "no_vocals.wav"
                source.write_bytes(self.rfile.read(length))
                if not valid_wav(source):
                    self.reply(400, "Invalid or overlong PCM WAV")
                    return
                try:
                    subprocess.run(
                        [sys.executable, str(SCRIPT), str(source), str(output)],
                        check=True,
                        capture_output=True,
                        timeout=900,
                    )
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                    print(f"Demucs failed: {error}", file=sys.stderr)
                    self.reply(500, "Demucs could not separate this audio")
                    return
                if not output.is_file() or not valid_wav(output):
                    self.reply(500, "Demucs returned invalid audio")
                    return
                body = output.read_bytes()
                self.send_response(200)
                self.cors()
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        finally:
            BUSY.release()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
