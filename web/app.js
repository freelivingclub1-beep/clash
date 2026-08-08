const $ = (id) => document.getElementById(id);

const els = {
  url: $("url"),
  analyze: $("analyze"),
  ranker: $("ranker"),
  transcribe: $("transcribe"),
  maxResults: $("maxResults"),
  aspect: $("aspect"),
  capEnabled: $("capEnabled"),
  capStyle: $("capStyle"),
  capAccent: $("capAccent"),
  capUpper: $("capUpper"),
  status: $("status"),
  bar: $("bar"),
  statusText: $("statusText"),
  error: $("error"),
  summary: $("summary"),
  results: $("results"),
  capabilities: $("capabilities"),
};

let analysis = null;

function timestamp(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function showError(message) {
  els.error.textContent = message;
  els.error.classList.remove("hidden");
}

function clearError() {
  els.error.classList.add("hidden");
}

function setProgress(fraction, message) {
  els.status.classList.remove("hidden");
  els.bar.style.width = `${Math.round(fraction * 100)}%`;
  els.statusText.textContent = message;
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return body;
}

/** Poll a job until it finishes, reporting progress as it goes. */
async function pollJob(jobId, onProgress) {
  for (;;) {
    const job = await api(`/api/jobs/${jobId}`);
    onProgress(job.progress, job.message);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Job failed");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

function captionPayload() {
  return {
    enabled: els.capEnabled.checked,
    style: els.capStyle.value,
    accent: els.capAccent.value,
    uppercase: els.capUpper.checked,
  };
}

function renderSummary(result) {
  const source = result.source;
  els.summary.classList.remove("hidden");
  els.summary.innerHTML = "";
  const facts = [
    ["Video", source.title],
    ["Transcript", result.transcript_source],
    ["Ranked by", result.ranker],
    ["Scanned", `${result.candidates_considered.toLocaleString()} candidate windows`],
  ];
  for (const [label, value] of facts) {
    const span = document.createElement("span");
    span.innerHTML = `${label}: <strong></strong>`;
    span.querySelector("strong").textContent = value;
    els.summary.appendChild(span);
  }
}

function buildCard(clip, videoId) {
  const node = $("clipCard").content.firstElementChild.cloneNode(true);
  node.querySelector(".scoreValue").textContent = Math.round(clip.score);
  node.querySelector(".title").textContent = clip.title;
  node.querySelector(".times").textContent =
    `${timestamp(clip.start)} – ${timestamp(clip.end)}  ·  ${Math.round(clip.duration)}s`;
  node.querySelector(".reason").textContent = clip.reason;

  const excerpt = node.querySelector(".excerpt");
  excerpt.textContent = clip.text;
  excerpt.title = "Click to expand";
  excerpt.addEventListener("click", () => excerpt.classList.toggle("open"));

  const button = node.querySelector(".render");
  const statusText = node.querySelector(".renderStatus");
  const output = node.querySelector(".output");
  const video = node.querySelector("video");
  const download = node.querySelector(".download");

  button.addEventListener("click", async () => {
    button.disabled = true;
    statusText.textContent = "Queued…";
    try {
      const job = await api("/api/render", {
        method: "POST",
        body: JSON.stringify({
          video_id: videoId,
          clip_id: clip.id,
          aspect: els.aspect.value,
          captions: captionPayload(),
        }),
      });
      const result = await pollJob(job.id, (fraction, message) => {
        statusText.textContent = `${message} ${Math.round(fraction * 100)}%`;
      });
      video.src = result.url;
      download.href = result.url;
      download.setAttribute("download", result.filename);
      output.classList.remove("hidden");
      statusText.textContent = `Ready · ${(result.size_bytes / 1e6).toFixed(1)} MB`;
    } catch (err) {
      statusText.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  return node;
}

function renderResults(result) {
  els.results.innerHTML = "";
  if (!result.clips.length) {
    showError("No clips found in that video.");
    return;
  }
  const videoId = result.source.video_id;
  for (const clip of result.clips) {
    els.results.appendChild(buildCard(clip, videoId));
  }
}

async function analyze() {
  clearError();
  els.results.innerHTML = "";
  els.summary.classList.add("hidden");
  els.analyze.disabled = true;
  setProgress(0.01, "Starting");

  try {
    const job = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        url: els.url.value,
        ranker: els.ranker.value,
        transcribe: els.transcribe.value,
        max_results: Number(els.maxResults.value) || 12,
      }),
    });
    analysis = await pollJob(job.id, setProgress);
    renderSummary(analysis);
    renderResults(analysis);
    setProgress(1, `Found ${analysis.clips.length} clips`);
  } catch (err) {
    showError(err.message);
    els.status.classList.add("hidden");
  } finally {
    els.analyze.disabled = false;
  }
}

async function loadCapabilities() {
  try {
    const health = await api("/api/health");
    const items = [
      ["ffmpeg", health.ffmpeg],
      ["whisper", health.whisper],
      ["claude", health.claude],
    ];
    els.capabilities.innerHTML = "";
    for (const [name, available] of items) {
      const span = document.createElement("span");
      span.className = `cap ${available ? "on" : "off"}`;
      span.textContent = `${name} ${available ? "ready" : "not installed"}`;
      els.capabilities.appendChild(span);
    }
    els.ranker.value = health.default_ranker;
    els.transcribe.value = health.default_transcribe;
  } catch {
    /* capability strip is decorative — a failure here shouldn't block the UI */
  }
}

els.analyze.addEventListener("click", analyze);
els.url.addEventListener("keydown", (event) => {
  if (event.key === "Enter") analyze();
});
loadCapabilities();
