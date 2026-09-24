"""Persistent local/GPU worker. Keys stay on the server; browsers use /api/splitter-ai."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
# Local setup; hosted deployments provide these as environment variables.
if (ROOT / '.env.local').exists():
    for line in (ROOT / '.env.local').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            if key in ('CINEMATIC_API_KEY', 'CINEMATIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL'):
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))

KEY = os.environ.get('CINEMATIC_API_KEY', '')
API_URL = os.environ.get('CINEMATIC_API_URL', 'http://127.0.0.1:8011').rstrip('/')
MEDIA_ORIGIN = urlparse(os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')).netloc
JOBS = Path(os.environ.get('CINEMATIC_JOB_DIR', str(ROOT / 'work/cinematic-jobs')))
JOBS.mkdir(parents=True, exist_ok=True)
POOL = ThreadPoolExecutor(max_workers=1)
LOCK = threading.Lock()
PENDING = set()
SEPARATOR = None
MAX_BYTES = 120 * 1024 * 1024


def save_job(job):
    path = JOBS / (job['id'] + '.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(job))
    temporary.replace(path)


def read_job(task_id):
    path = JOBS / (task_id + '.json')
    return json.loads(path.read_text()) if path.exists() else None


def valid_source(url):
    parsed = urlparse(url)
    return (parsed.scheme == 'https' and parsed.netloc == MEDIA_ORIGIN and
            not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and
            parsed.path.startswith('/storage/v1/object/public/videos/uploads/'))


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected media redirect')


def process(job, source):
    global SEPARATOR
    task_id = job['id']
    media = JOBS / (task_id + '.input')
    wav = JOBS / (task_id + '.input.wav')
    output = JOBS / (task_id + '.wav')
    try:
        opener = urllib.request.build_opener(NoRedirects)
        with opener.open(source, timeout=60) as response, media.open('wb') as destination:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError('Video en fazla 120 MB olabilir.')
                destination.write(chunk)
        ffmpeg = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
        subprocess.run([ffmpeg, '-nostdin', '-y', '-i', str(media), '-t', '181', '-vn',
                        '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', str(wav)],
                       check=True, capture_output=True, timeout=120)
        if SEPARATOR is None:
            from engine import CinematicSeparator
            SEPARATOR = CinematicSeparator()
        SEPARATOR.separate(wav, output)
        job['targets'][0] = {'model': 'music_fx', 'status': 'completed',
                             'output': [{'link': f'{API_URL}/outputs/{task_id}.wav'}]}
    except Exception as error:
        print(f'Cinematic task {task_id} failed: {type(error).__name__}: {error}', flush=True)
        job['targets'][0] = {'model': 'music_fx', 'status': 'error'}
    finally:
        with LOCK:
            save_job(job)
            PENDING.discard(task_id)
        media.unlink(missing_ok=True)
        wav.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        return bool(KEY) and hmac.compare_digest(self.headers.get('x-api-key', ''), KEY)

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'status': 'ok', 'engine': 'cinematic-cdx23', 'checkpoints': 3})
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        match = re.fullmatch(r'/tasks/([a-f0-9]{64})', self.path)
        if match:
            with LOCK:
                job = read_job(match[1])
            return self.reply(200 if job else 404, job or {'error': 'Not found'})
        match = re.fullmatch(r'/outputs/([a-f0-9]{64})\.wav', self.path)
        if match:
            output = JOBS / (match[1] + '.wav')
            if output.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(output.stat().st_size))
                self.end_headers()
                with output.open('rb') as audio:
                    shutil.copyfileobj(audio, self.wfile)
                return
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        if self.path != '/tasks':
            return self.reply(404, {'error': 'Not found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Invalid request length')
            body = json.loads(self.rfile.read(length))
            source = body['url']
            if not valid_source(source):
                raise ValueError('Expected uploaded media from configured storage')
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {'error': 'Invalid source'})
        task_id = hashlib.sha256(('cinematic-cdx23-ensemble-v1:' + source).encode()).hexdigest()
        with LOCK:
            job = read_job(task_id)
            if job and job['targets'][0]['status'] != 'error':
                return self.reply(200, job)
            if len(PENDING) >= 10:
                return self.reply(429, {'error': 'Queue full'})
            job = {'id': task_id, 'createdAt': time.time(), 'targets': [{'model': 'music_fx', 'status': 'processing'}]}
            save_job(job)
            PENDING.add(task_id)
            POOL.submit(process, job, source)
        self.reply(200, job)


if __name__ == '__main__':
    if not KEY or not MEDIA_ORIGIN:
        raise SystemExit('CINEMATIC_API_KEY and NEXT_PUBLIC_SUPABASE_URL are required.')
    # An interrupted job is explicitly retryable after restart.
    for path in JOBS.glob('*.json'):
        job = json.loads(path.read_text())
        if job['targets'][0]['status'] == 'processing':
            job['targets'][0]['status'] = 'error'
            save_job(job)
    host = os.environ.get('CINEMATIC_HOST', '127.0.0.1')
    port = int(os.environ.get('CINEMATIC_PORT', str(urlparse(API_URL).port or 8011)))
    print(f'Cinematic worker listening on {host}:{port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
