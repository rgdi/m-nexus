/* ============================================================
 * setup_wizard.js — first-run onboarding (slideshow style).
 *
 * v2.1.5 — appears automatically when localStorage has no
 *          `mnexus.setup.completed` flag. Walks the user
 *          through 6 slides:
 *
 *   1. Welcome           — value prop
 *   2. Pick a vault       — personal / school / work
 *   3. Add first subject  — quick form
 *   4. Notebook basics    — stylus + markup
 *   5. Flashcards         — cloze extraction
 *   6. Done               — open overview
 *
 * Slides auto-advance on "Next", can be skipped via "Skip all",
 * progress bar at bottom, prev/next arrows + dot indicators.
 * Persists per-step choices to localStorage so the user can
 * re-open the wizard later from Settings.
 * ============================================================ */

const SETUP_KEY = "mnexus.setup.v1";
const COMPLETED_FLAG = "mnexus.setup.completed";

let styleMounted = false;

const STYLE = `
.setup-wizard {
  position: fixed; inset: 0;
  background: linear-gradient(135deg, #f0f7fc 0%, #e8f1f8 100%);
  z-index: 500;
  display: flex;
  flex-direction: column;
  font-family: inherit;
  color: var(--fg, #1f2937);
  animation: setup-fade-in 0.4s ease-out;
}
.setup-wizard.setup-dark {
  background: linear-gradient(135deg, #0a1a26 0%, #15283a 100%);
  color: #f0f0f0;
}
@keyframes setup-fade-in {
  from { opacity: 0; transform: scale(1.05); }
  to   { opacity: 1; transform: scale(1); }
}
.setup-slide-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-5, 24px);
  overflow: auto;
}
.setup-slide {
  width: 100%;
  max-width: 720px;
  display: none;
  animation: setup-slide-in 0.5s ease-out;
}
.setup-slide.active { display: block; }
@keyframes setup-slide-in {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.setup-hero {
  font-size: clamp(48px, 8vw, 96px);
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.03em;
  margin: 0 0 var(--s-4, 16px);
  background: linear-gradient(135deg, #5b8def, #8c5cf6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.setup-subtitle {
  font-size: clamp(18px, 2.5vw, 22px);
  color: var(--fg-muted, #5a6373);
  margin: 0 0 var(--s-5, 24px);
  max-width: 560px;
}
.setup-body {
  font-size: clamp(14px, 1.8vw, 16px);
  line-height: 1.6;
  color: var(--fg, #1f2937);
  margin: 0 0 var(--s-5, 24px);
  max-width: 560px;
}
.setup-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--s-3, 12px);
  margin: 0 0 var(--s-5, 24px);
  max-width: 560px;
}
.setup-option {
  border: 2px solid var(--border, #e0e3eb);
  background: var(--bg-elevated, #fff);
  border-radius: 14px;
  padding: var(--s-3, 12px) var(--s-4, 16px);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 15px;
  color: var(--fg, #1f2937);
  transition: all 200ms ease;
}
.setup-option:hover {
  border-color: #5b8def;
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(91, 141, 239, 0.2);
}
.setup-option.selected {
  border-color: #5b8def;
  background: rgba(91, 141, 239, 0.1);
}
.setup-option .ico { font-size: 24px; display: block; margin-bottom: 6px; }
.setup-option .name { font-weight: 600; }
.setup-option .desc { font-size: 12px; color: var(--fg-muted, #5a6373); margin-top: 2px; }
.setup-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-3, 12px);
  margin-bottom: var(--s-5, 24px);
  max-width: 480px;
}
.setup-form label { font-size: 13px; color: var(--fg-muted, #5a6373); font-weight: 600; }
.setup-form input,
.setup-form select {
  padding: 12px 14px;
  font-size: 15px;
  border-radius: 10px;
  border: 1.5px solid var(--border, #e0e3eb);
  background: var(--bg-elevated, #fff);
  color: var(--fg, #1f2937);
  font-family: inherit;
}
.setup-form input:focus,
.setup-form select:focus {
  outline: none;
  border-color: #5b8def;
}
.setup-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--s-4, 16px);
}
.setup-chip {
  background: var(--bg-elevated, #fff);
  border: 1px solid var(--border, #e0e3eb);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  color: var(--fg, #1f2937);
  font-family: inherit;
}
.setup-chip.selected {
  background: #5b8def;
  color: white;
  border-color: #5b8def;
}
.setup-progress {
  height: 4px;
  background: var(--bg-sunken, #e8eaef);
  position: relative;
  overflow: hidden;
}
.setup-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #5b8def, #8c5cf6);
  transition: width 400ms ease;
}
.setup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-4, 16px) var(--s-5, 24px);
  background: var(--bg-elevated, rgba(255,255,255,0.8));
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--border, #e0e3eb);
  gap: 12px;
  flex-wrap: wrap;
}
.setup-dots {
  display: flex;
  gap: 6px;
  flex: 1;
  justify-content: center;
}
.setup-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--border, #cbd2dd);
  transition: all 200ms ease;
  cursor: pointer;
}
.setup-dot.active {
  background: #5b8def;
  width: 24px;
  border-radius: 4px;
}
.setup-dot.done { background: #8c5cf6; }
.setup-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 150ms ease;
}
.setup-btn-primary {
  background: #5b8def;
  color: white;
}
.setup-btn-primary:hover { background: #4a7bdb; transform: translateY(-1px); }
.setup-btn-ghost {
  background: transparent;
  color: var(--fg-muted, #5a6373);
}
.setup-btn-ghost:hover { background: var(--bg-sunken, #f0f2f5); }
.setup-btn-skip {
  background: transparent;
  color: var(--fg-muted, #5a6373);
  font-size: 13px;
}
.setup-icon-row {
  display: flex;
  gap: var(--s-4, 16px);
  margin-bottom: var(--s-5, 24px);
  font-size: 48px;
  justify-content: center;
  opacity: 0.85;
}
.setup-icon-row span {
  animation: setup-float 3s ease-in-out infinite;
}
.setup-icon-row span:nth-child(2) { animation-delay: 0.4s; }
.setup-icon-row span:nth-child(3) { animation-delay: 0.8s; }
.setup-icon-row span:nth-child(4) { animation-delay: 1.2s; }
@keyframes setup-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-12px); }
}
.setup-tip {
  background: rgba(91, 141, 239, 0.08);
  border-left: 3px solid #5b8def;
  padding: 12px 16px;
  border-radius: 0 8px 8px 0;
  font-size: 14px;
  color: var(--fg, #1f2937);
  margin-bottom: var(--s-4, 16px);
}
.setup-tip b { color: #5b8def; }
.setup-tip code {
  background: rgba(91, 141, 239, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 13px;
}
.setup-kbd {
  display: inline-block;
  padding: 2px 8px;
  background: var(--bg-sunken, #e8eaef);
  border: 1px solid var(--border, #cbd2dd);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  margin: 0 2px;
}
.setup-success {
  text-align: center;
  padding: var(--s-5, 24px);
}
.setup-success h2 {
  font-size: clamp(28px, 4vw, 36px);
  margin: 0 0 var(--s-3, 12px);
  color: #10b981;
}
.setup-success p {
  font-size: 16px;
  color: var(--fg-muted, #5a6373);
  max-width: 480px;
  margin: 0 auto var(--s-5, 24px);
}
@media (max-width: 480px) {
  .setup-hero { font-size: 48px; }
  .setup-footer { padding: var(--s-3, 12px) var(--s-4, 16px); }
  .setup-btn { padding: 8px 14px; font-size: 13px; }
  .setup-grid { grid-template-columns: 1fr; }
}

/* v2.6.0: AI provider + admin slides */
.setup-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: var(--s-4, 16px) 0;
  max-width: 560px;
  text-align: left;
}
.setup-radio-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-elevated, rgba(0, 0, 0, 0.05));
  border-radius: 8px;
  cursor: pointer;
}
.setup-radio-group input[type="radio"] { margin: 0; }
.wiz-ai-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 560px;
  margin: var(--s-3, 12px) 0;
}
.wiz-ai-fields[hidden] { display: none; }
.wiz-ai-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  text-align: left;
}
.wiz-ai-fields input {
  padding: 8px 12px;
  border: 1px solid var(--border, #2a2e38);
  border-radius: 6px;
  background: var(--bg, #0e1116);
  color: var(--fg, #e8e9eb);
  font: inherit;
}
.setup-test-result {
  margin-top: var(--s-3, 12px);
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--bg-elevated, rgba(0, 0, 0, 0.05));
  font-size: 13px;
}
.setup-fieldset {
  border: 1px solid var(--border, #2a2e38);
  border-radius: 8px;
  padding: var(--s-3, 12px) var(--s-4, 16px);
  margin: var(--s-3, 12px) 0;
  max-width: 560px;
  text-align: left;
}
.setup-fieldset legend {
  padding: 0 8px;
  font-weight: 600;
}
.setup-fieldset label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
  font-size: 13px;
}
.setup-fieldset input,
.setup-fieldset select {
  padding: 8px 12px;
  border: 1px solid var(--border, #2a2e38);
  border-radius: 6px;
  background: var(--bg, #0e1116);
  color: var(--fg, #e8e9eb);
  font: inherit;
}
.setup-fieldset small {
  color: var(--fg-muted, #9ca3af);
  font-size: 11px;
}
`;

const SLIDES = [
  // 1. Welcome
  {
    id: "welcome",
    render: () => `
      <h1 class="setup-hero">Welcome to<br/>M-NEXUS</h1>
      <p class="setup-subtitle">Tu sistema personal de estudio — apuntes, flashcards, calendario y seguimiento, todo en un sitio.</p>
      <div class="setup-icon-row">
        <span>📓</span><span>🧠</span><span>📚</span><span>🎯</span>
      </div>
      <p class="setup-body">Tour rápido para configurar tu primera asignatura y aprender lo esencial. En menos de un minuto estás estudiando.</p>
    `,
  },
  // 2. Topology (v2.23.3): single node / join cluster / create cluster
  {
    id: "topology",
    render: () => `
      <h1 class="setup-hero">¿Cómo quieres desplegarlo?</h1>
      <p class="setup-body">M-NEXUS corre en un solo servidor, o sincroniza varios entre sí para repartir la carga.</p>
      <div class="topology-cards" style="display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px">
        <button class="topology-card" data-topo="solo" type="button">
          <div class="tc-icon">🖥️</div>
          <div class="tc-title">Solo este servidor</div>
          <div class="tc-sub">Mi PC, mi Raspberry, mi VPS. Un único nodo.</div>
        </button>
        <button class="topology-card" data-topo="join" type="button">
          <div class="tc-icon">🔗</div>
          <div class="tc-title">Unirme a un cluster existente</div>
          <div class="tc-sub">Te paso una URL de un nodo líder y entras al cluster compartido.</div>
        </button>
        <button class="topology-card" data-topo="leader" type="button">
          <div class="tc-icon">👑</div>
          <div class="tc-title">Crear un cluster nuevo</div>
          <div class="tc-sub">Esta instancia será el primer nodo líder. Más adelante puedes añadir workers.</div>
        </button>
      </div>
      <p class="muted small" id="topology-hint" style="margin-top:16px">
        Por defecto: solo este servidor. Lo puedes cambiar luego en Ajustes → Cluster.
      </p>
    `,
    setup: (root) => {
      const state = root._setupState;
      if (!state.topology) state.topology = "solo";
      const refresh = () => {
        root.querySelectorAll(".topology-card").forEach((c) => {
          c.classList.toggle("selected", c.dataset.topo === state.topology);
        });
      };
      refresh();
      root.querySelectorAll(".topology-card").forEach((c) => {
        c.addEventListener("click", () => {
          state.topology = c.dataset.topo;
          refresh();
          const hint = root.querySelector("#topology-hint");
          if (state.topology === "solo") hint.textContent = "Todo local. Sin Redis ni configuración extra.";
          else if (state.topology === "join") hint.textContent = "Necesitas la URL del nodo líder. Te la pediré en el siguiente paso.";
          else hint.textContent = "Recibirás una URL para invitar a los demás nodos. Por defecto esta instancia es líder.";
        });
      });
    },
  },
  // 3. Pick a vault
  {
    id: "vault",
    setup: (root) => {
      const selected = (root._setupState.vault ?? "default");
      const opts = [
        { id: "default",  ico: "🏠", name: "Personal",  desc: "Mixed topics, your private space" },
        { id: "school",   ico: "🎒", name: "School",    desc: "Subjects, lectures, exam prep" },
        { id: "personal", ico: "✨", name: "Personal",  desc: "Hobbies, journal, reading notes" },
        { id: "work",     ico: "💼", name: "Work",      desc: "Research, projects, meetings" },
      ];
      const wrap = root.querySelector("#vault-grid");
      wrap.innerHTML = "";
      opts.forEach((o) => {
        const b = document.createElement("button");
        b.className = "setup-option" + (o.id === selected ? " selected" : "");
        b.innerHTML = `<span class="ico">${o.ico}</span><div class="name">${o.name}</div><div class="desc">${o.desc}</div>`;
        b.addEventListener("click", () => {
          root._setupState.vault = o.id;
          root.querySelectorAll(".setup-option").forEach((x) => x.classList.remove("selected"));
          b.classList.add("selected");
        });
        wrap.appendChild(b);
      });
    },
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Pick your vault</h2>
      <p class="setup-body">A vault is a separate namespace for your notes. You can switch anytime. Pick one to start; you can add more later.</p>
      <div class="setup-grid" id="vault-grid"></div>
    `,
    onNext: (root) => {
      const vault = root._setupState.vault ?? "default";
      try { localStorage.setItem("mnexus.vault.current", JSON.stringify({ id: vault })); } catch {}
    },
  },
  // 3. First subject
  {
    id: "subject",
    setup: (root) => {
      // v2.22.1: generic suggestions (no longer medical-only). User can
      // add anything later from the Subjects screen.
      const chips = ["Matemáticas", "Lengua", "Historia", "Ciencias", "Inglés", "Filosofía", "Otro…"];
      const wrap = root.querySelector("#subject-chips");
      wrap.innerHTML = "";
      chips.forEach((c) => {
        const b = document.createElement("button");
        b.className = "setup-chip" + (c === (root._setupState.subject ?? "Matemáticas") ? " selected" : "");
        b.textContent = c;
        b.addEventListener("click", () => {
          root._setupState.subject = c;
          wrap.querySelectorAll(".setup-chip").forEach((x) => x.classList.remove("selected"));
          b.classList.add("selected");
          if (root.querySelector("#subject-other")) root.querySelector("#subject-other").value = "";
        });
        wrap.appendChild(b);
      });
      const other = root.querySelector("#subject-other");
      other.value = root._setupState.customSubject ?? "";
      other.addEventListener("input", () => {
        if (other.value.trim()) {
          root._setupState.subject = other.value.trim();
          root._setupState.customSubject = other.value.trim();
          wrap.querySelectorAll(".setup-chip").forEach((x) => x.classList.remove("selected"));
        }
      });
    },
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Añade tu primera asignatura</h2>
      <p class="setup-body">Elige una sugerencia o escribe el nombre. La verás en el panel y podrás añadir más, editar, reordenar o borrar cuando quieras.</p>
      <div class="setup-chips" id="subject-chips"></div>
      <div class="setup-form">
        <label>Or type a custom name</label>
        <input type="text" id="subject-other" placeholder="ej: Matemáticas, Historia, Programación…" maxlength="40" />
      </div>
    `,
    onNext: async (root) => {
      // v2.22.1: only add the subject the user actually picked — no fake seed.
      const name = (root._setupState.subject || "Matemáticas").trim();
      if (!name) return;
      try {
        await fetch("/api/v1/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color: "var(--subj-blue)", grade: null, performance: 0 }),
        });
      } catch (e) { /* offline ok */ }
    },
  },
  // 4. Notebook basics
  {
    id: "notebook",
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Your smart notebook</h2>
      <p class="setup-body">A stylus canvas with a text layer on top. Draw, highlight, and write structured markup that turns into flashcards.</p>
      <div class="setup-tip">
        <b>Try this in any note:</b>
        <code>{{c1::pregunta::respuesta}}</code> makes a cloze card.
        <code>[[WikiLink]]</code> links notes.
        <code>@book/3-12</code> jumps to a book reference.
      </div>
      <p class="setup-body" style="margin-top: var(--s-4)">
        <b>Tools:</b> pen, highlighter, eraser, ruler, voice input, image attach, PDF import.
      </p>
      <div class="setup-tip">
        On a tablet, use a stylus with <b>pressure + tilt</b>. Long-press a word for definition popup.
      </div>
    `,
  },
  // 5. Flashcards
  {
    id: "flashcards",
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Flashcards with FSRS</h2>
      <p class="setup-body">FSRS-4.5 spaced repetition. Cards in 4 states (new / learning / relearning / review). Rating Again/Hard/Good/Easy updates the schedule.</p>
      <div class="setup-tip">
        <b>Auto-extract flashcards</b> from any note: open note → AI menu → <code>Extract flashcards</code>.
        Or type <code>/flashcards</code> in the text layer.
      </div>
      <p class="setup-body" style="margin-top: var(--s-4)">
        <b>4 study modes:</b>
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:var(--s-4);max-width:560px">
        <div style="padding:10px 14px;background:var(--bg-elevated);border-radius:8px;font-size:14px"><b>🎓 Study</b> — walk every topic, weakest first</div>
        <div style="padding:10px 14px;background:var(--bg-elevated);border-radius:8px;font-size:14px"><b>📋 Exam</b> — balanced quiz (100% coverage)</div>
        <div style="padding:10px 14px;background:var(--bg-elevated);border-radius:8px;font-size:14px"><b>📊 Review</b> — spaced repetition</div>
        <div style="padding:10px 14px;background:var(--bg-elevated);border-radius:8px;font-size:14px"><b>⚡ Cram</b> — random rapid-fire</div>
      </div>
    `,
  },
  // 6. Done
  {
    id: "done",
    render: () => `
      <div class="setup-success">
        <h2>You're all set 🎉</h2>
        <p>Your first subject is ready. Open the dashboard to see it, or jump straight into a note.</p>
        <button class="setup-btn setup-btn-primary" id="setup-go-overview">Open dashboard →</button>
        <button class="setup-btn setup-btn-ghost" id="setup-go-notes" style="margin-left:8px">Create first note</button>
        <p class="muted small" style="margin-top:24px">Tip: press <span class="setup-kbd">⌘K</span> or <span class="setup-kbd">Ctrl K</span> anytime to search.</p>
      </div>
    `,
    setup: (root) => {
      root.querySelector("#setup-go-overview")?.addEventListener("click", () => {
        closeWizard();
        location.hash = "#/overview";
      });
      root.querySelector("#setup-go-notes")?.addEventListener("click", () => {
        closeWizard();
        location.hash = "#/notes";
      });
    },
  },
  // ──────────────────────────────────────────────────────────────────
  // v2.6.0: AI provider + admin setup
  // ──────────────────────────────────────────────────────────────────
  // 7. AI provider
  {
    id: "ai-provider",
    setup: (root) => {
      const state = root._setupState;
      if (!state.aiProvider) state.aiProvider = "mock";
      const radios = root.querySelectorAll('input[name="wiz-ai-provider"]');
      const updateFields = () => {
        const sel = root.querySelector('input[name="wiz-ai-provider"]:checked')?.value || "mock";
        root.querySelectorAll(".wiz-ai-fields").forEach((el) => {
          el.hidden = el.dataset.for !== sel;
        });
      };
      radios.forEach((r) => {
        r.checked = r.value === state.aiProvider;
        r.addEventListener("change", () => {
          state.aiProvider = r.value;
          updateFields();
        });
      });
      updateFields();
      const testBtn = root.querySelector("#wiz-test-ai");
      if (testBtn) {
        testBtn.addEventListener("click", async () => {
          testBtn.disabled = true;
          testBtn.textContent = "Probando...";
          const result = root.querySelector("#wiz-test-result");
          try {
            const r = await fetch("/api/v1/admin/ai/test", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(root._setupState.authToken ? { Authorization: `Bearer ${root._setupState.authToken}` } : {}),
              },
            });
            const data = await r.json();
            result.hidden = false;
            result.textContent = data.ok ? `✅ ${data.message}` : `❌ ${data.message}`;
            result.style.color = data.ok ? "var(--success, #10b981)" : "var(--danger, #ef4444)";
          } catch (e) {
            result.hidden = false;
            result.textContent = `❌ ${e.message}`;
          } finally {
            testBtn.disabled = false;
            testBtn.textContent = "🔌 Probar conexión";
          }
        });
      }
    },
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Proveedor de IA</h2>
      <p class="setup-body">Selecciona cómo quieres que M-NEXUS genere respuestas (resúmenes, flashcards, tutor). Puedes cambiar esto después en Settings.</p>
      <div class="setup-radio-group">
        <label><input type="radio" name="wiz-ai-provider" value="mock" /> <strong>Skip</strong> — respuestas predefinidas, sin red</label>
        <label><input type="radio" name="wiz-ai-provider" value="ollama" /> <strong>Ollama local</strong> — privacidad total, sin costes</label>
        <label><input type="radio" name="wiz-ai-provider" value="openrouter" /> <strong>OpenRouter</strong> — un API key, muchos modelos</label>
        <label><input type="radio" name="wiz-ai-provider" value="openai" /> <strong>OpenAI-compatible</strong> — LM Studio, vLLM, etc.</label>
      </div>
      <div class="wiz-ai-fields" data-for="ollama">
        <label>URL base <input name="wiz-ai-baseUrl" value="http://localhost:11434" /></label>
        <label>Modelo <input name="wiz-ai-model" value="llama3.1:8b" /></label>
      </div>
      <div class="wiz-ai-fields" data-for="openrouter" hidden>
        <label>API Key <input name="wiz-ai-apiKey" type="password" placeholder="sk-or-v1-..." /></label>
        <label>Modelo <input name="wiz-ai-model" value="meta-llama/llama-3.1-8b-instruct:free" /></label>
      </div>
      <div class="wiz-ai-fields" data-for="openai" hidden>
        <label>URL base <input name="wiz-ai-baseUrl" placeholder="http://localhost:1234/v1" /></label>
        <label>API Key <input name="wiz-ai-apiKey" type="password" placeholder="opcional" /></label>
        <label>Modelo <input name="wiz-ai-model" value="local-model" /></label>
      </div>
      <button class="setup-btn setup-btn-ghost" id="wiz-test-ai">🔌 Probar conexión</button>
      <div id="wiz-test-result" class="setup-test-result" hidden></div>
    `,
    onNext: async (root) => {
      const state = root._setupState;
      const provider = state.aiProvider || "mock";
      const modelInput = root.querySelector('input[name="wiz-ai-model"]');
      const baseUrlInput = root.querySelector('input[name="wiz-ai-baseUrl"]');
      const apiKeyInput = root.querySelector('input[name="wiz-ai-apiKey"]');
      const cfg = {
        provider,
        model: modelInput?.value || "mock-1",
        baseUrl: baseUrlInput?.value || undefined,
        apiKey: apiKeyInput?.value || undefined,
      };
      try {
        await fetch("/api/v1/admin/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
          },
          body: JSON.stringify(cfg),
        });
      } catch { /* best effort */ }
    },
  },
  // 8. Admin + Backup
  {
    id: "admin-backup",
    render: () => `
      <h2 class="setup-hero" style="font-size:clamp(28px,4vw,40px)">Admin y backups</h2>
      <p class="setup-body">Crea el usuario admin (único) y configura la rotación de backups automáticos.</p>
      <fieldset class="setup-fieldset">
        <legend>👤 Usuario admin</legend>
        <label>Usuario <input name="wiz-admin-username" value="admin" pattern="[a-z0-9_-]{3,32}" /></label>
        <label>Contraseña (mín 12) <input name="wiz-admin-password" type="password" minlength="12" /></label>
        <label>Repetir contraseña <input name="wiz-admin-password2" type="password" minlength="12" /></label>
      </fieldset>
      <fieldset class="setup-fieldset">
        <legend>💾 Backups automáticos</legend>
        <label>Frecuencia
          <select name="wiz-backup-interval">
            <option value="6">Cada 6 horas</option>
            <option value="12">Cada 12 horas</option>
            <option value="24" selected>Cada 24 horas</option>
            <option value="0">Desactivado</option>
          </select>
        </label>
        <label>Conservar últimos
          <select name="wiz-backup-keep-daily">
            <option value="7">7 backups</option>
            <option value="30" selected>30 backups</option>
            <option value="90">90 backups</option>
          </select>
        </label>
        <label>Comando remoto opcional <input name="wiz-backup-remote" placeholder="rclone copy {} remote:bucket/backups" /></label>
        <small>{} se reemplaza con la ruta del backup. Ej: rsync, rclone, cp a USB.</small>
      </fieldset>
    `,
    onNext: async (root) => {
      const state = root._setupState;
      const username = root.querySelector('input[name="wiz-admin-username"]')?.value?.trim();
      const pwd = root.querySelector('input[name="wiz-admin-password"]')?.value;
      const pwd2 = root.querySelector('input[name="wiz-admin-password2"]')?.value;
      const interval = root.querySelector('select[name="wiz-backup-interval"]')?.value || "24";
      const keepDaily = root.querySelector('select[name="wiz-backup-keep-daily"]')?.value || "30";
      const remote = root.querySelector('input[name="wiz-backup-remote"]')?.value || "";
      // Validate passwords
      if (!username || !pwd || pwd.length < 12) {
        throw new Error("Password must be at least 12 chars");
      }
      if (pwd !== pwd2) {
        throw new Error("Passwords don't match");
      }
      // Create admin via /auth/setup
      try {
        const r = await fetch("/api/v1/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: pwd }),
        });
        if (r.ok) {
          const data = await r.json();
          state.authToken = data.accessToken;
          state.refreshToken = data.refreshToken;
          // Save tokens
          try {
            sessionStorage.setItem("mnexus.auth.access", data.accessToken);
            localStorage.setItem("mnexus.auth.refresh", data.refreshToken);
          } catch { /* private mode */ }
        } else if (r.status === 409) {
          // Admin already exists — try login
          const lr = await fetch("/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: pwd }),
          });
          if (lr.ok) {
            const ld = await lr.json();
            state.authToken = ld.accessToken;
            state.refreshToken = ld.refreshToken;
            try {
              sessionStorage.setItem("mnexus.auth.access", ld.accessToken);
              localStorage.setItem("mnexus.auth.refresh", ld.refreshToken);
            } catch { /* private mode */ }
          }
        }
      } catch { /* best effort */ }
      // Save backup config
      try {
        await fetch("/api/v1/admin/backup/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
          },
          body: JSON.stringify({
            intervalHours: Number(interval),
            keepDaily: Number(keepDaily),
            keepMonthly: 12,
            remoteCommand: remote || undefined,
          }),
        });
      } catch { /* best effort */ }
    },
  },
];

/**
 * openSetupWizard — show wizard overlay if not already completed.
 * Pass {force: true} to re-open from Settings.
 */
export function openSetupWizard(opts = {}) {
  if (!styleMounted) {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    styleMounted = true;
  }
  if (!opts.force && localStorage.getItem(COMPLETED_FLAG) === "1") {
    return false;
  }
  if (document.getElementById("mnexus-setup-wizard")) return false;

  const wiz = document.createElement("div");
  wiz.id = "mnexus-setup-wizard";
  wiz.className = "setup-wizard" + (document.documentElement.dataset.theme === "dark" ? " setup-dark" : "");
  wiz._setupState = {};
  wiz._setupIndex = 0;

  wiz.innerHTML = `
    <div class="setup-progress"><div class="setup-progress-bar" id="setup-progress"></div></div>
    <div class="setup-slide-area" id="setup-slide-area"></div>
    <div class="setup-footer">
      <button class="setup-btn setup-btn-skip" id="setup-skip">Skip all</button>
      <button class="setup-btn setup-btn-ghost" id="setup-back" style="visibility:hidden">← Back</button>
      <div class="setup-dots" id="setup-dots"></div>
      <button class="setup-btn setup-btn-primary" id="setup-next">Next →</button>
      <button class="setup-btn setup-btn-ghost" id="setup-finish" style="display:none">Finish</button>
    </div>
  `;
  document.body.appendChild(wiz);

  const slideArea = wiz.querySelector("#setup-slide-area");
  const dotsWrap = wiz.querySelector("#setup-dots");
  const progress = wiz.querySelector("#setup-progress");
  const btnBack = wiz.querySelector("#setup-back");
  const btnNext = wiz.querySelector("#setup-next");
  const btnFinish = wiz.querySelector("#setup-finish");
  const btnSkip = wiz.querySelector("#setup-skip");

  // Build dots
  SLIDES.forEach((_s, i) => {
    const d = document.createElement("div");
    d.className = "setup-dot" + (i === 0 ? " active" : "");
    d.addEventListener("click", () => goTo(i));
    dotsWrap.appendChild(d);
  });

  function goTo(i) {
    wiz._setupIndex = i;
    slideArea.innerHTML = `<div class="setup-slide active">${SLIDES[i].render()}</div>`;
    progress.style.width = `${((i + 1) / SLIDES.length) * 100}%`;
    // dots
    dotsWrap.querySelectorAll(".setup-dot").forEach((d, idx) => {
      d.classList.toggle("active", idx === i);
      d.classList.toggle("done", idx < i);
    });
    // buttons
    btnBack.style.visibility = i === 0 ? "hidden" : "visible";
    const isLast = i === SLIDES.length - 1;
    btnNext.style.display = isLast ? "none" : "inline-block";
    btnFinish.style.display = isLast ? "inline-block" : "none";
    // setup callback
    if (SLIDES[i].setup) SLIDES[i].setup(wiz);
  }

  btnBack.addEventListener("click", () => {
    if (wiz._setupIndex > 0) goTo(wiz._setupIndex - 1);
  });
  btnNext.addEventListener("click", async () => {
    const i = wiz._setupIndex;
    if (SLIDES[i].onNext) {
      try { await SLIDES[i].onNext(wiz); } catch {}
    }
    if (wiz._setupIndex < SLIDES.length - 1) goTo(wiz._setupIndex + 1);
  });
  btnFinish.addEventListener("click", () => {
    try { localStorage.setItem(COMPLETED_FLAG, "1"); } catch {}
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(wiz._setupState)); } catch {}
    closeWizard();
    if (!location.hash.startsWith("#/overview") && !location.hash.startsWith("#/notes")) {
      location.hash = "#/overview";
    }
  });
  btnSkip.addEventListener("click", () => {
    if (confirm("Skip the setup wizard? You can re-open it from Settings.")) {
      btnFinish.click();
    }
  });

  // Keyboard navigation
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (confirm("Exit setup? You can resume later from Settings.")) btnSkip.click();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      if (wiz._setupIndex < SLIDES.length - 1) btnNext.click();
      else btnFinish.click();
    } else if (e.key === "ArrowLeft") {
      btnBack.click();
    }
  };
  document.addEventListener("keydown", onKey);
  wiz._cleanup = () => document.removeEventListener("keydown", onKey);

  goTo(0);
  return true;
}

function closeWizard() {
  const wiz = document.getElementById("mnexus-setup-wizard");
  if (!wiz) return;
  if (wiz._cleanup) wiz._cleanup();
  wiz.classList.add("setup-wizard-hide");
  setTimeout(() => wiz.remove(), 300);
}

/** isSetupCompleted — used by main.js to decide whether to launch */
export function isSetupCompleted() {
  try { return localStorage.getItem(COMPLETED_FLAG) === "1"; }
  catch { return true; }
}

/** resetSetup — for Settings → Re-run setup wizard */
export function resetSetup() {
  try { localStorage.removeItem(COMPLETED_FLAG); } catch {}
}
