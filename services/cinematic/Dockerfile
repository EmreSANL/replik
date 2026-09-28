FROM python:3.10-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
RUN if [ "$(uname -m)" = "aarch64" ]; then \
        pip install --no-cache-dir torch==2.0.1 torchaudio==2.0.2; \
    else \
        pip install --no-cache-dir torch==2.0.1+cpu torchaudio==2.0.2+cpu \
          --index-url https://download.pytorch.org/whl/cpu; \
    fi \
    && pip install --no-cache-dir demucs==4.0.1 'numpy<2' soundfile

COPY services/cinematic/engine.py services/cinematic/engine.py
COPY services/cinematic/server.py services/cinematic/server.py

ENV PYTHONUNBUFFERED=1 \
    CINEMATIC_HOST=0.0.0.0 \
    CINEMATIC_JOB_DIR=/data/jobs \
    CINEMATIC_MODEL_DIR=/data/models
EXPOSE 8011
CMD ["python", "services/cinematic/server.py"]
