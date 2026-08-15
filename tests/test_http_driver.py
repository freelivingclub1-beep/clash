import json

import pytest

from treblo.capture import RequestTemplate, parse_curl
from treblo.driver import GenerationSpec, JobState
from treblo.http_driver import HttpDriver

CURL = (
    "curl 'https://treblo.com/api/generate' "
    "-H 'content-type: application/json' "
    "-H 'cookie: session=abc123' "
    '--data-raw \'{"styles":["yeat","trap","piano"],'
    '"lyrics":"MARKER LINE ONE","lyricMode":"custom"}\''
)


class FakeHttp:
    """Captures outgoing requests and replays canned responses."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.sent = []

    def __call__(self, request, timeout):
        self.sent.append(
            {
                "url": request.full_url,
                "method": request.get_method(),
                "headers": {k.lower(): v for k, v in request.header_items()},
                "body": json.loads(request.data) if request.data else None,
            }
        )
        return json.dumps(self.responses.pop(0)).encode()


@pytest.fixture
def template():
    return RequestTemplate.from_capture(
        parse_curl(CURL), ["yeat", "trap", "piano"], "MARKER LINE ONE"
    )


def make(template, responses, **kw):
    http = FakeHttp(responses)
    driver = HttpDriver(
        template=template,
        secrets={"cookie": "session=abc123"},
        opener=http,
        **kw,
    )
    return driver, http


def test_submit_sends_the_new_tags_and_lyrics(template):
    driver, http = make(template, [{"id": "gen_77"}])
    spec = GenerationSpec(tags=["yeat", "bass", "drums"], lyric_mode="custom", lyrics="a new bar")

    assert driver.submit(spec) == "gen_77"
    sent = http.sent[0]
    assert sent["url"] == "https://treblo.com/api/generate"
    assert sent["body"]["styles"] == ["yeat", "bass", "drums"]
    assert sent["body"]["lyrics"] == "a new bar"


def test_submit_attaches_the_credentials(template):
    driver, http = make(template, [{"id": "gen_1"}])
    driver.submit(GenerationSpec(tags=["yeat", "trap", "piano"], lyric_mode="custom"))
    assert http.sent[0]["headers"]["cookie"] == "session=abc123"


def test_submit_explains_itself_when_it_cant_find_a_job_id(template):
    driver, _ = make(template, [{"unexpected": "shape"}])
    with pytest.raises(RuntimeError, match="Couldn't find a job id"):
        driver.submit(GenerationSpec(tags=["yeat", "trap", "piano"], lyric_mode="auto"))


def test_poll_maps_a_finished_render(template):
    driver, _ = make(
        template,
        [{"status": "complete", "songs": [
            {"id": "s1", "title": "One", "audio_url": "https://cdn/1.mp3"},
            {"id": "s2", "title": "Two", "audio_url": "https://cdn/2.mp3"},
        ]}],
        status_url="https://treblo.com/api/generate/{job_id}",
    )
    status = driver.poll("gen_77")

    assert status.state is JobState.DONE
    assert [s.url for s in status.songs] == ["https://cdn/1.mp3", "https://cdn/2.mp3"]


def test_poll_puts_the_job_id_in_the_url(template):
    driver, http = make(
        template,
        [{"status": "queued"}],
        status_url="https://treblo.com/api/generate/{job_id}",
    )
    driver.poll("gen_77")
    assert http.sent[0]["url"].endswith("/gen_77")


def test_poll_maps_pending_and_failed_states(template):
    driver, _ = make(
        template,
        [{"status": "queued"}],
        status_url="https://treblo.com/s/{job_id}",
    )
    assert driver.poll("g").state is JobState.QUEUED

    driver, _ = make(
        template,
        [{"status": "failed", "error": "render died"}],
        status_url="https://treblo.com/s/{job_id}",
    )
    status = driver.poll("g")
    assert status.state is JobState.FAILED
    assert status.error == "render died"


def test_unknown_state_is_treated_as_still_rendering(template):
    driver, _ = make(
        template,
        [{"status": "some_new_state_they_added"}],
        status_url="https://treblo.com/s/{job_id}",
    )
    assert driver.poll("g").state is JobState.RENDERING


def test_poll_without_a_status_url_says_what_to_capture(template):
    driver, _ = make(template, [])
    with pytest.raises(RuntimeError, match="needs status_url"):
        driver.poll("gen_77")
