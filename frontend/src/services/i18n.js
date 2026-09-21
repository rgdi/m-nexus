/* ============================================================
 * i18n.js — minimal translation system for M-NEXUS frontend.
 * v1.3.0 — es / en / pt with localStorage persistence + auto-detect.
 *
 * No framework. Each screen calls `t("key")` and gets the string
 * for the active language. Missing keys fall back to English.
 * ============================================================ */

const STORAGE_KEY = "mnexus.lang";

/** All strings organized by key. Keep keys flat (no nesting). */
const STRINGS = {
  // ============================================================
  // App shell
  // ============================================================
  "app.title":               { en: "Education Service", es: "Education Service", pt: "Education Service" },
  "app.tagline":             { en: "Always at hand",     es: "always at hand",     pt: "sempre à mão" },

  // ============================================================
  // Dock
  // ============================================================
  "dock.overview":           { en: "Overview", es: "Resumen",   pt: "Visão geral" },
  "dock.calendar":           { en: "Calendar", es: "Calendario",pt: "Calendário" },
  "dock.subjects":           { en: "Subjects", es: "Asignaturas",pt: "Disciplinas" },
  "dock.notes":              { en: "Notes",    es: "Notas",     pt: "Notas" },
  "dock.todos":              { en: "To-dos",   es: "Tareas",    pt: "Tarefas" },
  "dock.tutor":              { en: "AI",       es: "IA",        pt: "IA" },
  "dock.settings":           { en: "Settings", es: "Ajustes",   pt: "Ajustes" },
  "dock.cluster":            { en: "Cluster",  es: "Cluster",   pt: "Cluster" },

  // ============================================================
  // Overview screen
  // ============================================================
  "overview.todaySchedule":  { en: "TODAY'S SCHEDULE", es: "AGENDA DE HOY", pt: "AGENDA DE HOJE" },
  "overview.subjects":       { en: "SUBJECTS",         es: "ASIGNATURAS",   pt: "DISCIPLINAS" },
  "overview.atGlance":       { en: "AT A GLANCE",      es: "DE UN VISTAZO",  pt: "NUM OLHADA" },
  "overview.quickNotes":     { en: "QUICK NOTES",      es: "NOTAS RÁPIDAS",  pt: "NOTAS RÁPIDAS" },
  "overview.crossVerify":    { en: "Cross-verify notes ↔ recordings", es: "Cruzar notas ↔ grabaciones", pt: "Cruzar notas ↔ gravações" },
  "overview.exam":            { en: "Generate exam (FSRS-aware)", es: "Generar examen (con FSRS)", pt: "Gerar exame (com FSRS)" },
  "overview.dueToday":       { en: "Due today",        es: "Para hoy",       pt: "Para hoje" },
  "overview.openTasks":      { en: "open tasks total", es: "tareas abiertas",pt: "tarefas abertas" },
  "overview.nextReferat":    { en: "Next deadline",    es: "Próxima entrega", pt: "Próxima entrega" },
  "overview.noDeadline":     { en: "no deadline this week", es: "sin entrega esta semana", pt: "sem entrega esta semana" },
  "overview.avgGrade":       { en: "Avg grade",        es: "Nota media",     pt: "Nota média" },
  "overview.acrossSubjects": { en: "across {n} subjects", es: "en {n} asignaturas", pt: "em {n} disciplinas" },
  "overview.noEvents":       { en: "No events scheduled today", es: "Sin eventos hoy", pt: "Sem eventos hoje" },
  "overview.referatBadge":   { en: "Next deadline: {time}", es: "Próxima entrega: {time}", pt: "Próxima entrega: {time}" },

  // ============================================================
  // Calendar screen
  // ============================================================
  "calendar.day":            { en: "Day",     es: "Día",     pt: "Dia" },
  "calendar.week":           { en: "Week",    es: "Semana",  pt: "Semana" },
  "calendar.create":         { en: "+ Create event", es: "+ Crear evento", pt: "+ Criar evento" },
  "calendar.detail.when":    { en: "When", es: "Cuándo", pt: "Quando" },
  "calendar.detail.linkedNotes":{en: "Linked notes", es: "Notas vinculadas", pt: "Notas vinculadas"},
  "calendar.detail.noNotes": { en: "No notes linked to this event yet. Take one now →", es: "No hay notas vinculadas. ¡Toma una ahora →", pt: "Sem notas vinculadas. Tire uma agora →" },
  "calendar.edit":           { en: "Edit event", es: "Editar evento", pt: "Editar evento" },
  "calendar.new":            { en: "New event", es: "Nuevo evento", pt: "Novo evento" },
  "calendar.title":          { en: "Title", es: "Título", pt: "Título" },
  "calendar.prof":           { en: "Prof / Teacher", es: "Profesor", pt: "Professor" },
  "calendar.room":           { en: "Room", es: "Aula", pt: "Sala" },
  "calendar.start":          { en: "Start", es: "Inicio", pt: "Início" },
  "calendar.end":            { en: "End", es: "Fin", pt: "Fim" },
  "calendar.type":           { en: "Type", es: "Tipo", pt: "Tipo" },
  "calendar.type.lecture":   { en: "Lecture", es: "Clase", pt: "Aula" },
  "calendar.type.homework":  { en: "Homework", es: "Tarea", pt: "Trabalho" },
  "calendar.type.referat":   { en: "Referat", es: "Referat", pt: "Referat" },
  "calendar.type.exam":      { en: "Exam", es: "Examen", pt: "Exame" },
  "calendar.save":           { en: "Save", es: "Guardar", pt: "Guardar" },
  "calendar.delete":         { en: "Delete", es: "Eliminar", pt: "Excluir" },
  "calendar.cancel":         { en: "Cancel", es: "Cancelar", pt: "Cancelar" },
  "calendar.confirm":        { en: "Confirm", es: "Confirmar", pt: "Confirmar" },
  "calendar.deleteConfirm":  { en: "¿Eliminar?", es: "¿Eliminar?", pt: "Excluir?" },

  // ============================================================
  // Subjects screen
  // ============================================================
  "subjects.new":           { en: "+ New subject", es: "+ Nueva asignatura", pt: "+ Nova disciplina" },
  "subjects.edit":          { en: "Edit subject", es: "Editar asignatura", pt: "Editar disciplina" },
  "subjects.classes":        { en: "Classes", es: "Clases", pt: "Aulas" },
  "subjects.topics":         { en: "Topics",  es: "Temas",  pt: "Tópicos" },
  "subjects.grades":         { en: "Grades",  es: "Notas",  pt: "Notas" },
  "subjects.avg":            { en: "Avg {grade}", es: "Media {grade}", pt: "Média {grade}" },
  "subjects.homework":       { en: "Homework", es: "Tareas", pt: "Trabalhos" },
  "subjects.ebooks":         { en: "E-books", es: "E-books", pt: "E-books" },
  "subjects.notebooks":      { en: "Notebooks", es: "Cuadernos", pt: "Cadernos" },
  "subjects.seeAll":         { en: "See all", es: "Ver todo", pt: "Ver tudo" },
  "subjects.performance":    { en: "{pct}% performance", es: "{pct}% rendimiento", pt: "{pct}% desempenho" },
  "subjects.search":         { en: "Search subjects", es: "Buscar asignaturas", pt: "Buscar disciplinas" },
  "subjects.noSubjects":     { en: "No subjects yet", es: "Sin asignaturas", pt: "Sem disciplinas" },
  "subjects.createFirst":    { en: "Create your first subject to get started.", es: "Crea tu primera asignatura para empezar.", pt: "Crie sua primeira disciplina para começar." },
  "subjects.icon":           { en: "Icon letter", es: "Inicial", pt: "Inicial" },
  "subjects.grade":          { en: "Grade", es: "Nota", pt: "Nota" },

  // ============================================================
  // Notes screen (notebook)
  // ============================================================
  "notes.new":              { en: "+ New note", es: "+ Nueva nota", pt: "+ Nova nota" },
  "notes.search":           { en: "Search notebooks", es: "Buscar cuadernos", pt: "Buscar cadernos" },
  "notes.intelligentOverview": { en: "✦ Intelligent overview", es: "✦ Resumen inteligente", pt: "✦ Visão inteligente" },
  "notes.page":             { en: "Page {current}/{total}", es: "Página {current}/{total}", pt: "Página {current}/{total}" },
  "notes.tool.pen":         { en: "Pen", es: "Lápiz", pt: "Caneta" },
  "notes.tool.highlighter": { en: "Highlighter", es: "Marcador", pt: "Marcador" },
  "notes.tool.eraser":      { en: "Eraser", es: "Borrador", pt: "Borracha" },
  "notes.tool.select":      { en: "Select", es: "Seleccionar", pt: "Selecionar" },
  "notes.tool.ruler":       { en: "Ruler", es: "Regla", pt: "Régua" },
  "notes.tool.voice":       { en: "Voice", es: "Voz", pt: "Voz" },
  "notes.tool.code":        { en: "Code", es: "Código", pt: "Código" },
  "notes.tool.image":       { en: "Image", es: "Imagen", pt: "Imagem" },
  "notes.tool.graph":       { en: "Graph", es: "Gráfico", pt: "Gráfico" },
  "notes.tool.link":        { en: "Link", es: "Enlace", pt: "Link" },
  "notes.tool.table":       { en: "Table", es: "Tabla", pt: "Tabela" },
"notes.tool.undo":        { en: "Undo", es: "Deshacer", pt: "Desfazer" },
  "notes.tool.redo":        { en: "Redo", es: "Rehacer", pt: "Refazer" },
  "notes.overviewTitle":    { en: "Intelligent overview", es: "Resumen inteligente", pt: "Visão inteligente" },
  "notes.overviewSubtitle": { en: "Generated from {n} page(s) of handwriting and text.", es: "Generado de {n} página(s) de escritura y texto.", pt: "Gerado de {n} página(s) de manuscrito e texto." },
  "notes.overviewEmpty":    { en: "No content yet. Start writing!", es: "Sin contenido. ¡Empieza a escribir!", pt: "Sem conteúdo. Comece a escrever!" },
  // v1.5.1 — flashcards
  "notes.textHint":         { en: "Write text below. Use ==underline==, !!highlight!!, [[wikilinks]], {{c1::front::back}} for flashcards, @book/part for references.", es: "Escribe texto abajo. Usa ==subrayado==, !!resaltado!!, [[wikilinks]], {{c1::pregunta::respuesta}} para flashcards, @libro/parte para referencias.", pt: "Escreva abaixo. Use ==sublinhado==, !!destaque!!, [[wikilinks]], {{c1::frente::verso}} para flashcards, @livro/parte para referências." },
  "notes.extractFlashcards":{ en: "🎴 Extract flashcards", es: "🎴 Extraer flashcards", pt: "🎴 Extrair flashcards" },
  "notes.newFlashcard":     { en: "🎴 New flashcard", es: "🎴 Nueva flashcard", pt: "🎴 Nova flashcard" },
  "notes.editFlashcard":    { en: "Edit flashcard", es: "Editar flashcard", pt: "Editar flashcard" },
  "notes.flashcardsTitle":  { en: "Flashcards", es: "Flashcards", pt: "Flashcards" },
  "notes.flashcardsSubtitle":{ en: "{created} created · {skipped} skipped · {total} total", es: "{created} creadas · {skipped} omitidas · {total} total", pt: "{created} criadas · {skipped} ignoradas · {total} total" },
  "notes.flashcardFront":   { en: "Front (question)", es: "Anverso (pregunta)", pt: "Frente (pergunta)" },
  "notes.flashcardBack":    { en: "Back (answer)", es: "Reverso (respuesta)", pt: "Verso (resposta)" },
  "notes.flashcardSubject": { en: "Subject (auto from note)", es: "Asignatura (auto de la nota)", pt: "Disciplina (auto da nota)" },
  "notes.flashcardFrontPh": { en: "What's the capital of France?", es: "¿Cuál es la capital de Francia?", pt: "Qual é a capital da França?" },
  "notes.flashcardBackPh":  { en: "Paris", es: "París", pt: "Paris" },
  "notes.flashcardRequired":{ en: "Front and back are required", es: "Anverso y reverso son obligatorios", pt: "Frente e verso são obrigatórios" },
  "notes.flashcardSourceNote": { en: "From: {note}", es: "De: {note}", pt: "De: {note}" },
  "notes.noFlashcards":     { en: "No flashcards yet", es: "Aún no hay flashcards", pt: "Ainda sem flashcards" },
  "notes.noNotesWithTag":   { en: "No notes with tag #{tag}", es: "No hay notas con la etiqueta #{tag}", pt: "Sem notas com a etiqueta #{tag}" },
  "notes.tryOtherTag":       { en: "Try a different tag or clear the filter.", es: "Prueba otra etiqueta o limpia el filtro.", pt: "Tente outra etiqueta ou limpe o filtro." },
  "notes.study":            { en: "Study (FSRS)", es: "Estudiar (FSRS)", pt: "Estudar (FSRS)" },
  "notes.flashcardHint":    { en: "Use {{c1::front::back}} in the text or click + new", es: "Usa {{c1::pregunta::respuesta}} en el texto o pulsa + nueva", pt: "Use {{c1::frente::verso}} no texto ou clique + nova" },
  // v1.6.1 — AI submenu
  "notes.ai.summarize":     { en: "Summarize note", es: "Resumir nota", pt: "Resumir nota" },
  "notes.ai.define":        { en: "Define words", es: "Definir palabras", pt: "Definir palavras" },
  "notes.ai.quiz":          { en: "Quiz me (from flashcards)", es: "Pregúntame (con flashcards)", pt: "Teste-me (com flashcards)" },
  "notes.ai.cloze":         { en: "Cloze test (open deletion)", es: "Test cloze (eliminación abierta)", pt: "Teste cloze (eliminación aberta)" },
  "notes.ai.stubNote":      { en: "(local stub — production calls AI tutor)", es: "(stub local — en producción llama al tutor AI)", pt: "(stub local — em produção chama o tutor AI)" },
  "notes.ai.defineSubtitle":{ en: "Pick a word to look up:", es: "Elige una palabra para consultar:", pt: "Escolha uma palavra para consultar:" },
  "notes.ai.noFlashcardsYet":{en: "Generate flashcards first.", es: "Genera flashcards primero.", pt: "Gere flashcards primeiro." },
  "notes.ai.quizQ":         { en: "Question", es: "Pregunta", pt: "Pergunta" },
  "notes.ai.quizCorrect":   { en: "Correct!", es: "¡Correcto!", pt: "Correto!" },
  "notes.ai.quizIncorrect": { en: "Incorrect. Correct answer", es: "Incorrecto. Respuesta correcta", pt: "Incorreto. Resposta correta" },
  "notes.ai.quizDone":      { en: "Quiz finished. Score", es: "Quiz terminado. Puntuación", pt: "Quiz terminado. Pontuação" },
  "notes.deletePencil":     { en: "Delete pencil", es: "Eliminar lápiz", pt: "Excluir caneta" },
  "notes.deletePencilConfirm": { en: "¿Eliminar el lápiz activo?", es: "¿Eliminar el lápiz activo?", pt: "Excluir a caneta ativa?" },
  "notes.untitled":         { en: "Untitled", es: "Sin título", pt: "Sem título" },
  "notes.body":              { en: "Note", es: "Nota", pt: "Nota" },
  "notes.notes":             { en: "Notes", es: "Notas", pt: "Notas" },
  "notes.hasStrokes":       { en: "This page has drawings (view on tablet)", es: "Esta página tiene dibujos (ver en tablet)", pt: "Esta página tem desenhos (ver no tablet)" },
  "notes.collapse":          { en: "Hide", es: "Ocultar", pt: "Ocultar" },
  "notes.expand":            { en: "Show", es: "Mostrar", pt: "Mostrar" },
  "notes.resize":            { en: "Drag to resize", es: "Arrastra para redimensionar", pt: "Arraste para redimensionar" },
  "notes.newFolder":         { en: "New folder", es: "Nueva carpeta", pt: "Nova pasta" },
  "notes.folderName":        { en: "Folder name", es: "Nombre de carpeta", pt: "Nome da pasta" },
  "notes.selectFromTree":    { en: "Select from sidebar →", es: "Selecciona desde la barra lateral →", pt: "Selecione da barra lateral →" },
  "notes.noNotes":          { en: "No notebooks yet", es: "Sin cuadernos", pt: "Sem cadernos" },
  "notes.createFirst":      { en: "Create one to get started.", es: "Crea uno para empezar.", pt: "Crie um para começar." },

  // ============================================================
  // To-do's screen
  // ============================================================
  "todos.new":              { en: "+ New task", es: "+ Nueva tarea", pt: "+ Nova tarefa" },
  "todos.open":             { en: "Open", es: "Abiertas", pt: "Abertas" },
  "todos.done":             { en: "Done", es: "Hechas", pt: "Feitas" },
  "todos.overdue":          { en: "Overdue", es: "Vencidas", pt: "Atrasadas" },
  "todos.empty":            { en: "All clear", es: "Todo al día", pt: "Tudo em dia" },
  "todos.emptySub":         { en: "No pending tasks.", es: "Sin tareas pendientes.", pt: "Sem tarefas pendentes." },
  "todos.overdueBadge":     { en: "OVERDUE", es: "VENCIDA", pt: "ATRASADA" },
  "todos.normal":           { en: "Normal", es: "Normal", pt: "Normal" },
  "todos.medium":           { en: "🔼 Medium", es: "🔼 Media", pt: "🔼 Média" },
  "todos.urgent":           { en: "🔺 Urgent", es: "🔺 Urgente", pt: "🔺 Urgente" },
  "todos.edit":             { en: "Edit task", es: "Editar tarea", pt: "Editar tarefa" },
  "todos.placeholder":      { en: "What needs to be done?", es: "¿Qué hay que hacer?", pt: "O que precisa ser feito?" },
  "todos.tag":              { en: "Subject / tag", es: "Asignatura / etiqueta", pt: "Disciplina / tag" },
  "todos.all":              { en: "All tasks", es: "Todas las tareas", pt: "Todas as tarefas" },
  "todos.pending":          { en: "Pending", es: "Pendientes", pt: "Pendentes" },
  "todos.completed":        { en: "Completed", es: "Completadas", pt: "Completas" },

  // ============================================================
  // AI Tutor
  // ============================================================
  "ai.title":               { en: "AI", es: "IA", pt: "IA" },
  "ai.subtitle":            { en: "Ask anything from your notes", es: "Pregunta lo que quieras sobre tus notas", pt: "Pergunte o que quiser sobre suas notas" },
  "ai.lookingAt":           { en: "Looking at", es: "Mirando", pt: "A olhar para" },
  "ai.open":                { en: "Open AI", es: "Abrir IA", pt: "Abrir IA" },
  "ai.openFull":            { en: "Open full AI", es: "Abrir IA completa", pt: "Abrir IA completa" },
  "ai.action.clozes":       { en: "Generate Clozes", es: "Generar Clozes", pt: "Gerar Clozes" },
  "ai.action.summarize":    { en: "Summarize Note", es: "Resumir Nota", pt: "Resumir Nota" },
  "ai.action.flashcards":   { en: "Make Flashcards", es: "Crear Flashcards", pt: "Criar Flashcards" },
  "ai.action.explain":      { en: "Explain concept", es: "Explicar concepto", pt: "Explicar conceito" },
  "ai.greeting":            { en: "Hi! I'm your RAG tutor. Ask me anything about your notes.", es: "¡Hola! Soy tu tutor con RAG. Pregúntame sobre cualquier tema de tus notas.", pt: "Olá! Sou seu tutor com RAG. Pergunte sobre qualquer tema das suas notas." },
  "ai.placeholder":         { en: "Ask a question… (Enter to send)", es: "Haz una pregunta… (Enter para enviar)", pt: "Faça uma pergunta… (Enter para enviar)" },
  "ai.send":                { en: "Send", es: "Enviar", pt: "Enviar" },
  "ai.error":               { en: "Error: {msg}", es: "Error: {msg}", pt: "Erro: {msg}" },
  "ai.offline":             { en: "Offline mode — connect the backend for real RAG answers.", es: "Modo offline — conecta el backend para respuestas RAG reales.", pt: "Modo offline — conecte o backend para respostas RAG reais." },

  // ============================================================
  // Settings & misc
  // ============================================================
  "common.loading":         { en: "Loading…", es: "Cargando…", pt: "Carregando…" },
  "common.cancel":          { en: "Cancel", es: "Cancelar", pt: "Cancelar" },
  "common.save":            { en: "Save", es: "Guardar", pt: "Guardar" },
  "common.edit":            { en: "Edit", es: "Editar", pt: "Editar" },
  "common.delete":          { en: "Delete", es: "Eliminar", pt: "Excluir" },
  "common.close":           { en: "Close", es: "Cerrar", pt: "Fechar" },
  "common.back":            { en: "Back", es: "Atrás", pt: "Voltar" },
  "common.filter":          { en: "Filter", es: "Filtrar", pt: "Filtrar" },
  "common.search":          { en: "Search", es: "Buscar", pt: "Buscar" },
  "common.error":           { en: "Something went wrong", es: "Algo falló", pt: "Algo deu errado" },
  "common.offline":         { en: "Offline", es: "Sin conexión", pt: "Offline" },
  "common.online":          { en: "Online", es: "Conectado", pt: "Online" },

  // ============================================================
  // Settings screen (placeholder, future)
  // ============================================================
  "settings.title":         { en: "Settings", es: "Ajustes", pt: "Configurações" },
  "settings.language":      { en: "Language", es: "Idioma", pt: "Idioma" },
  "settings.theme":         { en: "Theme", es: "Tema", pt: "Tema" },
  "settings.about":         { en: "About", es: "Acerca de", pt: "Sobre" },
};

/**
 * v1.3.0: I18n singleton.
 */
class I18n {
  constructor() {
    this._lang = this._detect();
    this._listeners = new Set();
  }

  _detect() {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("mnexus.lang");
      if (saved && ["en", "es", "pt"].includes(saved)) return saved;
    }
    if (typeof navigator !== "undefined") {
      const n = (navigator.language || "en").toLowerCase();
      if (n.startsWith("es")) return "es";
      if (n.startsWith("pt")) return "pt";
    }
    return "en";
  }

  get lang() { return this._lang; }

  setLang(lang) {
    if (!["en", "es", "pt"].includes(lang)) return;
    this._lang = lang;
    try { localStorage.setItem("mnexus.lang", lang); } catch {}
    this._listeners.forEach((cb) => cb(lang));
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }

  subscribe(cb) {
    this._listeners.add(cb);
    cb(this._lang);
    return () => this._listeners.delete(cb);
  }

  /**
   * v1.3.0: translate a key. Placeholders: {key} replaced by args[key].
   * Falls back to English, then to key itself.
   */
  t(key, args = {}) {
    const entry = STRINGS[key];
    if (!entry) return key;
    const str = entry[this._lang] || entry.en || key;
    return str.replace(/\{(\w+)\}/g, (_, k) => args[k] ?? `{${k}}`);
  }

  /** Short alias. */
  _(key, args) { return this.t(key, args); }

  /** v1.3.0: list all available languages. */
  languages() {
    return [
      { code: "en", name: "English", flag: "🇬🇧" },
      { code: "es", name: "Español", flag: "🇪🇸" },
      { code: "pt", name: "Português", flag: "🇵🇹" },
    ];
  }

  /** v1.3.0: detect if a key is missing in a language (for validation). */
  isComplete(lang) {
    const missing = [];
    for (const [key, entry] of Object.entries(STRINGS)) {
      if (!entry[lang]) missing.push(key);
    }
    return { complete: missing.length === 0, missing };
  }
}

export const i18n = new I18n();

/* v2.6.0: login screen translations */
STRINGS["login.title"] = { es: "Iniciar sesión", en: "Sign in", pt: "Entrar" };
STRINGS["login.subtitle"] = { es: "Accede a tus notas, flashcards y backups", en: "Access your notes, flashcards and backups", pt: "Aceda às suas notas, flashcards e backups" };
STRINGS["login.username"] = { es: "Usuario", en: "Username", pt: "Usuário" };
STRINGS["login.password"] = { es: "Contraseña", en: "Password", pt: "Senha" };
STRINGS["login.submit"] = { es: "Entrar", en: "Sign in", pt: "Entrar" };
STRINGS["login.failed"] = { es: "Usuario o contraseña incorrectos", en: "Wrong username or password", pt: "Usuário ou senha incorretos" };
STRINGS["login.tooMany"] = { es: "Demasiados intentos. Espera {n}s", en: "Too many attempts. Wait {n}s", pt: "Muitas tentativas. Aguarde {n}s" };
STRINGS["login.locked"] = { es: "Cuenta bloqueada. Intenta en {n}s", en: "Account locked. Try in {n}s", pt: "Conta bloqueada. Tente em {n}s" };
STRINGS["login.networkError"] = { es: "Error de red", en: "Network error", pt: "Erro de rede" };
STRINGS["login.hint"] = { es: "Tu sesión dura 90 días en este dispositivo", en: "Your session lasts 90 days on this device", pt: "Sua sessão dura 90 dias neste dispositivo" };

/* v2.6.0: empty-state hints for new users */
STRINGS["overview.empty"] = { es: "Aún no tienes datos. ¿Quieres probar con datos de ejemplo?", en: "No data yet. Want to try with sample data?", pt: "Ainda não tem dados. Quer experimentar com dados de exemplo?" };
STRINGS["overview.loadDemo"] = { es: "🎁 Cargar datos demo", en: "🎁 Load sample data", pt: "🎁 Carregar dados demo" };

/* v2.6.0: settings screen AI + Backup management */
STRINGS["settings.test"] = { es: "Probar", en: "Test", pt: "Testar" };
STRINGS["settings.runNow"] = { es: "Ejecutar ahora", en: "Run now", pt: "Executar agora" };
STRINGS["settings.saving"] = { es: "Guardando…", en: "Saving…", pt: "Guardando…" };
STRINGS["settings.saved"] = { es: "Guardado", en: "Saved", pt: "Guardado" };
STRINGS["settings.testing"] = { es: "Probando…", en: "Testing…", pt: "Testando…" };
STRINGS["settings.running"] = { es: " Ejecutando…", en: " Running…", pt: " Executando…" };
STRINGS["settings.aiWorks"] = { es: "IA funciona", en: "AI works", pt: "IA funciona" };
STRINGS["settings.backupDone"] = { es: "Backup completado", en: "Backup done", pt: "Backup concluído" };

/* v2.6.0: side panel new tabs */
STRINGS["notes.cards"] = { es: "Tarjetas", en: "Cards", pt: "Cartões" };
STRINGS["notes.media"] = { es: "Adjuntos", en: "Media", pt: "Mídia" };
STRINGS["notes.list"] = { es: "Todas", en: "All", pt: "Todas" };
STRINGS["notes.cardsOf"] = { es: "Tarjetas de «{title}»", en: "Cards of «{title}»", pt: "Cartões de «{title}»" };
STRINGS["notes.attachmentsOf"] = { es: "Adjuntos de «{title}»", en: "Attachments of «{title}»", pt: "Anexos de «{title}»" };
STRINGS["notes.noCards"] = { es: "Sin tarjetas para esta nota.", en: "No cards yet for this note.", pt: "Sem cartões para esta nota." };
STRINGS["notes.noAttachments"] = { es: "Sin adjuntos. Usa la barra de adjuntos.", en: "No attachments. Use the attach bar.", pt: "Sem anexos." };
STRINGS["notes.cardsError"] = { es: "Error cargando tarjetas.", en: "Error loading cards.", pt: "Erro carregando cartões." };
STRINGS["notes.mediaError"] = { es: "Error cargando adjuntos.", en: "Error loading attachments.", pt: "Erro carregando anexos." };
STRINGS["notes.otherNotes"] = { es: "Otras notas", en: "Other notes", pt: "Outras notas" };
STRINGS["notes.noOtherWithAttachments"] = { es: "Ninguna otra nota tiene adjuntos.", en: "No other notes have attachments yet.", pt: "Nenhuma outra nota tem anexos." };
STRINGS["notes.allNotes"] = { es: "Todas las notas", en: "All notes", pt: "Todas as notas" };
STRINGS["notes.newCard"] = { es: "Nueva tarjeta", en: "New card", pt: "Novo cartão" };
STRINGS["notes.cardFront"] = { es: "Anverso (pregunta)", en: "Front (question)", pt: "Frente (pergunta)" };
STRINGS["notes.cardBack"] = { es: "Reverso (respuesta)", en: "Back (answer)", pt: "Verso (resposta)" };
STRINGS["common.noResults"] = { es: "Sin resultados.", en: "No results found.", pt: "Sem resultados." };
STRINGS["settings.exporting"] = { es: "Exportando…", en: "Exporting…", pt: "Exportando…" };
STRINGS["settings.exported"] = { es: "Exportado", en: "Exported", pt: "Exportado" };
STRINGS["settings.exportError"] = { es: "Error al exportar", en: "Export failed", pt: "Falha ao exportar" };
STRINGS["settings.openNoteFirst"] = { es: "Abre una nota primero", en: "Open a note first", pt: "Abra uma nota primeiro" };
STRINGS["common.offline"] = { es: "Sin conexión", en: "Offline", pt: "Offline" };
STRINGS["common.online"] = { es: "En línea", en: "Online", pt: "Online" };
STRINGS["ai.noContext"] = { es: "Abre una nota para obtener respuestas contextuales", en: "Open a note to get contextual answers", pt: "Abra uma nota para respostas contextuais" };
STRINGS["ai.openNote"] = { es: "Abrir una nota", en: "Open a note", pt: "Abrir uma nota" };
STRINGS["diagnostic.title"] = { es: "Diagnóstico de conocimiento", en: "Knowledge diagnostic", pt: "Diagnóstico de conhecimento" };
STRINGS["diagnostic.subtitle"] = { es: "Calibra FSRS antes de estudiar", en: "Calibrate FSRS before studying", pt: "Calibre o FSRS antes de estudar" };
STRINGS["diagnostic.s1.title"] = { es: "1. Elige tema y temario", en: "1. Pick a topic & syllabus", pt: "1. Escolha um tema e programa" };
STRINGS["diagnostic.s1.help"] = { es: "Pega tu temario abajo. Extraeremos conceptos clave.", en: "Paste your temario / syllabus below. We'll extract key concepts.", pt: "Cole seu programa abaixo. Extrairemos conceitos-chave." };
STRINGS["diagnostic.s1.loadSubject"] = { es: "Cargar desde asignatura", en: "Load from subject", pt: "Carregar da disciplina" };
STRINGS["diagnostic.s1.start"] = { es: "Generar preguntas →", en: "Generate questions →", pt: "Gerar perguntas →" };
STRINGS["diagnostic.s2.placeholder"] = { es: "Tu respuesta…", en: "Your answer…", pt: "Sua resposta…" };
STRINGS["diagnostic.s2.next"] = { es: "Siguiente →", en: "Next →", pt: "Próximo →" };
STRINGS["diagnostic.s2.finish"] = { es: "Terminar", en: "Finish", pt: "Terminar" };
STRINGS["diagnostic.s4.title"] = { es: "4. Tu perfil FSRS", en: "4. Your FSRS profile", pt: "4. Seu perfil FSRS" };
STRINGS["diagnostic.knowledge"] = { es: "Conocimiento", en: "Knowledge", pt: "Conhecimento" };
STRINGS["diagnostic.confidence"] = { es: "Confianza", en: "Confidence", pt: "Confiança" };
STRINGS["diagnostic.byConcept"] = { es: "Por concepto", en: "By concept", pt: "Por conceito" };
STRINGS["diagnostic.startStudy"] = { es: "Empezar a estudiar →", en: "Start studying →", pt: "Começar a estudar →" };
STRINGS["diagnostic.restart"] = { es: "Nuevo diagnóstico", en: "New diagnostic", pt: "Novo diagnóstico" };
STRINGS["approvals.title"] = { es: "Aprobaciones IA", en: "AI approvals", pt: "Aprovações IA" };
STRINGS["approvals.subtitle"] = { es: "Revisa y aprueba tarjetas sugeridas por IA", en: "Review and approve AI-suggested cards", pt: "Revise e aprove cartões sugeridos pela IA" };
STRINGS["approvals.empty"] = { es: "Sin candidatas pendientes", en: "No pending candidates", pt: "Sem candidatos pendentes" };
STRINGS["approvals.emptySub"] = { es: "Genera tarjetas con IA para ver sugerencias aquí.", en: "Generate flashcards with AI to see suggestions here.", pt: "Gere flashcards com IA para ver sugestões aqui." };
STRINGS["approvals.approve"] = { es: "Aprobar", en: "Approve", pt: "Aprovar" };
STRINGS["approvals.reject"] = { es: "Rechazar", en: "Reject", pt: "Rejeitar" };
STRINGS["simulator.title"] = { es: "Simulador de examen futuro", en: "Future-exam simulator", pt: "Simulador de exame futuro" };
STRINGS["simulator.subtitle"] = { es: "Simula tu trayectoria de estudio", en: "Simulate your study trajectory", pt: "Simule sua trajetória de estudo" };
STRINGS["simulator.topic"] = { es: "Tema", en: "Topic", pt: "Tema" };
STRINGS["simulator.examDays"] = { es: "Días hasta el examen", en: "Days until exam", pt: "Dias até o exame" };
STRINGS["simulator.dailyMin"] = { es: "Minutos diarios", en: "Daily study minutes", pt: "Minutos diários" };
STRINGS["simulator.knownRatio"] = { es: "Conocimiento previo", en: "Knowledge before start", pt: "Conhecimento prévio" };
STRINGS["simulator.run"] = { es: "Ejecutar simulación →", en: "Run simulation →", pt: "Executar simulação →" };
STRINGS["simulator.results"] = { es: "Resultados", en: "Results", pt: "Resultados" };
STRINGS["simulator.retention"] = { es: "Retención predicha el día del examen", en: "Predicted retention on exam day", pt: "Retenção prevista no dia do exame" };
STRINGS["simulator.daily"] = { es: "Plan diario", en: "Daily plan", pt: "Plano diário" };
STRINGS["diagnostic.s2.title"] = { es: "2. Pregunta {i} / {n}", en: "2. Question {i} / {n}", pt: "2. Pergunta {i} / {n}" };
STRINGS["occlusion.title"] = { es: "Image Occlusion", en: "Image Occlusion", pt: "Image Occlusion" };
STRINGS["occlusion.subtitle"] = { es: "Enmascara partes de una imagen para estudiarlas", en: "Mask parts of an image to study them", pt: "Mascare partes de uma imagem para estudá-las" };
STRINGS["occlusion.newCard"] = { es: "Crear nueva tarjeta de oclusión", en: "Create new occlusion card", pt: "Criar novo cartão de oclusão" };
STRINGS["occlusion.topic"] = { es: "Tema", en: "Topic", pt: "Tópico" };
STRINGS["occlusion.upload"] = { es: "Subir imagen", en: "Upload image", pt: "Carregar imagem" };
STRINGS["occlusion.url"] = { es: "Usar URL", en: "Use URL", pt: "Usar URL" };
STRINGS["occlusion.start"] = { es: "Empezar a editar →", en: "Start editing →", pt: "Começar a editar →" };
STRINGS["occlusion.urlRequired"] = { es: "URL de imagen requerida", en: "Image URL required", pt: "URL da imagem obrigatória" };
STRINGS["occlusion.fileRequired"] = { es: "Elige una imagen primero", en: "Pick an image first", pt: "Escolha uma imagem primeiro" };
STRINGS["occlusion.existing"] = { es: "Tarjetas de oclusión existentes", en: "Existing occlusion cards", pt: "Cartões de oclusão existentes" };
STRINGS["occlusion.none"] = { es: "Sin tarjetas de oclusión todavía.", en: "No occlusion cards yet.", pt: "Nenhum cartão de oclusão ainda." };
STRINGS["occlusion.help"] = { es: "Arrastra para dibujar máscaras. Click en una máscara para editar. Delete para borrar.", en: "Drag to draw masks. Click a mask to edit. Delete to remove.", pt: "Arraste para desenhar máscaras. Clique numa máscara para editar. Delete para remover." };
STRINGS["occlusion.askLabel"] = { es: "Etiqueta (ej. Riñón):", en: "Label (e.g. Kidney):", pt: "Etiqueta (ex. Rim):" };
STRINGS["occlusion.editLabel"] = { es: "Etiqueta", en: "Label", pt: "Etiqueta" };
STRINGS["occlusion.noMasks"] = { es: "Dibuja al menos una máscara primero", en: "Draw at least one mask first", pt: "Desenhe pelo menos uma máscara primeiro" };
STRINGS["occlusion.saveAndQueue"] = { es: "Guardar + enviar a aprobación", en: "Save + queue for approval", pt: "Salvar + enviar para aprovação" };
STRINGS["fsrs.title"] = { es: "Simulador FSRS día a día", en: "FSRS day-by-day simulator", pt: "Simulador FSRS dia a dia" };
STRINGS["fsrs.subtitle"] = { es: "Observa la programación FSRS real durante N días", en: "Watch actual FSRS scheduling over N days", pt: "Observe o agendamento real do FSRS ao longo de N dias" };
STRINGS["fsrs.deckSize"] = { es: "Tamaño del mazo (cartas)", en: "Deck size (cards)", pt: "Tamanho do baralho (cartões)" };
STRINGS["fsrs.days"] = { es: "Días a simular", en: "Days to simulate", pt: "Dias a simular" };
STRINGS["fsrs.maxReviews"] = { es: "Máx repasos/día", en: "Max reviews/day", pt: "Máx revisões/dia" };
STRINGS["fsrs.retention"] = { es: "Retención simulada", en: "Simulated retention", pt: "Retenção simulada" };
STRINGS["fsrs.initialDiff"] = { es: "Dificultad inicial (1-10)", en: "Initial difficulty (1-10)", pt: "Dificuldade inicial (1-10)" };
STRINGS["fsrs.run"] = { es: "Ejecutar simulación →", en: "Run simulation →", pt: "Executar simulação →" };
STRINGS["fsrs.results"] = { es: "Resultados", en: "Results", pt: "Resultados" };
STRINGS["fsrs.retentionCurve"] = { es: "Curva de retención", en: "Retention curve", pt: "Curva de retenção" };
STRINGS["fsrs.dailyLoad"] = { es: "Carga diaria", en: "Daily load", pt: "Carga diária" };
STRINGS["fsrs.cardStates"] = { es: "Distribución de estados de cartas", en: "Card states distribution", pt: "Distribuição de estados" };
STRINGS["fsrs.seed"] = { es: "Semilla (opcional, determinista)", en: "Seed (optional, deterministic)", pt: "Seed (opcional, determinístico)" };
