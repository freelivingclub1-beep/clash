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
  render.py      ffmpeg cut / reframe / burn-in
  pipeline.py    the end-to-end orchestration
  jobs.py        background job registry for the web UI
  main.py        FastAPI routes
web/             single-page front end
cli.py           terminal front end
```

## Notes and limits

- Analysis works without ffmpeg; rendering does not.
- Reframing crops to centre. There's no face tracking, so an off-centre speaker
  will sit off-centre — use `--aspect vertical_blur` when that matters.
- YouTube periodically tightens access to auto-captions. When the caption fetch
  fails, `auto` mode falls back to Whisper, which is why installing it is worth
  doing even if you rarely use it.
- Only fetch videos you have the right to use.
