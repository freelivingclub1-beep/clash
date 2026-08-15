# Treblo song generator / storer

A scheduler that keeps a Treblo account generating continuously, without
filling up your phone, without repeating a single bar, and without you sitting
there pressing Generate.

## Is this possible?

Mostly yes, with one honest caveat up front.

**What works:** everything about *deciding what to generate and when*. The
burst limit, the variable wait, tag validation and rotation with `yeat`
locked in front, the no-repeat guarantee across the whole catalogue, subject
matter steering, and a local index that stores metadata only. All of that is
built here and tested.

**The caveat:** Treblo has no *published* API, so the piece that actually
talks to it is a seam you fill in — see **How do I get an API?** below. The
short version: capture the request the web app already makes, and replay it.
Tooling for that is here. I did not invent an API and write code against it,
because that code would just fail.

**The other caveat:** "run in the background" needs a machine that stays on.
Not your phone — iOS suspends background tabs, which is exactly why you can't
do this in Safari today. See **Running it without owning a computer** below;
the short version is a $4/month VPS you drive from an SSH app.

## What it does

Per generation it decides:

| Decision | Rule |
| --- | --- |
| Can I generate right now? | Max 3 in flight (= 6 songs). Enforced, not guessed. |
| When is the next slot? | Predicted from *measured* render times, not a fixed cooldown. |
| Which tags? | `yeat` always first, 3–6 total, exact matches only. |
| Rotate tags? | Every 4th generation, round-robin across the non-anchor slots. |
| Lyrics? | Custom, freshly written, every bar checked against the whole corpus. |
| Auto lyrics? | Every 3rd generation. |

## The no-repeat guarantee

The thing you actually asked for: song 1 and song 33 can never share a bar.

Every accepted line is normalized (case, punctuation, spacing) and broken into
word 4-grams, which go into an inverted index. A candidate bar is rejected if
it matches an old one exactly *or* overlaps one by 40% or more — so a
reshuffled or lightly reworded old bar gets caught too, not just a copy-paste.

This is a gate the lyric writer has to pass, not a request made of it. Swap in
a different writer and the guarantee still holds.

There's a test that generates 33 songs and asserts zero reuse.

## Subject matter

`TopicFilter` screens out the stuff you don't want on the account — crime
how-to, tax evasion, self-harm, real named people — and `ThemeBank` rotates
through ordinary rap subject matter so consecutive songs aren't the same song.
Both are plain lists you can edit.

## Storage

SQLite, metadata only. Songs, the lyric corpus, the n-gram index, and an event
log. **No audio.** The audio stays on your Treblo account; what's local is the
`treblo_url` pointer and enough detail to find a song again. A test asserts
there's no audio column.

## Try it

```
python -m treblo.cli tags yeat trap pianoo
# Didn't find a tag: 'pianoo' - did you mean 'piano'?

python -m treblo.cli tags trap yeat piano
# 'yeat' must be the first tag

python -m treblo.cli run --generations 12 --bars 16
python -m treblo.cli songs
```

`run` uses the offline simulator (`FakeDriver`), which fakes variable render
times so you can watch the whole pipeline — scheduling, waiting, tag rotation,
the lyric gate — work end to end before any real driver exists.

## How do I get an API?

There's no *published* Treblo API. There is definitely a **private** one — the
web app has to call something when you press Generate — and you can capture it
in about two minutes. That capture *is* your API.

This is the better of the two paths by a distance. Sending the same HTTP
request the button sends is far lighter than driving a whole Chromium to click
it, doesn't break when the page layout shifts, and runs on anything.

### Capture it (desktop browser, once)

1. Open treblo.com, log in, go to Create.
2. Dev tools (F12) → **Network** tab → tick **Preserve log**.
3. Set tags to exactly `yeat` `trap` `piano`. Pick Custom Lyrics and paste a
   line you'll recognise: `MARKER LINE ONE`
4. Press **Generate**.
5. Find the request that fired — usually a POST named something like
   `generate` / `create` / `songs`. Right-click → **Copy** → **Copy as cURL**.
6. Paste it into `capture.txt`, then:

```
python scripts/from_curl.py capture.txt --tags yeat trap piano \
    --lyrics-snippet "MARKER LINE ONE"
```

It finds where the tags and lyrics live in the payload by searching for the
values you know you typed — so you never have to reverse-engineer their JSON
by hand. It writes:

- `treblo/request.json` — the request shape, **safe to commit**
- `.treblo-secrets.json` — your cookies and auth headers, **gitignored**

A test asserts no credential ever ends up in the committed template.

It also *lists* the fields that might control Custom vs Auto lyrics rather
than picking one, because a wrong guess there silently generates the wrong
kind of song. Capture one Auto Lyrics generation too and diff the two bodies
to see which field actually flipped.

### Then run it

```
python -m treblo.cli run --driver http \
    --status-url 'https://treblo.com/api/.../{job_id}' \
    --generations 20
```

`--status-url` is the polling endpoint — capture it the same way by watching
which request repeats while a song renders.

`HttpDriver` is stdlib-only, so the machine that runs it needs nothing
installed beyond Python. A Raspberry Pi or the cheapest VPS is plenty.

## The other path: browser automation

Slower and more fragile, but works if the request turns out to be awkward to
replay (signed payloads, heavy anti-bot). Run these on your own machine — all
three steps need to reach treblo.com.

```
pip install playwright && playwright install chromium

python -m treblo.session login        # browser opens; you log in by hand
python scripts/discover_selectors.py  # reads the real selectors off the page
```

`session login` never asks for your password. It opens a real browser, waits
while *you* log in, then saves the session cookies to `.treblo-auth.json`
(gitignored). Captcha, 2FA and email links all just work, because a human is
doing the login. Treat that file like a password.

`discover_selectors.py` then writes `treblo/selectors.json` and prints a
snippet of each element it matched so you can check it grabbed the right one.
It reports anything it can't find rather than guessing — a selector that
silently matches the wrong element is worse than a missing one.

That leaves `submit()` and `poll()` in `treblo/driver.py`. `BrowserDriver`
refuses to construct until every required selector is present, so you can't
half-wire it and get confusing failures.

The UI flow it drives, from the app: Advanced tab → Model v3 → type each tag
into "Search for styles" and pick the match → Custom Lyrics + paste, or Auto
Lyrics → Style Strength → Generate → watch the Library for the two new songs.

## Running it without owning a computer

Two separate problems, and it's worth not confusing them:

| | Needs | How long |
| --- | --- | --- |
| Capturing the request | a desktop browser with dev tools | once, ~5 min |
| Running the scheduler | a machine that stays on | forever |

A borrowed laptop only solves the first. So use those five minutes to do
*both* — capture the request **and** stand up a VPS — then hand the laptop
back and drive everything from your phone.

On the borrowed laptop:

```
# 1. capture (see above), then point it at a fresh Debian/Ubuntu VPS
scp .treblo-secrets.json treblo/request.json root@YOUR_VPS:/tmp/
ssh root@YOUR_VPS 'bash -s' < deploy/setup.sh
```

`deploy/setup.sh` installs Python, clones the repo, creates an unprivileged
`treblo` user, moves your credentials into place with 0600 and shreds the
copy in /tmp, and installs a systemd service set to restart on failure and
come back after reboot. Then:

```
nano /etc/treblo.env     # set TREBLO_STATUS_URL and your tags
systemctl start treblo
```

Laptop can go back. From your phone, with any SSH client (Termius, Blink,
Terminus):

```
systemctl status treblo
journalctl -u treblo -f
/opt/treblo/.venv/bin/python -m treblo.cli --db /var/lib/treblo/treblo.db status
```

**The one thing that will need you again:** Treblo session cookies expire.
When that happens the service logs exactly what to do rather than failing
quietly, because no amount of retrying fixes an expired cookie — it needs a
fresh capture. Expect to borrow a laptop again for two minutes whenever it
happens. How often depends on how long Treblo's sessions last, which you'll
only learn by running it.

## What each song actually is

A title tells you nothing about a track you've never heard. Every finished
song gets measured, so the library reads like something you can act on:

```
#16    done    G minor  143 BPM  2:05  warm
       [yeat,guitar,piano]  custom  https://treblo.com/song/...
```

Key (Krumhansl-Schmuckler over the chroma), BPM, duration, loudness,
brightness and energy. Then you can search by sound rather than by title:

```
python -m treblo.cli find --mode minor --bpm-min 140 --bpm-max 175
python -m treblo.cli find --key F#
```

**It still doesn't keep the audio.** Each file is streamed to a temp path,
measured, and deleted in a `finally` — the numbers are a few hundred bytes,
the MP3 is megabytes. Two tests assert the file is gone afterwards, including
when the analysis throws.

Needs `pip install librosa` and is off by default (`--analyze` to enable),
because librosa pulls in numpy/scipy and the analysis is CPU-bound — roughly
the length of the song, per song. Fine on a laptop; slow on the smallest VPS.
The scheduler always dispatches generations *before* analysing, so a slow box
costs you song detail, never throughput.

## What it costs

```
python -m treblo.cli cost --songs-per-day 200 --model claude-haiku-4-5
```

Three bills, and only one is really under your control:

| | Cost |
| --- | --- |
| **Treblo plan** | whatever their tier costs — and it's the real cap on throughput |
| **Machine** | ~$4–5/mo VPS, or £0 on a spare laptop |
| **Lyrics** | £0 with the built-in writer; per-generation with Claude |

At **1000 songs/day**, lyrics via API:

```
  model                lyrics/mo    total/mo
  ------------------------------------------
  template                 $0.00       $5.00
  claude-haiku-4-5        $60.00      $65.00
  claude-sonnet-5        $180.00     $185.00
  claude-opus-5          $300.00     $305.00
```

Only 2 of every 3 generations hit the API — the third uses Treblo's Auto
Lyrics — and one generation covers two songs, so the API is billed once per
two songs. Both facts are in the estimate.

## Better lyrics

`TemplateSource` is a stand-in — it builds bars combinatorially so the pipeline
is runnable offline, but it is not a good songwriter. `AnthropicSource` in
`treblo/lyrics.py` calls Claude with the tags, the theme, and the bars already
used, and is a drop-in replacement:

```python
from treblo.lyrics import AnthropicSource, Deduplicator, LyricWriter
writer = LyricWriter(AnthropicSource(), Deduplicator(library))
```

Needs `pip install anthropic` and `ANTHROPIC_API_KEY`. Its output still goes
through the same gate — nothing is trusted to not repeat itself.

## Layout

```
treblo/tags.py      vocabulary, validation, the locked anchor tag
treblo/quota.py     burst limit + self-calibrating next-slot prediction
treblo/lyrics.py    dedupe gate, topic filter, lyric sources
treblo/library.py   SQLite index (metadata only)
treblo/driver.py      the Treblo seam: FakeDriver + BrowserDriver skeleton
treblo/capture.py     parse a copied cURL into a reusable request template
treblo/http_driver.py replays that request -- the recommended path, stdlib only
treblo/analysis.py    key / BPM / feel per song, audio never kept
treblo/costs.py       what running it costs
treblo/runner.py      the scheduler loop
treblo/session.py     hand-driven login, saved session reuse
treblo/cli.py         command line
scripts/from_curl.py           capture -> request template
scripts/discover_selectors.py  browser-automation fallback
deploy/setup.sh                one-shot VPS install
deploy/treblo.service          systemd unit
```

Tests: `python -m pytest tests -q` (108 tests).
