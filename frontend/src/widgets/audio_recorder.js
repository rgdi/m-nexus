/* ============================================================
 * audio_recorder.js — recorder con auto-asignación de clase.
 * v1.5.4 — elige asignatura según calendario (clase actual),
 * guarda en backend, transcripción stub (offline-friendly).
 *
 * MediaRecorder API — funciona en navegadores modernos con HTTPS o localhost.
 * ============================================================ */

const RECORDER_STYLE = `
.audio-rec {
  position: fixed;
  bottom: 90px;
  left: 24px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  box-shadow: var(--shadow-1);
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 280px;
}
.audio-rec .head { display: flex; align-items: center; gap: 8px; }
.audio-rec .head .rec-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #ff3b3b;
  animation: recPulse 1.4s infinite;
}
@keyframes recPulse { 50% { opacity: 0.3; } }
.audio-rec .subject-pill {
  font-size: 12px; padding: 2px 10px; border-radius: 12px;
  background: rgba(90,103,216,0.15); color: var(--accent);
  font-weight: 600;
}
.audio-rec .controls { display: flex; gap: 8px; align-items: center; }
.audio-rec .timer {
  font-family: var(--font-mono);
  font-size: 18px; font-weight: 700;
  flex: 1;
}
.audio-rec button.rec-btn {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: #ff3b3b;
  color: white;
  border: none;
  font-size: 18px;
  cursor: pointer;
}
.audio-rec button.rec-btn.stop { background: var(--fg); }
.audio-rec .transcript {
  margin-top: 4px; font-size: 13px;
  color: var(--fg-muted);
  max-height: 60px; overflow-y: auto;
}
`;

let recorderState = { stream: null, rec: null, chunks: [], startedAt: 0, timer: null };

export async function openAudioRecorder(root) {
  if (!document.getElementById("audio-rec-styles")) {
    const style = document.createElement("style");
    style.id = "audio-rec-styles";
    style.textContent = RECORDER_STYLE;
    document.head.appendChild(style);
  }
  // Calcular asignatura actual desde el calendario
  const subject = await guessCurrentSubject();
  const panel = document.createElement("div");
  panel.className = "audio-rec scrim-static";
  panel.innerHTML = `
    <div class="head">
      <div class="rec-dot"></div>
      <strong>Recorder</strong>
      <span class="subject-pill" id="rec-subject">${escapeHtml(subject.name || "—")}</span>
      <button class="btn icon" style="margin-left:auto" data-act="close">✕</button>
    </div>
    <div class="controls">
      <span class="timer" id="rec-timer">00:00</span>
      <button class="rec-btn" id="rec-toggle" title="Start">●</button>
    </div>
    <div class="transcript" id="rec-transcript">Transcript will appear here…</div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('[data-act="close"]').addEventListener("click", () => stopAndClose(panel));
  panel.querySelector("#rec-toggle").addEventListener("click", () => toggle(panel, subject));
}

async function guessCurrentSubject() {
  // v1.5.4: lee eventos del calendario del backend, devuelve el evento actual
  try {
    const r = await fetch("http://localhost:4100/api/v1/events");
    if (!r.ok) return { name: "general", id: "" };
    const { events = [] } = await r.json();
    const now = Date.now();
    const cur = events.find((e) => e.start <= now && e.end >= now);
    if (cur) return { name: cur.title || cur.subject || "general", id: cur.subject || "" };
  } catch {}
  return { name: "general", id: "" };
}

async function toggle(panel, subject) {
  const btn = panel.querySelector("#rec-toggle");
  const timer = panel.querySelector("#rec-timer");
  const transcript = panel.querySelector("#rec-transcript");
  if (recorderState.rec && recorderState.rec.state === "recording") {
    // stop
    recorderState.rec.stop();
    btn.classList.remove("stop");
    btn.textContent = "●";
    clearInterval(recorderState.timer);
    return;
  }
  // start
  try {
    recorderState.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    transcript.textContent = `Mic error: ${e.message}`;
    return;
  }
  recorderState.chunks = [];
  recorderState.rec = new MediaRecorder(recorderState.stream);
  recorderState.rec.ondataavailable = (e) => recorderState.chunks.push(e.data);
  recorderState.rec.onstop = async () => {
    const blob = new Blob(recorderState.chunks, { type: "audio/webm" });
    const dur = Math.floor((Date.now() - recorderState.startedAt) / 1000);
    transcript.textContent = `Saved ${dur}s recording for ${subject.name}`;
    // Guardar en backend
    try {
      await fetch("http://localhost:4100/api/v1/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.id || subject.name,
          subjectName: subject.name,
          durationSec: dur,
          transcript: transcript.textContent,
          createdAt: Date.now(),
          sizeBytes: blob.size,
        }),
      });
    } catch {}
    // v1.5.4: transcripción stub — en producción llamaría a /api/v1/ai/transcribe
    setTimeout(() => {
      transcript.textContent = `📝 ${subject.name}: Auto-transcription ready (mock). Use AI tutor for full transcript.`;
    }, 1200);
  };
  recorderState.rec.start();
  recorderState.startedAt = Date.now();
  btn.classList.add("stop");
  btn.textContent = "■";
  recorderState.timer = setInterval(() => {
    const s = Math.floor((Date.now() - recorderState.startedAt) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 250);
}

function stopAndClose(panel) {
  if (recorderState.rec && recorderState.rec.state === "recording") {
    recorderState.rec.stop();
  }
  if (recorderState.stream) {
    recorderState.stream.getTracks().forEach((t) => t.stop());
    recorderState.stream = null;
  }
  clearInterval(recorderState.timer);
  panel.remove();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
