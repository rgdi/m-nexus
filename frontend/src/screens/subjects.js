/* ============================================================
 * screens/subjects.js — list + detail (grades, homework, e-books)
 * v1.3.0 — i18n integration
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { makeModal } from "../widgets/modal.js";

const state = { selectedId: null };

export async function renderSubjects(root) {
  if (state.selectedId) {
    return renderSubjectDetail(root, state.selectedId);
  }
  renderSubjectList(root);
}

async function renderSubjectList(root) {
  const subjects = await dataSource.subjects.list();

  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="${i18n.t("common.back")}">←</button>
        <h1 class="h-title">${i18n.t("dock.subjects")}</h1>
        <div class="spacer"></div>
        <button class="btn primary" id="new">${i18n.t("subjects.new")}</button>
      </header>
      <div class="grid grid-subj-rows" id="list">
        <div class="empty"><div class="em-title">${i18n.t("common.loading")}</div></div>
      </div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());
  root.querySelector("#new").addEventListener("click", () => openSubjectModal(null, () => renderSubjectList(root)));

  if (subjects.length === 0) {
    root.querySelector("#list").innerHTML = `<div class="empty"><div class="em-title">${i18n.t("subjects.noSubjects")}</div><div>${i18n.t("subjects.createFirst")}</div></div>`;
    return;
  }

  root.querySelector("#list").innerHTML = subjects.map(s => `
    <div class="subj-row" data-id="${s.id}">
      <div class="color-stripe" style="background:${s.color}"></div>
      <div class="info">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="meta">
          ${s.prof ? `<span>${escapeHtml(s.prof)}</span>` : ""}
          ${s.grade ? `<span class="grade">${(s.grade ?? 0).toFixed(2)}</span>` : ""}
          ${s.performance ? `<span class="perf">+${s.performance}%</span>` : ""}
        </div>
      </div>
      <div class="corner" style="background:${s.color}">${escapeHtml(s.icon || (s.name?.[0] ?? "?"))}</div>
    </div>
  `).join("");

  root.querySelectorAll(".subj-row").forEach((el) => {
    el.addEventListener("click", () => { state.selectedId = el.dataset.id; renderSubjects(root); });
  });
}

async function renderSubjectDetail(root, id) {
  const s = await dataSource.subjects.get(id);
  if (!s) { state.selectedId = null; return renderSubjectList(root); }

  const grades = mockGrades(s.id);

  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <button class="btn icon" id="back">←</button>
        <h1 class="h-title">${escapeHtml(s.name)}</h1>
        <div class="spacer"></div>
      </header>
      <div class="tabs" role="tablist">
        <div class="tab active" data-tab="classes">${i18n.t("subjects.classes")}</div>
        <div class="tab" data-tab="topics">${i18n.t("subjects.topics")}</div>
      </div>
      <div id="tab-body" style="margin-top: var(--s-5)"></div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => { state.selectedId = null; renderSubjects(root); });
  const body = root.querySelector("#tab-body");
  const renderTab = () => {
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h4>${i18n.t("subjects.grades")} <span class="chip muted" style="margin-left:8px">${i18n.t("subjects.avg", { grade: (s.grade ?? 0).toFixed(2) })}</span></h4>
          <div style="margin-top: var(--s-3); display:flex; flex-wrap:wrap; gap: 6px">
            ${grades.map(g => `<span class="chip ${gClass(g)}">${g.toFixed(1)}</span>`).join("")}
          </div>
        </div>
        <div class="card">
          <h4>${i18n.t("subjects.homework")}</h4>
          <div class="col gap-2" style="margin-top: var(--s-3)">
            <div class="row gap-2"><span class="dot" style="background:var(--good)"></span><span class="small">Sep 14, 2023</span></div>
            <div class="small">Ex. 4* on p. 20, Additional Mathematics book</div>
            <div class="row gap-2" style="margin-top: var(--s-3)"><span class="dot" style="background:var(--warn)"></span><span class="small">Sep 20, 2023</span></div>
            <div class="small">Complete ex. 12, 13 on p. 24</div>
          </div>
        </div>
      </div>
      <h4 style="margin: var(--s-5) 0 var(--s-3)">${i18n.t("subjects.ebooks")} <span class="muted small" style="margin-left:8px">${i18n.t("subjects.seeAll")}</span></h4>
      <div class="book-grid">
        ${mockBooks(s.id).map(b => `
          <div class="book-card">
            <div class="cover" style="background:${b.bg}">${b.cover}</div>
            <div class="title">${escapeHtml(b.title)}</div>
          </div>
        `).join("")}
      </div>
      <h4 style="margin: var(--s-5) 0 var(--s-3)">${i18n.t("subjects.notebooks")} <span class="muted small" style="margin-left:8px">${i18n.t("subjects.seeAll")}</span></h4>
      <div class="book-grid">
        ${mockNotebooks(s.id).map(b => `
          <div class="book-card">
            <div class="cover" style="background:${b.bg};color:var(--fg)">${b.cover}</div>
            <div class="title">${escapeHtml(b.title)}</div>
          </div>
        `).join("")}
      </div>
    `;
  };
  root.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      root.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      renderTab();
    });
  });
  renderTab();
}

function gClass(g) {
  if (g >= 9) return "good";
  if (g >= 7) return "info";
  if (g >= 5) return "warn";
  return "bad";
}

function mockGrades(seed) {
  let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 2 ** 32; };
  const out = [];
  for (let i = 0; i < 18; i++) {
    const g = 4 + r() * 6.5;
    out.push(Math.round(g * 10) / 10);
  }
  return out;
}

function mockBooks(seed) {
  const titles = ["Additional Mathematics", "Advanced Geometry", "Linear Algebra", "The Math Book", "Kiselev's Geometry", "B.Sc. Mathematics", "Pure Mathematics 1"];
  return titles.slice(0, 4).map((t, i) => ({
    title: t,
    bg: ["#3b8aff", "#a02020", "#e8eaa0", "#0a0a0a"][i % 4],
    cover: i === 2 ? "" : t.split(" ").map(w => w[0]).slice(0, 2).join(""),
  }));
}

function mockNotebooks(seed) {
  return [
    { title: "Properties of fractions", bg: "#fff", cover: "📓" },
    { title: "Derivatives and dark matter", bg: "#fff", cover: "📓" },
    { title: "Lesson log: Analysis", bg: "#fff", cover: "📓" },
  ];
}

function openSubjectModal(id, onSaved) {
  dataSource.subjects.get(id).then((s) => {
    const subj = s || { name: "", icon: "", color: "var(--subj-blue)", grade: 7 };
    const colors = ["var(--subj-red)", "var(--subj-yellow)", "var(--subj-blue)", "var(--subj-purple)", "var(--subj-green)", "var(--subj-pink)", "var(--subj-orange)", "var(--subj-teal)"];
    const html = `
      <div class="sheet">
        <div class="sheet-header">
          <h3>${id ? i18n.t("subjects.edit") : i18n.t("subjects.new")}</h3>
          <button class="btn icon" data-close aria-label="${i18n.t("common.close")}">✕</button>
        </div>
        <div class="col gap-3">
          <input class="input" id="s-name" placeholder="${i18n.t("subjects.new")}" value="${escapeHtml(subj.name)}" />
          <input class="input" id="s-icon" placeholder="${i18n.t("subjects.icon")}" maxlength="2" value="${escapeHtml(subj.icon || "")}" />
          <div class="row gap-2" style="flex-wrap:wrap">
            ${colors.map(c => `<button data-c="${c}" class="dot" style="width:30px;height:30px;background:${c};border:2px solid ${c === subj.color ? "var(--fg)" : "transparent"}"></button>`).join("")}
          </div>
          <input class="input" id="s-grade" type="number" min="0" max="10" step="0.01" placeholder="${i18n.t("subjects.grade")}" value="${subj.grade ?? ""}" />
          <div class="row gap-2">
            ${id ? `<button class="btn danger" data-act="del" style="margin-right:auto">${i18n.t("common.delete")}</button>` : ""}
            <button class="btn primary" data-act="save">${i18n.t("common.save")}</button>
          </div>
        </div>
      </div>
    `;
    const { scrim, close } = makeModal(html);
    document.body.appendChild(scrim);
    let chosenColor = subj.color;
    scrim.querySelectorAll('[data-c]').forEach((b) => b.addEventListener("click", () => {
      chosenColor = b.dataset.c;
      scrim.querySelectorAll('[data-c]').forEach(x => x.style.border = "2px solid transparent");
      b.style.border = "2px solid var(--fg)";
    }));
    scrim.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const name = scrim.querySelector("#s-name").value.trim();
      if (!name) return;
      const payload = {
        name,
        icon: scrim.querySelector("#s-icon").value,
        color: chosenColor,
        grade: parseFloat(scrim.querySelector("#s-grade").value) || null,
        performance: subj.performance ?? 0,
        prof: subj.prof ?? "",
        next: subj.next ?? "",
      };
      if (id) await dataSource.subjects.update(id, payload);
      else await dataSource.subjects.create(payload);
      close();
      onSaved?.();
    });
    scrim.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
      await dataSource.subjects.remove(id);
      close();
      onSaved?.();
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
