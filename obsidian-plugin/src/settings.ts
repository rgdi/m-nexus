// Pestaña de ajustes M-NEXUS v2 — con secciones para LLM, calendar, drawing, etc.

import { App, PluginSettingTab, Setting } from "obsidian";
import type MNexusPlugin from "./main";
import { MNexusSettings } from "./types";
import { OPENROUTER_POPULAR_MODELS } from "./constants";

export class MNexusSettingTab extends PluginSettingTab {
  private plugin: MNexusPlugin;

  constructor(app: App, plugin: MNexusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "M-NEXUS — Ajustes" });
    containerEl.createEl("p", {
      text: "Sistema de estudio médico con control humano obligatorio. La IA propone; tú apruebas.",
      cls: "setting-item-description",
    });

    this.renderOnboarding(containerEl);
    this.renderCarpetas(containerEl);
    this.renderLevel(containerEl);
    this.renderWhisper(containerEl);
    this.renderOcr(containerEl);
    this.renderLlm(containerEl);
    this.renderRag(containerEl);
    this.renderHtr(containerEl);
    this.renderFsrs(containerEl);
    this.renderAuditoria(containerEl);
    this.renderSecurity(containerEl);
    this.renderCalendar(containerEl);
    this.renderGoogleCalendar(containerEl);
    this.renderSync(containerEl);
    this.renderDrawing(containerEl);
    this.renderUi(containerEl);
    this.renderNotificationsV17(containerEl);
  }

  private renderOnboarding(el: HTMLElement) {
    const banner = el.createDiv();
    banner.style.cssText = "padding:10px 14px;background:linear-gradient(135deg, #1f6feb 0%, #388bfd 100%);color:white;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:10px;";
    banner.createEl("span", { text: "👋" });
    const txt = banner.createDiv();
    txt.createEl("strong", { text: "¿Primera vez con M-NEXUS?" });
    txt.createEl("div", { text: "Te guiamos paso a paso en 5 minutos.", cls: "mnexus-label" }).style.color = "rgba(255,255,255,0.85)";
    const btn = banner.createEl("button", { text: "Empezar tour →" });
    btn.style.cssText = "margin-left:auto;background:white;color:#1f6feb;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:600;";
    btn.onclick = () => this.plugin.openOnboardingWizard();
  }

  // ─── Secciones ────────────────────────────────────────────────────────

  private renderLevel(el: HTMLElement) {
    el.createEl("h3", { text: "Nivel académico (taxonomía M-NEXUS)" });
    el.createEl("p", {
      text: "El sistema adapta la complejidad del LLM (RAG, viñetas, socrático) según tu curso. Puedes override por nota usando el frontmatter `level: 3_MED`.",
      cls: "setting-item-description",
    });
    this.dropdown(el, "Nivel actual", "userLevel", {
      "1_MED": "1º Medicina (ciencias básicas)",
      "2_MED": "2º Medicina (fisiología + micro)",
      "3_MED": "3º Medicina (patología + semiología)",
      "4_MED": "4º Medicina (medicina interna)",
      "5_MED": "5º Medicina (prácticas + MIR)",
      "6_MED_MIR": "6º Medicina / MIR (examen)",
      custom: "Personalizado (sin restricción)",
    });
    this.toggle(el, "Inyectar nivel en prompts", "levelAware",
      "Si está activo, RAG, viñetas y socrático adaptan su vocabulario y profundidad.");
    this.number(el, "Estabilidad mínima para promoción (días)", "levelPromotionStability",
      "Si tu estabilidad media en el nivel actual supera este valor, se sugerirá subir.");
    this.number(el, "% mínimo de tarjetas estables para promoción", "levelPromotionMinRatio",
      "Porcentaje de tarjetas en review con estabilidad >= al mínimo, para recomendar promoción.");
  }

  private renderCarpetas(el: HTMLElement) {
    el.createEl("h3", { text: "Carpetas" });
    this.text(el, "Inbox / En Espera", "inboxFolder");
    this.text(el, "Borradores de flashcards", "flashcardsDraftFolder");
    this.text(el, "Flashcards aprobadas", "flashcardsApprovedFolder");
    this.text(el, "Transcripciones", "transcriptionsFolder");
    this.text(el, "Manuscritos / OCR", "handwrittenFolder");
    this.text(el, "Dibujos", "drawingsFolder");
    this.text(el, "Templates custom", "templatesFolder");
  }

  private renderWhisper(el: HTMLElement) {
    el.createEl("h3", { text: "Whisper (transcripción local)" });
    this.dropdown(el, "Backend", "transcriptionBackend", {
      "local-script": "Script local (recomendado, autoinstalable)",
      "whisper-cpp": "whisper.cpp CLI",
      "openai-api": "OpenAI API (de pago)",
      disabled: "Deshabilitado",
    });
    this.text(el, "Ruta de Python (opcional)", "whisperPythonPath", "Déjalo vacío para usar 'python3' del PATH.");
    this.text(el, "Ruta del script Whisper", "whisperScriptPath", "Si usas local-script. Se crea automáticamente al instalar Whisper.");
    this.text(el, "Modelo Whisper", "whisperModel", "tiny, base, small, medium, large-v3");
    this.text(el, "Idioma", "whisperLanguage", "es, en, etc.");

    // Botón de instalación
    const installRow = el.createDiv();
    installRow.style.marginTop = "8px";
    const installBtn = installRow.createEl("button", { text: "📦 Instalar Whisper (autoinstalación)" });
    installBtn.onclick = () => this.plugin.openWhisperInstaller();

    const status = installRow.createEl("span", { cls: "mnexus-label" });
    status.style.marginLeft = "8px";
    this.plugin
      .checkWhisperInstalled()
      .then((r) => (status.textContent = r.installed ? "✔ instalado" : "✖ no instalado"));
  }

  private renderOcr(el: HTMLElement) {
    el.createEl("h3", { text: "OCR (manuscritos)" });
    this.dropdown(el, "Backend", "ocrBackend", {
      tesseract: "Tesseract CLI",
      "local-llm": "LLM local (LLaVA, etc.)",
      cloud: "Servicio cloud",
      disabled: "Deshabilitado",
    });
    this.text(el, "Ruta del script OCR", "ocrScriptPath");
  }

  private renderLlm(el: HTMLElement) {
    el.createEl("h3", { text: "LLM (generación de flashcards, auditoría avanzada)" });
    this.dropdown(el, "Proveedor", "llmProvider", {
      openrouter: "OpenRouter (API)",
      ollama: "Ollama (local, próximo)",
      "openai-compatible": "OpenAI-compatible (próximo)",
      disabled: "Deshabilitado (solo fallback local)",
    });
    this.text(el, "API key de OpenRouter", "openrouterApiKey", "https://openrouter.ai/keys");
    this.text(el, "Base URL OpenRouter", "openrouterBaseUrl");
    this.text(el, "Base URL Ollama", "ollamaBaseUrl");

    // Modelo: dropdown con los populares + input libre
    new Setting(el)
      .setName("Modelo")
      .setDesc("Escribe cualquier id de OpenRouter o elige uno popular.")
      .addDropdown((d) => {
        for (const m of OPENROUTER_POPULAR_MODELS) d.addOption(m.id, m.name);
        d.setValue(this.plugin.settings.llmModel);
        d.onChange(async (v) => {
          (this.plugin.settings as unknown as Record<string, unknown>).llmModel = v;
          await this.plugin.saveSettings();
        });
      })
      .addText((t) => {
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          (this.plugin.settings as unknown as Record<string, unknown>).llmModel = v;
          await this.plugin.saveSettings();
        });
      });

    this.slider(el, "Temperatura", "llmTemperature", 0, 1, 0.05);
    this.text(el, "Max tokens por respuesta", "llmMaxTokens");
  }

  private renderFsrs(el: HTMLElement) {
    el.createEl("h3", { text: "FSRS v5 — Repaso espaciado" });
    this.slider(el, "Retención objetivo", "fsrsRequestRetention", 0.5, 0.98, 0.01);
    this.text(el, "Intervalo máximo (días)", "fsrsMaxIntervalDays");
    this.text(el, "Tope duro tarjetas/día", "dailyReviewCap");
    this.text(el, "Tope blando tarjetas/día", "softCap");
  }

  private renderAuditoria(el: HTMLElement) {
    el.createEl("h3", { text: "Auditoría" });
    this.toggle(el, "Activar check de cobertura", "enableCoverageAudit");
    this.toggle(el, "Usar LLM para auditoría profunda", "enableLlmAudit");
    this.slider(el, "Umbral de cobertura", "coverageThreshold", 0, 100, 5);
    this.toggle(el, "Preguntas socráticas activas", "enableSocraticPrompts");
  }

  // ─── Seguridad: JWT + E2E encryption ─────────────────────────────
  private renderSecurity(el: HTMLElement) {
    el.createEl("h3", { text: "Seguridad y privacidad (v0.12)" });
    el.createEl("p", {
      text: "M-NEXUS usa tokens JWT con auto-refresh y, opcionalmente, cifrado E2E para que el servidor no pueda leer tus notas marcadas como sensibles.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Estado de la sesión")
      .setDesc("Información del deviceId y última rotación de token.")
      .addButton((b) =>
        b.setButtonText("Ver estado").onClick(async () => {
          const status = await this.plugin.getAuthStatus();
          new (await import("obsidian")).Notice(JSON.stringify(status));
        })
      );

    new Setting(el)
      .setName("Ver log de auditoría")
      .setDesc("Accesos recientes al backend desde este dispositivo (últimas 50).")
      .addButton((b) =>
        b.setButtonText("Ver").onClick(async () => {
          const log = await this.plugin.fetchAuditLog();
          new (await import("obsidian")).Notice(JSON.stringify(log));
        })
      );

    new Setting(el)
      .setName("Revocar tokens")
      .setDesc("Cierra la sesión en todos los dispositivos que compartan tu cuenta (no recuperable).")
      .addButton((b) =>
        b.setButtonText("Revocar todos").setWarning().onClick(async () => {
          const ok = confirm("¿Revocar todos los tokens? Tendrás que volver a autenticarte.");
          if (ok) await this.plugin.revokeTokens();
        })
      );

    el.createEl("h4", { text: "Cifrado E2E (opcional)" });
    el.createEl("p", {
      text: "Genera una clave AES-GCM en este vault. Las notas con `encrypt: true` en el frontmatter se cifran antes de salir al servidor. Si pierdes la clave, no se pueden recuperar.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Clave E2E")
      .setDesc("El servidor NUNCA ve esta clave ni el contenido de las notas cifradas.")
      .addButton((b) =>
        b
          .setButtonText("Generar")
          .setDisabled((this.plugin as unknown as { hasE2EKey?: () => boolean }).hasE2EKey?.() ?? false)
          .onClick(async () => {
            await this.plugin.generateE2EKey();
            new (await import("obsidian")).Notice("Clave E2E generada");
          })
      )
      .addButton((b) =>
        b.setButtonText("Backup cifrado").onClick(async () => {
          await this.plugin.exportE2EWithPassphrase();
        })
      )
      .addButton((b) =>
        b.setButtonText("Restaurar").onClick(async () => {
          await this.plugin.importE2EWithPassphrase();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Borrar clave")
          .setWarning()
          .setDisabled(!((this.plugin as unknown as { hasE2EKey?: () => boolean }).hasE2EKey?.() ?? false))
          .onClick(async () => {
            if (confirm("¿Borrar la clave? Las notas cifradas serán irrecuperables.")) {
              await this.plugin.clearE2EKey();
            }
          })
      );
  }

  private renderCalendar(el: HTMLElement) {
    el.createEl("h3", { text: "Calendario (iCal / ICS)" });
    this.toggle(el, "Activar sincronización de calendario", "enableCalendarSync");
    this.textarea(
      el,
      "URLs de calendarios ICS (uno por línea, acepta http(s)://, webcal://, o ruta local)",
      "calendarIcsUrlsRaw"
    );
    this.text(el, "Archivo .ics local (opcional)", "calendarLocalFile");
    this.textarea(el, "Keywords que identifican exámenes (uno por línea)", "calendarKeywordsRaw");
    this.text(el, "Intervalo de auto-sync (horas)", "calendarAutoSyncIntervalHours");

    const btnRow = el.createDiv();
    btnRow.style.marginTop = "8px";
    const previewBtn = btnRow.createEl("button", { text: "👁 Vista previa" });
    previewBtn.onclick = () => this.plugin.openCalendarModal();
    const syncBtn = btnRow.createEl("button", { text: "🔄 Sincronizar ahora" });
    syncBtn.style.marginLeft = "6px";
    syncBtn.onclick = () => this.plugin.runCalendarSync();
  }

  private renderDrawing(el: HTMLElement) {
    el.createEl("h3", { text: "Dibujo en notas" });
    this.dropdown(el, "Modo de dibujo", "drawingMode", {
      "svg-canvas": "Canvas SVG integrado",
      excalidraw: "Excalidraw (si está instalado)",
      "obsidian-canvas": "Obsidian Canvas nativo",
    });
  }

  private renderUi(el: HTMLElement) {
    el.createEl("h3", { text: "Interfaz" });
    this.toggle(el, "Mostrar panel al iniciar", "showDashboardOnStartup");
    this.toggle(el, "Mostrar iconos en la cinta", "showRibbonIcons");
  }

  private renderRag(el: HTMLElement) {
    el.createEl("h3", { text: "RAG (búsqueda y chat con tus notas)" });
    this.toggle(el, "Activar RAG (requiere LLM + embeddings)", "enableRag");
    this.slider(el, "Score mínimo de relevancia", "ragMinScore", 0, 1, 0.05);
    this.text(el, "Chunks a recuperar por consulta", "ragTopK");
    this.toggle(el, "Re-indexar automáticamente al cambiar notas", "ragAutoIndex");
    const idxBtn = el.createEl("button", { text: "🧠 Indexar vault ahora" });
    idxBtn.onclick = () => this.plugin.indexVaultAction();
  }

  private renderGoogleCalendar(el: HTMLElement) {
    el.createEl("h3", { text: "Google Calendar (OAuth)" });
    this.toggle(el, "Activar Google Calendar", "enableGoogleCalendar");
    this.text(el, "Client ID", "googleClientId", "Desde Google Cloud Console → APIs & Services → Credentials");
    this.text(el, "Client Secret", "googleClientSecret");
    const authBtn = el.createEl("button", { text: "🔑 Autorizar aplicación" });
    authBtn.onclick = () => this.plugin.authorizeGoogleCalendar();
    const syncBtn = el.createEl("button", { text: "🔄 Sincronizar Google Calendar" });
    syncBtn.style.marginLeft = "6px";
    syncBtn.onclick = () => this.plugin.runGoogleCalendarSync();
  }

  private renderHtr(el: HTMLElement) {
    el.createEl("h3", { text: "HTR — Handwriting to Text" });
    const help = el.createEl("p", {
      text: "Convierte escritura a mano en texto. Tres backends: Tesseract local (gratis, ok para handwriting limpio), MyScript Cloud (2000 requests/mes gratis, alta precisión) o un modelo local ML (TrOCR — implementación futura).",
      cls: "setting-item-description",
    });
    this.dropdown(el, "Backend", "htrBackend", {
      "rendered-ocr": "Tesseract local (renderiza trazos a PNG)",
      myscript: "MyScript Cloud (gratis hasta 2000/mes)",
      "local-ml": "Modelo local (TrOCR — próximo)",
      disabled: "Deshabilitado",
    });
    this.text(el, "Ruta del script OCR (Tesseract)", "htrScriptPath", "Se crea automáticamente al instalar.");
    this.text(el, "Idioma", "htrLanguage", "spa, eng, etc. Para varios: 'spa+eng'");
    this.toggle(el, "Ofrecer reconocer al cerrar dibujo", "htrAutoRecognize");
    el.createEl("h4", { text: "MyScript Cloud" });
    this.text(el, "App Key", "myscriptAppKey", "Gratis en developer.myscript.com");
    this.text(el, "App Secret", "myscriptAppSecret");
  }

  private renderSync(el: HTMLElement) {
    el.createEl("h3", { text: "Sincronización cross-device (WebDAV)" });
    this.dropdown(el, "Backend de sync", "syncBackend", {
      disabled: "Deshabilitado",
      webdav: "WebDAV (Nextcloud, ownCloud, etc.)",
      "google-drive": "Google Drive (próximamente)",
      dropbox: "Dropbox (próximamente)",
    });
    this.text(el, "URL del servidor WebDAV", "webdavUrl", "Ej: https://cloud.example.com/remote.php/dav/files/user/");
    this.text(el, "Usuario", "webdavUsername");
    this.text(el, "Contraseña / App token", "webdavPassword");
    this.text(el, "Subcarpeta", "webdavBasePath", "Ruta dentro del servidor, ej: /Obsidian/");
    this.toggle(el, "Sincronizar al cambiar archivos", "autoSyncOnChange");
    const testBtn = el.createEl("button", { text: "🔌 Probar conexión" });
    testBtn.onclick = async () => {
      testBtn.textContent = "Probando…";
      const ok = await this.plugin.testWebDavConnection();
      testBtn.textContent = ok ? "✔ OK" : "✖ Falló";
      setTimeout(() => (testBtn.textContent = "🔌 Probar conexión"), 3000);
    };
    const syncBtn = el.createEl("button", { text: "🔄 Sincronizar ahora" });
    syncBtn.style.marginLeft = "6px";
    syncBtn.onclick = () => this.plugin.runWebDavSync();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private text(el: HTMLElement, name: string, key: keyof MNexusSettings, desc?: string) {
    new Setting(el)
      .setName(name)
      .setDesc(desc ?? "")
      .addText((t) => {
        const numKey = ["dailyReviewCap", "softCap", "fsrsMaxIntervalDays", "llmMaxTokens", "calendarAutoSyncIntervalHours"].includes(
          key as string
        );
        t.setValue(String(this.plugin.settings[key] ?? ""))
          .onChange(async (v) => {
            (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = numKey ? Number(v) : v;
            await this.plugin.saveSettings();
          });
      });
  }

  private toggle(el: HTMLElement, name: string, key: keyof MNexusSettings, desc?: string) {
    new Setting(el)
      .setName(name)
      .setDesc(desc ?? "")
      .addToggle((tg) =>
        tg.setValue(Boolean(this.plugin.settings[key])).onChange(async (v) => {
          (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v;
          await this.plugin.saveSettings();
        })
      );
  }

  private number(el: HTMLElement, name: string, key: keyof MNexusSettings, desc?: string) {
    new Setting(el)
      .setName(name)
      .setDesc(desc ?? "")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.plugin.settings[key] ?? 0)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n)) {
            (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = n;
            await this.plugin.saveSettings();
          }
        });
      });
  }

  private slider(el: HTMLElement, name: string, key: keyof MNexusSettings, min: number, max: number, step: number, desc?: string) {
    new Setting(el)
      .setName(name)
      .setDesc(desc ?? "")
      .addSlider((s) =>
        s
          .setLimits(min, max, step)
          .setValue(Number(this.plugin.settings[key]))
          .setDynamicTooltip()
          .onChange(async (v) => {
            (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v;
            await this.plugin.saveSettings();
          })
      );
  }

  private dropdown(el: HTMLElement, name: string, key: keyof MNexusSettings, options: Record<string, string>) {
    new Setting(el)
      .setName(name)
      .addDropdown((d) => {
        for (const [v, l] of Object.entries(options)) d.addOption(v, l);
        d.setValue(String(this.plugin.settings[key]));
        d.onChange(async (v) => {
          (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v;
          await this.plugin.saveSettings();
        });
      });
  }

  private textarea(el: HTMLElement, name: string, key: keyof MNexusSettings | string) {
    new Setting(el)
      .setName(name)
      .addTextArea((t) => {
        const arrKey = ["calendarIcsUrlsRaw", "calendarKeywordsRaw"].includes(key as string);
        let value = "";
        if (arrKey) {
          const arr = (this.plugin.settings as unknown as Record<string, unknown[]>)[key as string] ?? [];
          value = arr.join("\n");
        } else {
          value = String((this.plugin.settings as unknown as Record<string, unknown>)[key as string] ?? "");
        }
        t.setValue(value).onChange(async (v) => {
          if (arrKey) {
            (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            (this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v;
          }
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
      });
  }

  // ─── v0.17: Notificaciones y monitor ─────────────────────────────
  private renderNotificationsV17(el: HTMLElement) {
    el.createEl("h3", { text: "Notificaciones y monitor (v0.17)" });
    el.createEl("p", {
      text: "Configura cómo y cuándo M-NEXUS te avisa sobre adherencia, exámenes próximos y rachas. También puedes silenciar temporalmente (modo focus).",
      cls: "setting-item-description",
    });

    this.toggle(el, "Notificaciones habilitadas", "notificationsEnabled",
      "Si se desactivan, no se mostrarán avisos de ningún tipo.");
    this.toggle(el, "Monitor en background", "monitorEnabled",
      "Si está activo, M-NEXUS revisa tu progreso cada N horas y notifica al detectar caídas.");

    this.slider(el, "Intervalo del monitor (horas)", "monitorIntervalHours", 1, 24, 1);
    this.slider(el, "Umbral adherencia crítica (×100)", "notificationAdherenceThreshold", 0, 100, 5);
    this.text(el, "Días aviso examen (separados por coma)", "notificationExamApproachingDays",
      "Ej: '14,7,3,1' para avisar 14, 7, 3 y 1 día antes.");
    this.slider(el, "Máx notificaciones/día", "notificationMaxPerDay", 1, 20, 1);
    this.toggle(el, "Avisar si racha en riesgo", "notificationAlertStreakAtRisk",
      "Si estudiaste ayer pero no hoy, te avisa para no perder la racha.");

    // Botón: aplicar thresholds al servicio
    new Setting(el)
      .setName("Aplicar cambios al monitor")
      .setDesc("Fuerza la recarga de los thresholds y dispara un check inmediato.")
      .addButton((b) =>
        b.setButtonText("Aplicar ahora").onClick(() => {
          (this.plugin as unknown as { applyNotificationSettings?: () => void }).applyNotificationSettings?.();
          new (require("obsidian") as typeof import("obsidian")).Notice("Notificaciones aplicadas");
        })
      );
  }

  // ─── v0.19: Thresholds configurables + Study goals + Deep focus ───
  private renderV19Settings(el: HTMLElement) {
    el.createEl("h3", { text: "Avanzado (v0.19)" });
    el.createEl("p", {
      text: "Thresholds configurables para clock skew, persistencia, y study goals.",
      cls: "setting-item-description",
    });

    // Clock skew
    el.createEl("h4", { text: "Clock skew" });
    this.slider(el, "Umbral clock skew (ms)", "clockSkewThresholdMs", 0, 14_400_000, 60_000,
      "Si el gap entre dos eventos es mayor a este umbral, se detecta clock skew. Default 7200000ms (2h).");

    // Safe flush
    el.createEl("h4", { text: "Persistencia (SafeFlush)" });
    this.slider(el, "Reintentos de guardado", "safeFlushMaxRetries", 1, 10, 1,
      "Cuántas veces reintentar guardar en onunload antes de rendirse.");
    this.slider(el, "Delay inicial (ms)", "safeFlushInitialDelayMs", 100, 10_000, 100,
      "Tiempo de espera antes del primer reintento. Backoff exponencial después.");
    this.slider(el, "Factor de backoff (×100)", "safeFlushBackoffFactorX100", 100, 500, 50,
      "Multiplicador del delay entre reintentos. Default 200 (= 2×).");

    // Deep focus
    el.createEl("h4", { text: "Deep focus mode" });
    this.toggle(el, "Deep focus detiene el monitor", "deepFocusStopsMonitor",
      "Si está activo, el modo deep focus no solo silencia notificaciones sino que también detiene completamente el monitor en background (ahorra CPU/batería).");

    // Study goals
    el.createEl("h4", { text: "Study goals" });
    this.slider(el, "Goal diario (cards)", "dailyGoalCards", 1, 200, 5,
      "Cuántas cards debes repasar al día para completar el goal diario.");
    this.slider(el, "Goal semanal (cards)", "weeklyGoalCards", 1, 1000, 10,
      "Cuántas cards debes repasar a la semana.");
    this.slider(el, "Goal de racha (días)", "streakGoalDays", 1, 30, 1,
      "Cuántos días consecutivos debes estudiar para alcanzar el goal.");
    this.slider(el, "Goal de accuracy (×100)", "accuracyGoalRateX100", 0, 100, 5,
      "Porcentaje mínimo de respuestas correctas (rating >= 3).");
  }
}
