# Replik: editor-only dialogue separation

New uploads are prepared once in the editor. Rooms, recording sessions and MP4
exports consume `custom_scenes.instrumental_url`; they never start a model.
Original video audio remains available for reference playback. Speech recognition
and subtitle edits do not affect the prepared background.

## Local setup

The default worker uses the three CDX23/DnR cinematic checkpoints from
[MVSEP-CDX23](https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing).
These predict `music`, `sfx`, and `speech`. The worker averages all three
checkpoints and saves music + effects as stereo 44.1 kHz PCM WAV. CUDA is preferred,
then Apple MPS, then CPU. The first run downloads approximately 162 MB of weights;
release checksum prefixes are verified before loading them. Separation is not
lossless: listen for speech bleed and damaged effects before saving a scene.

Dependencies: Python 3.10+, FFmpeg on PATH, PyTorch, Demucs 4.0.1, NumPy and SoundFile.
The existing `.venv-splitter` environment can be used:

```sh
.venv-splitter/bin/python3 services/cinematic/server.py
./node_modules/.bin/vinext dev
```

Add server-only settings to `.env.local` (never prefix the keys with `NEXT_PUBLIC_`):

```dotenv
CINEMATIC_API_URL=http://127.0.0.1:8011
CINEMATIC_API_KEY=<a-long-random-shared-secret>
```

`NEXT_PUBLIC_SUPABASE_URL` determines the only media origin the worker accepts.
The worker binds to loopback by default, processes one job at a time, queues at
most ten, accepts up to 120 MB / 180 seconds, and preserves jobs and outputs in
`work/cinematic-jobs`. Model weights live in `.venv-splitter/cache/cinematic`.
`GET /health` checks availability; other endpoints require `x-api-key`.

The editor calls authenticated `/api/splitter-ai` requests. The backend writes
job manifests under `videos/audio-jobs/<user>/...`, then copies completed audio
into `videos/instrumentals/<user>/...`. Supabase Storage policies must permit the
authenticated owner to read/insert/update their job objects and upload prepared
audio. A Storage failure stays visible; it never silently publishes an incomplete
scene. These paths contain no API keys. No database migration is required.

## Optional AudioShake

Set server-only `AUDIOSHAKE_API_KEY` to select AudioShake instead of the local
worker. The adapter requests the `music_fx` model, following the official
[dialogue separation API](https://developer.audioshake.ai/remove-dialogue-for-dubbing).
The original video supplies the unmodified reference audio, so there is no need
to request a second paid `dialogue` output. Provider links expire; the backend
copies the output into permanent Supabase Storage before marking it ready.

## Reuse, failures and retries

- The original upload URL is immutable; its hash + engine version identifies preparation.
- Repeated requests atomically claim one manifest, then poll the same provider job.
- Reloading the editor or retrying a storage/download failure reuses that job.
- A failed model can be explicitly retried. Unknown submission outcomes are not
  automatically charged again; check the provider panel/local worker logs.
- Closing the editor cancels polling, not the worker. Reopen the same video and
  click the preparation button to retrieve its result.
- Changing/trimming the source uploads a new video and prepares a new background.
- Saving subtitles, copying scenes, starting rooms and playing finals do not separate again.
- Existing scenes with an instrumental URL retain it. Scenes without one must be
  prepared in the editor before a game can start.

## Deployment

Run the worker on a persistent CPU/GPU host with FFmpeg, model cache and job
storage. Use HTTPS and the shared server secret, set `CINEMATIC_HOST=0.0.0.0`
inside its container, and point the site's server-side `CINEMATIC_API_URL` to it.
The host URL must also be the worker's API_URL so its output links resolve.
Set `CINEMATIC_PORT` separately when its internal port differs from the HTTPS URL.
For AudioShake, no model worker is needed.

The web host must execute the `/api/splitter-ai` route. Publishing only
`dist/client` as static files does not deploy that route. Vercel uses the
Nitro server build configured in `vercel.json`; its output is
`.vercel/output` and includes the API function. Keep the project's Vercel
Framework Preset on Other and do not override its output directory with
`dist/client`. Set either the server-only `AUDIOSHAKE_API_KEY` or both
`CINEMATIC_API_URL` (a public HTTPS worker URL, never loopback) and
`CINEMATIC_API_KEY` in Vercel before redeploying. A POST to
`/api/splitter-ai` without a session should return JSON with HTTP 401;
HTTP 404 indicates that the server build was not deployed.

The older `services/demucs` music-only service is no longer called by the app.

## Run without a third-party API key

`CINEMATIC_API_KEY` is only a shared secret between your Vercel app and your
own worker. Generate a long random value; it is not a purchased vendor key.
The `services/cinematic/Dockerfile` packages the open-source model on a
persistent CPU/GPU host. Build it from the repository root:

```sh
docker build -f services/cinematic/Dockerfile -t replik-cinematic .
docker run --rm -p 8011:8011 -v cinematic-data:/data \
  -e CINEMATIC_API_KEY=<your-shared-secret> \
  -e NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co \
  -e CINEMATIC_API_URL=https://<your-worker-host> \
  replik-cinematic
```

The worker needs public HTTPS and a persistent `/data` volume so a restart
does not lose jobs or cached model weights. A Render Docker web service can
use this Dockerfile, a disk mounted at `/data`, and the two required secrets
above. Render supplies `PORT` and `RENDER_EXTERNAL_URL` automatically; the
worker uses them if `CINEMATIC_PORT` and `CINEMATIC_API_URL` are unset.
First separation downloads the three model checkpoints. Keep the worker
private behind host-level rate limits where possible; the shared secret
protects its job and output endpoints.

In Vercel, set `CINEMATIC_API_URL` to the worker's public HTTPS base URL and
set `CINEMATIC_API_KEY` to the same random value. Remove any stale
`AUDIOSHAKE_API_KEY` if you intend to use the self-hosted model. Redeploy
the web app after setting these variables. Check the worker's `/health`
endpoint and then try a short uploaded video from the editor.

### Always Free ARM VM option

An Oracle Cloud Always Free Ampere A1 VM can run the Dockerfile on ARM64.
Use an Ubuntu VM with an Always Free eligible shape and a public IP. Allow
inbound TCP 80 and 443 in Oracle's network rules; keep 8011 private. Docker
Engine and the Compose plugin must be installed on the VM. The container's
named volumes preserve jobs, model files, and HTTPS certificates on the VM.
The account, available VM capacity, and free-tier eligibility must be
checked in Oracle's console before creating resources.

From the repository root on that VM:

```sh
cp services/cinematic/worker.env.example services/cinematic/worker.env
openssl rand -hex 32  # Copy the result into CINEMATIC_API_KEY in worker.env
# Set CINEMATIC_DOMAIN to <public-ip-with-dashes>.sslip.io and set Supabase URL.
docker compose --env-file services/cinematic/worker.env \
  -f services/cinematic/compose.yaml up -d --build
curl https://<your-domain>/health
```

The provided Caddy proxy obtains HTTPS for the public hostname. `sslip.io`
resolves the IP embedded in that hostname, so a separate domain purchase is
not needed. The first request downloads model weights; a CPU VM can take a
long time to prepare audio. In Vercel, set `CINEMATIC_API_URL` to
`https://<your-domain>` and copy the worker's shared key to
`CINEMATIC_API_KEY`. Keep `worker.env` private.

### Windows PC with Tailscale Funnel (no cloud VM)

This option runs the same model on a Windows PC while it is on. Tailscale Funnel
provides a stable public HTTPS `*.ts.net` address without a domain purchase,
public IP, or router port forwarding. It is available on the free Personal plan,
but its relay bandwidth is limited. The PC must remain awake and connected while
users prepare audio. The worker listens only on `127.0.0.1`; Funnel exposes only
that worker, and the shared secret protects its job and output endpoints.

Install Python 3.11 (including the `py` launcher), FFmpeg on PATH, and Tailscale
for Windows. Log in to Tailscale and enable Funnel when it prompts in the browser.
On an NVIDIA PC, from the repository root in PowerShell:

```powershell
.\services\cinematic\setup-windows.ps1 -SupabaseUrl 'https://your-project.supabase.co'
.\services\cinematic\start-windows.ps1
```

Setup creates an ignored `.venv-splitter` environment with PyTorch CUDA and a
private `services/cinematic/worker.windows.env` containing a random shared key.
The first start may download approximately 162 MB of model weights. The start
script prints the public worker URL and then runs the worker in that terminal;
leave the terminal open. Open `<printed-url>/health` to verify the public route.
In Vercel, set `CINEMATIC_API_URL` to the printed HTTPS URL and
`CINEMATIC_API_KEY` to the value in `worker.windows.env`, then redeploy. Do not
paste the key into GitHub or a chat. If PowerShell blocks script execution, run
it from a PowerShell terminal using `powershell -ExecutionPolicy Bypass -File
services/cinematic/setup-windows.ps1 -SupabaseUrl ...` and likewise for start.
After a reboot or sleep, run `start-windows.ps1` again. When the PC is off, new
separations cannot start; already prepared scenes retain their Supabase audio.
