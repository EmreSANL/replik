# Replik Demucs service

This service runs the open-source [Demucs v4](https://github.com/facebookresearch/demucs) `htdemucs` model and returns its `no_vocals.wav` stem. The vocalremover.org service itself is not included and its source availability has not been verified. Demucs is trained primarily for music separation, so always listen to the result before publishing a scene; dialogue bleed or lost effects can occur.

Build from the repository root:

```sh
docker build -f services/demucs/Dockerfile -t replik-demucs .
docker run --rm -p 8000:8000 -e ALLOWED_ORIGIN=https://replik-coral.vercel.app replik-demucs
```

Deploy the container on a persistent CPU/GPU host with at least 4 GB RAM and HTTPS. Configure `ALLOWED_ORIGIN` to the site's exact origin, then set `NEXT_PUBLIC_DEMUCS_ENDPOINT=https://your-host.example/separate` in Vercel and redeploy the site. `/health` is available for health checks. The service accepts one job at a time, WAV files up to 40 MiB / 180 seconds, and returns HTTP 503 while busy. The model weights download on first use. Do not expose this unmetered endpoint publicly without host-level rate limits.
