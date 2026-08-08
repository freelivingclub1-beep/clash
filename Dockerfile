# Clash — everything needed to run the hosted app in one image.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    CLASH_DATA_DIR=/data

# ffmpeg does the cutting and burns in the captions; libass needs real fonts on
# disk or captions render as empty boxes. libGL/libglib are opencv's runtime
# dependencies — the headless wheel still links against them.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        fontconfig \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Requirements first so image layers cache across code changes.
COPY requirements.txt requirements-tracking.txt ./
RUN pip install -r requirements.txt -r requirements-tracking.txt

# Whisper is deliberately not installed: it pulls ~2GB of CUDA-linked wheels and
# is only needed for videos with no caption track. Add it here if you need it.

COPY app/ ./app/
COPY web/ ./web/
COPY cli.py ./

# Rendered clips and cached sources live here. Mount a volume so they survive a
# restart, or don't — the app re-downloads what it needs.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

# One worker on purpose: jobs are held in memory, so a second worker would not
# see the first one's jobs. Scale by giving the box more cores, not more workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
