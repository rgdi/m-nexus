// file_lock.dart: file-level mutex para evitar race conditions en escrituras.
//
// v0.60 (P0.2): antes, `comments_service._save()` y similares escribian
// sin lock. Si dos writes ocurrían en paralelo (e.g. comment + reply en thread),
// el segundo sobreescribía al primero.
//
// Estrategia: un Map<String, Lock> indexado por path absoluto.
// Cada servicio obtiene su lock via `FileLock.forPath(path)` y usa
// `lock.synchronized(() async => ...)`.

import 'package:synchronized/synchronized.dart';

class FileLock {
  static final Map<String, Lock> _locks = {};
  static int _cleanupCounter = 0;

  /// v0.60: obtiene (o crea) un Lock para el path dado.
  /// Locks diferentes para paths diferentes.
  /// Mismo path = mismo lock (serializa writes).
  static Lock forPath(String absPath) {
    return _locks.putIfAbsent(absPath, () => Lock());
  }

  /// v0.60: ejecuta una accion bajo el lock del path.
  /// Retorna el resultado de la accion.
  static Future<T> run<T>(String absPath, Future<T> Function() action) async {
    final lock = forPath(absPath);
    return await lock.synchronized(action);
  }

  /// v0.60: cleanup periodico de locks no usados.
  /// Llamar desde main() o AppState.init().
  static void cleanup() {
    // Solo mantener locks que tengan `locked == true` (en uso).
    // Eliminar el resto para evitar memory leak en vaults grandes.
    if (_locks.isEmpty) return;
    final toRemove = <String>[];
    for (final entry in _locks.entries) {
      if (!entry.value.locked) toRemove.add(entry.key);
    }
    for (final key in toRemove) {
      _locks.remove(key);
    }
  }

  /// v0.60: para tests, limpia el estado.
  static void reset() {
    _locks.clear();
  }
}

/// v0.60: extension para hacer `await file.lockedWrite(()...)`
/// más legible.
extension LockedWrite on Object {
  Future<T> lockedWrite<T>(String absPath, Future<T> Function() action) =>
      FileLock.run<T>(absPath, action);
}
