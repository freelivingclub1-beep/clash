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
do this in Safari today. This runs on anything that stays awake: a laptop, a
Raspberry Pi, a $5/month VPS. Point it at your account and it runs.

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
treblo/runner.py      the scheduler loop
treblo/session.py     hand-driven login, saved session reuse
treblo/cli.py         command line
scripts/from_curl.py           capture -> request template
scripts/discover_selectors.py  browser-automation fallback
```

Tests: `python -m pytest tests -q` (72 tests).
