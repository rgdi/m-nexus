// Updater: chequea updates en GitHub Releases y permite descargar/instalar APK.
//
// v0.30:
//   - Consulta directa a GitHub API
//   - Diálogo con changelog y botón "Descargar e instalar"
//   - Verificación periódica (configurable, default 6h)
//   - Persistencia de la última verificación (SharedPreferences)
// v0.37: reintentos 3x con backoff, verificación de tamaño
// v0.44: dividido en updater.dart (orquestador) + updater_io.dart (download/install) + updater_models.dart

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'updater_io.dart';
import 'updater_models.dart';

const String _repoOwner = 'rgdi';
const String _repoName = 'm-nexus';
const String _githubApi = 'https://api.github.com/repos/$_repoOwner/$_repoName/releases/latest';
const String _prefsKeyLastCheck = 'mnexus.lastUpdateCheck';
const String _userAgent = 'mnexus-app';

class Updater extends ChangeNotifier {
  final http.Client _http;
  final UpdaterConfig config;

  String? _installedVersion;
  int? _installedVersionCode;
  UpdateCheckResult? _lastResult;
  bool _checking = false;

  Updater({http.Client? client, this.config = const UpdaterConfig()})
      : _http = client ?? http.Client();

  // Getters
  String? get installedVersion => _installedVersion;
  int? get installedVersionCode => _installedVersionCode;
  UpdateCheckResult? get lastResult => _lastResult;
  bool get isChecking => _checking;

  /// Carga la versión instalada del APK.
  Future<String> loadInstalledVersion() async {
    final info = await PackageInfo.fromPlatform();
    _installedVersion = info.version;
    return _installedVersion!;
  }

  Future<int?> loadInstalledVersionCode() async {
    final info = await PackageInfo.fromPlatform();
    _installedVersionCode = int.tryParse(info.buildNumber);
    return _installedVersionCode;
  }

  /// Inicia checks periódicos según `config.checkInterval`.
  void startPeriodicChecks() {
    if (config.checkInterval == Duration.zero) return;
    _timer?.cancel();
    _timer = Timer.periodic(config.checkInterval, (_) => _safeCheck());
  }

  void stopPeriodicChecks() {
    _timer?.cancel();
    _timer = null;
  }

  Timer? _timer;

  /// Chequea updates. Si `force: true` ignora el cache.
  Future<UpdateCheckResult> check({bool force = false}) async {
    _checking = true;
    notifyListeners();
    final r = await safeCallAsync<UpdateCheckResult>(
      component: 'updater',
      code: 'EC-UP-001',
      message: 'check for updates failed',
      category: ErrorCategory.up,
      context: {'force': force, 'repo': config.repo},
      hint: 'Check network connectivity, GitHub API accessible',
      op: () async {
        await loadInstalledVersion();
        await loadInstalledVersionCode();
        if (!force) {
          final cached = await _readCache();
          if (cached != null) {
            AdvancedLogger.instance.debug('updater', 'using cached result',
              context: {'version': cached.latestVersion});
            _lastResult = cached;
            return cached;
          }
        }
        _lastResult = await _checkViaGithub();
        await _writeCache(_lastResult!);
        return _lastResult!;
      },
    );
    if (!r.success) {
      _lastResult = UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        error: r.error?.message ?? 'unknown',
      );
    }
    _checking = false;
    notifyListeners();
    return _lastResult!;
  }

  /// Descarga el APK. Reintenta 3 veces con backoff.
  Future<dynamic> downloadApk(AppUpdate update) => UpdaterIO.downloadApk(update);
  Future<bool> installApk(dynamic apkFile) => UpdaterIO.installApk(apkFile);

  Future<void> _safeCheck() async {
    try {
      await check();
    } catch (_) {/* swallow */}
  }

  Future<UpdateCheckResult> _checkViaGithub() async {
    final resp = await _http.get(
      Uri.parse(_githubApi),
      headers: {'User-Agent': _userAgent},
    );
    if (resp.statusCode != 200) {
      throw 'GitHub API HTTP ${resp.statusCode}';
    }
    final json = jsonDecode(resp.body) as Map<String, dynamic>;
    final update = AppUpdate.fromGithub(json);
    if (compareVersions(update.latestVersion, _installedVersion ?? '0.0.0') <= 0) {
      return UpdateCheckResult(
        installedVersion: _installedVersion!,
        checkedAt: DateTime.now(),
        update: null,
      );
    }
    return UpdateCheckResult(
      installedVersion: _installedVersion!,
      checkedAt: DateTime.now(),
      update: update,
    );
  }

  Future<UpdateCheckResult?> _readCache() async {
    final prefs = await SharedPreferences.getInstance();
    final lastCheck = prefs.getInt(_prefsKeyLastCheck) ?? 0;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - lastCheck > config.cacheLifetime.inMilliseconds) return null;
    final raw = prefs.getString('${_prefsKeyLastCheck}.data');
    if (raw == null) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final result = UpdateCheckResult(
        installedVersion: m['installedVersion'] as String,
        checkedAt: DateTime.fromMillisecondsSinceEpoch(m['checkedAt'] as int),
        isFromCache: true,
      );
      return result;
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCache(UpdateCheckResult result) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_prefsKeyLastCheck, DateTime.now().millisecondsSinceEpoch);
    await prefs.setString(
      '${_prefsKeyLastCheck}.data',
      jsonEncode({
        'installedVersion': result.installedVersion,
        'checkedAt': result.checkedAt.millisecondsSinceEpoch,
      }),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
