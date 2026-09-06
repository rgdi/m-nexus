// ErrorCodes: códigos de error categorizados para logging estructurado.
//
// Cada error en la app debe usar uno de estos códigos para facilitar:
//   - Filtrado en adb logcat:  adb logcat -s mnexus:E | grep "EC-NET"
//   - Filtrado en chrome://inspect/#devices: buscar "EC-NET-001"
//   - Agregación en backend / analytics
//   - Documentación / wiki
//
// Formato: EC-{CATEGORÍA}-{NNN}
//
// Categorías:
//   NET   - Errores de red/HTTP
//   FS    - Errores de filesystem
//   DB    - Errores de base de datos
//   AUTH  - Errores de autenticación/permisos
//   CAL   - Calendar / plataforma Android
//   PLAT  - Platform channels (cualquier excepción MethodChannel)
//   VAULT - Operaciones sobre el vault
//   CARD  - Flashcards
//   NOTE  - Notas
//   SYNC  - Sincronización
//   UP    - Update / install
//   CFG   - Configuración
//   UI    - UI / render
//   LIFECYCLE - Inicialización / dispose de servicios
//   INTERNAL - Bugs / asserts

enum ErrorCategory {
  net('NET', 'Network/HTTP errors'),
  fs('FS', 'Filesystem errors'),
  db('DB', 'Database errors'),
  auth('AUTH', 'Auth/permission errors'),
  cal('CAL', 'Calendar/Android platform errors'),
  plat('PLAT', 'Platform channel errors'),
  vault('VAULT', 'Vault operations'),
  card('CARD', 'Flashcard operations'),
  note('NOTE', 'Note operations'),
  sync('SYNC', 'Sync operations'),
  up('UP', 'Update/install operations'),
  cfg('CFG', 'Configuration errors'),
  ui('UI', 'UI/render errors'),
  lifecycle('LIFECYCLE', 'Service init/dispose'),
  internal('INTERNAL', 'Internal bugs/asserts');

  final String code;
  final String description;
  const ErrorCategory(this.code, this.description);
}

class AppError implements Exception {
  final String code;          // EC-NET-001
  final ErrorCategory category;
  final String message;       // Descripción legible
  final Object? cause;        // Excepción original
  final StackTrace? stack;
  final Map<String, dynamic> context;
  final DateTime timestamp;
  final String? hint;         // Sugerencia para resolver

  AppError({
    required this.category,
    required this.message,
    required this.code,
    this.cause,
    this.stack,
    this.context = const {},
    this.hint,
  }) : timestamp = DateTime.now();

  /// Mensaje legible de múltiples líneas para logs.
  @override
  String toString() {
    final buf = StringBuffer()
      ..writeln('[$code] $message');
    if (hint != null) buf.writeln('  hint: $hint');
    if (cause != null) buf.writeln('  cause: $cause');
    if (context.isNotEmpty) buf.writeln('  context: $context');
    return buf.toString().trim();
  }

  Map<String, dynamic> toJson() => {
    'code': code,
    'category': category.code,
    'message': message,
    if (cause != null) 'cause': cause.toString(),
    'context': context,
    if (hint != null) 'hint': hint,
    'timestamp': timestamp.toIso8601String(),
  };

  // ── Constructores semánticos ────────────────────
  factory AppError.net(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.net, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.fs(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.fs, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.db(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.db, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.auth(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.auth, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.cal(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.cal, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.plat(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.plat, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.vault(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.vault, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.card(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.card, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.note(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.note, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.sync(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.sync, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.up(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.up, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.cfg(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.cfg, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.ui(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.ui, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.lifecycle(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.lifecycle, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);

  factory AppError.internal(String code, String message, {Object? cause, StackTrace? stack, Map<String, dynamic>? context, String? hint}) =>
    AppError(category: ErrorCategory.internal, code: code, message: message, cause: cause, stack: stack, context: context ?? {}, hint: hint);
}
