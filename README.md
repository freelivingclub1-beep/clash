# Clash

Paste a video link, get back the moments most likely to travel as short-form
clips — cut, reframed to 9:16, and captioned with word-by-word "jumping"
subtitles. Runs entirely on your own machine.

```
┌──────────┐   ┌────────────┐   ┌──────────┐   ┌────────┐   ┌────────┐
│ yt-dlp   │──▶│ transcript │──▶│ segment  │──▶│ score  │──▶│ ffmpeg │
│ fetch    │   │ captions   │   │ into     │   │ + rank │   │ cut +  │
│          │   │ or whisper │   │ moments  │   │        │   │ burn   │
└──────────┘   └────────────┘   └──────────┘   └────────┘   └────────┘
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# ffmpeg is required for rendering (analysis works without it)
sudo apt install ffmpeg          # Debian/Ubuntu
brew install ffmpeg              # macOS
```

Then:

```bash
uvicorn app.main:app --reload --port 8000
# open http://localhost:8000
```

Or from the terminal:

```bash
python cli.py analyze "https://youtu.be/VIDEO_ID"
python cli.py clip    "https://youtu.be/VIDEO_ID" --top 3 --aspect vertical
```

## Optional extras

**Local transcription** — for videos with no caption track, or when you want
better punctuation and word timings than YouTube's auto-captions:

```bash
pip install -r requirements-whisper.txt
export CLASH_TRANSCRIBE=whisper          # or leave on "auto" as a fallback
export CLASH_WHISPER_MODEL=small         # tiny | base | small | medium | large-v3
```

**Face tracking** — so the 9:16 crop follows the speaker instead of sitting in
the middle of the frame:

```bash
pip install -r requirements-tracking.txt
python cli.py clip "https://youtu.be/VIDEO_ID" --face-track
```

In the web UI it's the "Track the speaker" checkbox. Nothing to download — the
detector ships inside the OpenCV wheel.

**Claude ranking** — the heuristic scorer finds well-bounded, self-contained
moments; Claude is better at judging which of them a viewer would actually stop
for, and writes the titles:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CLASH_RANKER=llm
```

Only the shortlist is sent, not the whole transcript, so a feature-length video
costs a couple of cents.

## About the cost question

Worth being straight about this, since it's the reason to build it:

- **Analysis is genuinely free.** YouTube caption fetch, segmentation and
  heuristic scoring are all local. No per-clip charge, no credit meter, no cap
  on how many videos you run.
- **Rendering is free but not instant.** It is your CPU doing the encoding
  instead of someone else's. A 60-second vertical clip with burned-in captions
  takes roughly 10–30 seconds on a modern laptop.
- **Whisper is free but slow on CPU.** `small` runs at roughly 3–6× real time on
  a laptop CPU, near-instant on a GPU. Caption-based transcription skips this
  entirely, which is why it's the default.
- **Claude ranking is the only thing that costs money**, and it's optional — the
  app is fully functional with `CLASH_RANKER=heuristic`. Turning it on trades a
  few cents per video for noticeably better clip selection and titles.

So the honest comparison to a subscription service: you replace a credit balance
with your own compute time, and you keep the transcript and the source video on
your machine. What you give up is somebody else's GPU farm and a hosted UI.

## Configuration

Every setting is an environment variable.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLASH_MIN_CLIP` | `15` | Shortest clip, seconds |
| `CLASH_MAX_CLIP` | `180` | Longest clip, seconds |
| `CLASH_TRANSCRIBE` | `auto` | `auto` \| `youtube` \| `whisper` |
| `CLASH_RANKER` | `heuristic` | `heuristic` \| `llm` |
| `CLASH_LLM_MODEL` | `claude-opus-5` | Model used when ranking with Claude |
| `CLASH_WHISPER_MODEL` | `small` | Whisper size |
| `CLASH_WHISPER_DEVICE` | `auto` | `auto` \| `cpu` \| `cuda` |
| `CLASH_MAX_RESULTS` | `12` | Clips returned per video |
| `CLASH_MAX_HEIGHT` | `1080` | Cap on downloaded source resolution |
| `CLASH_CAPTION_FONT` | `DejaVu Sans` | Any font installed on the system |
| `CLASH_FACE_MODEL` | – | YuNet `.onnx` path; only needed on OpenCV 5 |
| `CLASH_FONTS_DIR` | – | Extra font directory for libass |
| `CLASH_DATA_DIR` | `./data` | Where sources, clips and caches live |

## How clips are chosen

Words become sentence-like **units** (split on punctuation, or on pauses when
the transcript has none). Every window of consecutive units whose duration falls
between the min and max is a candidate — a 45-minute video yields tens of
thousands of them. Each is scored on six signals:

| Signal | What it rewards |
| --- | --- |
| **Hook** | Opens on a question, a number, a contrarian claim or a story cue |
| **Intensity** | Density of high-stakes, emotional or conflict language |
| **Narrative** | First-person and sequence markers — it's a story, not a list |
| **Density** | Words per second in the conversational band; penalises dead air |
| **Standalone** | Starts after a pause, doesn't open on "but/so/it", ends on a full stop |
| **Duration** | Favours 20–70s, where short-form retention is strongest |

Filler words subtract. Overlapping winners are then suppressed so the results
are distinct moments rather than twelve variations on the same minute.

The weights live in `app/score.py` as a plain dict — tune them for your niche.

## Putting it on the internet

Clash ships as a container, so anything that runs Docker will host it. Two
things are non-negotiable before you expose a URL:

- **Set `CLASH_PASSWORD`.** Without it, every visitor can drive a video
  downloader and a CPU-heavy encoder on your bill. The app logs a warning and
  suggests a password when it starts without one.
- **Give it a disk and a cap.** Source videos are hundreds of megabytes. The
  built-in reaper expires clips and sources on a timer and evicts the oldest
  first if `CLASH_MAX_DISK_GB` is exceeded.

### Fly.io (the config is in the repo)

```bash
fly launch --no-deploy --copy-config      # uses the bundled fly.toml
fly volume create clash_data --size 10
fly secrets set CLASH_PASSWORD='pick-something-long'
fly deploy
```

Then open the URL Fly prints, enter the password, and on a phone use
**Share → Add to Home Screen** so it opens like an installed app.

### Any box with Docker

```bash
export CLASH_PASSWORD='pick-something-long'
docker compose up -d          # serves on :8000
```

Put a reverse proxy with HTTPS in front (Caddy does it in two lines), and set
`CLASH_BEHIND_TLS=1` so the session cookie is marked Secure.

### What to expect from a hosted box

Encoding is the whole cost. On a 1-core instance a 60-second captioned clip
takes a few minutes; on 2–4 cores it is well under a minute. This is why
`fly.toml` asks for `performance-2x` — a shared-CPU instance works but tests
your patience.

Two settings matter more than the rest:

- `auto_stop_machines` is **off** on purpose. Jobs live in the app's memory, so
  a machine that sleeps mid-render loses the job.
- Run **one** worker. A second uvicorn worker gets its own memory and cannot
  see the first one's jobs, so polling would fail at random. Scale by adding
  cores, not workers.

Free tiers that sleep after inactivity or give you an ephemeral disk will
technically run Clash and frustrate you constantly. Budget ~$5–10/month for
something that reliably encodes video.

### Hosted-only settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLASH_PASSWORD` | – | Enables the login gate. **Set this on any public URL.** |
| `CLASH_SECRET` | derived | Session signing key. Defaults to a value derived from the password, so changing the password signs everyone out. |
| `CLASH_BEHIND_TLS` | `0` | Set to `1` when a proxy terminates HTTPS, so the cookie is Secure. |
| `CLASH_MAX_SOURCE_MINUTES` | `240` | Longest video accepted |
| `CLASH_MAX_DISK_GB` | `8` | Total data cap before the oldest files are evicted |
| `CLASH_SOURCE_TTL_HOURS` | `6` | How long downloaded sources are kept |
| `CLASH_CLIP_TTL_HOURS` | `12` | How long rendered clips are kept — **download the ones you want** |

Note that last one: rendered clips are deleted after 12 hours by default. It
is a scratch space, not a library.

## Face tracking

Off by default; enable per render. Only applies to the cropping aspects
(`vertical`, `square`) — the blurred-background and original modes keep the
whole frame, so there is nothing to track towards.

Recentring the crop on every detection looks like camera shake, so the path is
built the way an editor would cut it — hold, move deliberately, hold:

1. Sample 4 frames/sec and detect faces (downscaled to 720px for speed).
2. With several faces on screen, prefer the one already being followed rather
   than always the largest, so the crop doesn't ping-pong between speakers.
3. Median-filter out single-frame misdetections, then smooth with a centred
   moving average — symmetric, so it adds no lag and reproduces a real pan
   exactly, ends included.
4. Simplify the path (Ramer–Douglas–Peucker) into at most 24 keyframes. A
   speaker who barely moves collapses to a single static framing.
5. Emit those keyframes as a piecewise-linear ffmpeg crop expression, so the
   move happens inside the existing encode pass — no second pass, no extra time.

Faces are placed slightly above centre for headroom. If a face is found in
fewer than 15% of sampled frames the track is rejected and the render falls back
to a centre crop, with the reason reported in the progress line — you get a
centred clip rather than an error.

Detection is Haar cascades, which are bundled in OpenCV 4. **OpenCV 5 removed
that API**, which is why `requirements-tracking.txt` pins `<5`. If you are
already on OpenCV 5, download a [YuNet](https://github.com/opencv/opencv_zoo)
`.onnx` model and set `CLASH_FACE_MODEL` to its path — the code picks it up
automatically and it detects better than Haar.

Haar is fast and dependency-free but it is a 2001-era detector: it wants
reasonably frontal, reasonably lit faces. Heavy profile turns, low light or
faces smaller than ~3.5% of frame width will drop detections. The smoothing
tolerates gaps, but for difficult footage the YuNet path is worth the download.

## Captions

Word-level timings drive an ASS subtitle file that libass burns in during the
ffmpeg pass, so there's no per-frame Python work.

- **pop** — a short phrase holds on screen; the word being spoken scales up and
  switches to the highlight colour. This is the look most short-form clips use.
- **single** — one word at a time, very large, bouncing in on each beat.

Captions can be switched off per render. Colour, font, size, uppercase, bounce
and vertical position are all adjustable (`app/captions.py` → `CaptionStyle`).

Caption timing quality follows the transcript source: Whisper gives true
per-word timings, YouTube auto-captions are close but occasionally drift by a
frame or two on fast speech.

## Layout

```
app/
  config.py      environment-driven settings
  ingest.py      yt-dlp: metadata, media, caption track
  transcribe.py  json3 caption parsing + faster-whisper
  segment.py     units, candidate enumeration, overlap suppression
  score.py       the heuristic viral scorer
  llm.py         optional Claude re-ranking
  captions.py    ASS karaoke caption builder
  tracking.py    face detection, path smoothing, crop keyframes
  render.py      ffmpeg cut / reframe / burn-in
  pipeline.py    the end-to-end orchestration
  jobs.py        background job registry for the web UI
  auth.py        password gate for public deployments
  storage.py     disk retention and eviction
  main.py        FastAPI routes
web/             single-page front end (installable as a phone app)
cli.py           terminal front end
Dockerfile       the hosted image
docker-compose.yml / fly.toml   deploy configs
```

## Notes and limits

- Analysis works without ffmpeg; rendering does not.
- Face tracking follows one subject. For a two-person interview where both
  should stay visible, `--aspect vertical_blur` keeps the whole frame instead.
- YouTube periodically tightens access to auto-captions. When the caption fetch
  fails, `auto` mode falls back to Whisper, which is why installing it is worth
  doing even if you rarely use it.
- Only fetch videos you have the right to use.
