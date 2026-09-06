// SafeCall: helper para envolver operaciones con try-catch y logging automático.
//
// Toda llamada a APIs externas, file I/O, platform channels, o lógica
// de negocio compleja DEBE usar safeCall() / safeCallAsync() para asegurar
// que los errores se registran en el log estructurado con código + contexto.
//
// Uso:
//   // Async con retorno:
//   final result = await safeCallAsync<AppError>(
//     component: 'vault',
//     code: 'EC-VAULT-001',
//     message: 'Failed to read note',
//     context: {'path': path, 'userId': uid},
//     op: () => _readNoteInternal(path),
//   );
//   if (result.success) print(result.value);
//   else showError(result.error!.message);
//
//   // Sync:
//   final ok = safeCall(component: 'fs', code: 'EC-FS-005', ...,
//     op: () => File(path).writeAsStringSync(content));
//
//   // Return null on error (ignorar):
//   final cal = await safeCallOrNull(component: 'cal', code: 'EC-CAL-001', ...,
//     op: () => calendar.listCalendars());

import 'package:flutter/foundation.dart';
import '../services/logger.dart';
import 'error_codes.dart';

@immutable
class SafeResult<T> {
  final T? value;
  final AppError? error;
  final bool success;

  const SafeResult.ok(this.value) : error = null, success = true;
  const SafeResult.fail(this.error) : value = null, success = false;

  T getOrNull() => value;
  T getOrElse(T fallback) => success ? value! : fallback;
  R fold<R>(R Function(AppError) onError, R Function(T) onOk) =>
    success ? onOk(value as T) : onError(error!);
}

/// Envuelve una operación async con logging automático.
///
/// - En éxito: log debug + retorna SafeResult.ok(value)
/// - En error: log error (incluye code, cause, stack, context) + retorna SafeResult.fail(AppError)
Future<SafeResult<T>> safeCallAsync<T>({
  required String component,
  required String code,
  required String message,
  required Future<T> Function() op,
  Map<String, dynamic>? context,
  String? hint,
  ErrorCategory? category,
}) async {
  final log = AdvancedLogger.instance;
  final ctx = context ?? const <String, dynamic>{};
  log.debug(component, '→ $message', context: {'code': code, ...ctx});
  try {
    final result = await op();
    log.debug(component, '← OK $message', context: {'code': code, ...ctx});
    return SafeResult<T>.ok(result);
  } catch (e, s) {
    final err = AppError(
      category: category ?? ErrorCategory.internal,
      code: code,
      message: message,
      cause: e,
      stack: s,
      context: ctx,
      hint: hint,
    );
    log.error(component, '[${err.code}] ${err.message}',
      context: err.toJson(),
      error: e,
      stack: s);
    return SafeResult<T>.fail(err);
  }
}

/// Versión sync.
SafeResult<T> safeCall<T>({
  required String component,
  required String code,
  required String message,
  required T Function() op,
  Map<String, dynamic>? context,
  String? hint,
  ErrorCategory? category,
}) {
  final log = AdvancedLogger.instance;
  final ctx = context ?? const <String, dynamic>{};
  log.debug(component, '→ $message', context: {'code': code, ...ctx});
  try {
    final result = op();
    log.debug(component, '← OK $message', context: {'code': code, ...ctx});
    return SafeResult<T>.ok(result);
  } catch (e, s) {
    final err = AppError(
      category: category ?? ErrorCategory.internal,
      code: code,
      message: message,
      cause: e,
      stack: s,
      context: ctx,
      hint: hint,
    );
    log.error(component, '[${err.code}] ${err.message}',
      context: err.toJson(),
      error: e,
      stack: s);
    return SafeResult<T>.fail(err);
  }
}

/// Versión "ignorar error" — retorna null en caso de fallo (loggeado).
Future<T?> safeCallOrNull<T>({
  required String component,
  required String code,
  required String message,
  required Future<T> Function() op,
  Map<String, dynamic>? context,
  String? hint,
  ErrorCategory? category,
}) async {
  final r = await safeCallAsync<T>(
    component: component, code: code, message: message,
    op: op, context: context, hint: hint, category: category);
  return r.value;
}

/// Versión "ignorar error" sync.
T? safeCallOrNullSync<T>({
  required String component,
  required String code,
  required String message,
  required T Function() op,
  Map<String, dynamic>? context,
  String? hint,
  ErrorCategory? category,
}) {
  final r = safeCall<T>(
    component: component, code: code, message: message,
    op: op, context: context, hint: hint, category: category);
  return r.value;
}

/// Helper para catchear errores en bloques `await` ya existentes sin
/// reescribir toda la función.
///
///   await guardAsync('vault', 'EC-VAULT-005', 'read tree', () async {
///     final t = await svc.loadTree();
///     return t;
///   }, context: {'vault': path});
Future<T?> guardAsync<T>(
  String component,
  String code,
  String message,
  Future<T> Function() op, {
  Map<String, dynamic>? context,
  String? hint,
  ErrorCategory? category,
}) async {
  try {
    return await op();
  } catch (e, s) {
    final err = AppError(
      category: category ?? ErrorCategory.internal,
      code: code, message: message, cause: e, stack: s,
      context: context ?? const {}, hint: hint);
    AdvancedLogger.instance.error(component, '[${err.code}] ${err.message}',
      context: err.toJson(), error: e, stack: s);
    return null;
  }
}

/// Re-lanza una excepción genérica como AppError con código.
AppError wrapError(
  String code,
  String message,
  Object cause, {
  ErrorCategory category = ErrorCategory.internal,
  StackTrace? stack,
  Map<String, dynamic>? context,
  String? hint,
}) {
  return AppError(
    category: category,
    code: code,
    message: message,
    cause: cause,
    stack: stack,
    context: context ?? const {},
    hint: hint,
  );
}
