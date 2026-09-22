FROM python:3.10-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.0.1+cpu torchaudio==2.0.2+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir demucs==4.0.1 'numpy<2'
COPY scripts/splitter_engine.py scripts/splitter_engine.py
COPY services/demucs/server.py services/demucs/server.py
ENV PORT=8000
EXPOSE 8000
CMD ["python", "services/demucs/server.py"]
