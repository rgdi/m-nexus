// updater_service.dart: wrapper singleton de Updater para auto-update.
//
// v0.47.2: integra el Updater existente con el ciclo de vida de la app.
//   - main() llama UpdaterService.instance.start() en background
//   - Cuando hay update: notifica via ChangeNotifier
//   - El RootGate muestra un dialog con boton "Instalar"
//   - El usuario acepta -> descarga + instala (vía updater_io.dart)
//
// Antes: Updater existia como clase pero NUNCA se llamaba desde main().
// La app nunca verificaba updates. Usuario tenia que descargar APK manual.

import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/updater.dart';
import '../services/updater_models.dart';
import '../services/logger.dart';

class UpdaterService extends ChangeNotifier {
  static final UpdaterService instance = UpdaterService._();
  UpdaterService._();

  final Updater _updater = Updater(
    config: const UpdaterConfig(
      checkInterval: Duration(hours: 6), // cada 6h
      cacheLifetime: Duration(hours: 6),
    ),
  );

  bool _started = false;
  bool _downloading = false;
  double _downloadProgress = 0;
  String? _downloadError;

  bool get isDownloading => _downloading;
  double get downloadProgress => _downloadProgress;
  String? get downloadError => _downloadError;
  UpdateCheckResult? get lastResult => _updater.lastResult;
  bool get hasUpdate {
    final r = _updater.lastResult;
    if (r == null || r.update == null) return false;
    return r.update.isNewer(r.installedVersion);
  }
  bool get isChecking => _updater.isChecking;

  /// Llamar UNA vez al arranque. Inicia verificaciones periodicas.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    _updater.addListener(_onUpdaterChanged);
    _updater.startPeriodicChecks();
    // Primer check despues de 10s (no bloquea UI)
    Timer(const Duration(seconds: 10), () async {
      try {
        await _updater.check(force: false);
      } catch (e) {
        AdvancedLogger.instance.warn('updater_service', 'initial check failed', context: { 'error': e.toString() });
      }
    });
  }

  void _onUpdaterChanged() {
    if (hasListeners) notifyListeners();
  }

  /// Verifica manualmente (pull-to-refresh en settings)
  Future<void> checkNow() async {
    try {
      await _updater.check(force: true);
    } catch (e) {
      AdvancedLogger.instance.warn('updater_service', 'manual check failed', context: { 'error': e.toString() });
    }
  }

  /// Descarga e instala el update. Muestra progreso.
  /// Retorna true si se inició la instalación, false si falló.
  Future<bool> downloadAndInstall() async {
    final result = _updater.lastResult;
    if (result?.update == null) {
      _downloadError = 'No hay update disponible';
      notifyListeners();
      return false;
    }
    _downloading = true;
    _downloadProgress = 0;
    _downloadError = null;
    notifyListeners();
    try {
      final file = await _updater.downloadApk(result!.update!);
      _downloadProgress = 1.0;
      notifyListeners();
      // Instala
      final ok = await _updater.installApk(file);
      if (ok) {
        _downloading = false;
        notifyListeners();
        return true;
      } else {
        _downloadError = 'No se pudo iniciar la instalación';
        _downloading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _downloadError = e.toString();
      _downloading = false;
      notifyListeners();
      return false;
    }
  }

  /// Cierra la notificación de update (cuando el usuario descarta)
  /// Usa un flag interno para no volver a mostrar hasta que haya un NUEVO update.
  bool _dismissedForThisVersion = false;
  String? _dismissedVersion;

  void dismissUpdate() {
    _dismissedForThisVersion = true;
    _dismissedVersion = _updater.lastResult?.update?.latestVersion;
    notifyListeners();
  }

  /// True si hay update Y no fue dismissed
  bool get shouldShowUpdateBanner {
    if (!hasUpdate) return false;
    if (!_dismissedForThisVersion) return true;
    // Si es un nuevo update (otra version), volver a mostrar
    return _updater.lastResult?.update?.latestVersion != _dismissedVersion;
  }

  @override
  void dispose() {
    _updater.removeListener(_onUpdaterChanged);
    _updater.stopPeriodicChecks();
    super.dispose();
  }
}
