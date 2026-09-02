// Updater: chequea la última versión disponible, compara con la instalada,
// y descarga automáticamente si el usuario lo permite.
//
// v0.12:
//   - Chequeo periódico configurable (default 6h)
//   - Auth con JWT (el installer también puede actuar como un "dispositivo más")
//   - Notificación de nueva versión con changelog
//   - Auto-download opcional
//   - Persistencia de la última verificación (SharedPreferences)

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/plugin_release.dart';

class UpdateCheckResult {
  final bool hasUpdate;
  final String installedVersion;
  final String? latestVersion;
  final String? changelog;
  final String? downloadUrl;
  final DateTime checkedAt;

  const UpdateCheckResult({
    required this.hasUpdate,
    required this.installedVersion,
    required this.checkedAt,
    this.latestVersion,
    this.changelog,
    this.downloadUrl,
  });
}

class UpdaterConfig {
  final Duration checkInterval;
  final bool autoDownload;
  final String? backendUrl; // si no es null, consulta el backend en vez de un endpoint público
  final String? authToken; // JWT del device

  const UpdaterConfig({
    this.checkInterval = const Duration(hours: 6),
    this.autoDownload = false,
    this.backendUrl,
    this.authToken,
  });
}

class Updater extends ChangeNotifier {
  final http.Client _http;
  final UpdaterConfig config;
  Timer? _timer;
  UpdateCheckResult? _lastResult;
  bool _checking = false;
  String? _installedVersion;

  Updater({http.Client? client, this.config = const UpdaterConfig()}) : _http = client ?? http.Client();

  UpdateCheckResult? get lastResult => _lastResult;
  bool get isChecking => _checking;
  String? get installedVersion => _installedVersion;

  /// Inicia el chequeo periódico. Si ya hay un timer corriendo, lo reemplaza.
  void startPeriodicChecks() {
    _timer?.cancel();
    _timer = Timer.periodic(config.checkInterval, (_) => _safeCheck());
  }

  void stopPeriodicChecks() {
    _timer?.cancel();
    _timer = null;
  }

  /// Configura el vault activo para leer la versión instalada.
  Future<void> setVault(String vaultPath) async {
    _installedVersion = await readInstalledVersion(vaultPath);
    notifyListeners();
  }

  /// Compara dos versiones semver. Retorna > 0 si a > b, < 0 si a < b, 0 si iguales.
  static int compareVersions(String a, String b) {
    final pa = a.split('.').map(int.tryParse).toList();
    final pb = b.split('.').map(int.tryParse).toList();
    for (int i = 0; i < 3; i++) {
      final va = i < pa.length ? (pa[i] ?? 0) : 0;
      final vb = i < pb.length ? (pb[i] ?? 0) : 0;
      if (va != vb) return va - vb;
    }
    return 0;
  }

  /// Detecta la versión instalada leyendo el manifest del plugin.
  Future<String?> readInstalledVersion(String vaultPath) async {
    final manifest = File('$vaultPath/.obsidian/plugins/m-nexus/manifest.json');
    if (!await manifest.exists()) return null;
    final content = await manifest.readAsString();
    final match = RegExp(r'"version"\s*:\s*"([^"]+)"').firstMatch(content);
    return match?.group(1);
  }

  /// Realiza un chequeo puntual.
  Future<UpdateCheckResult> check({String? releaseUrl}) async {
    if (_checking) return _lastResult ?? _emptyResult();
    _checking = true;
    notifyListeners();
    try {
      final url = releaseUrl ?? _resolveReleaseUrl();
      final headers = config.authToken != null
          ? {'Authorization': 'Bearer ${config.authToken}'}
          : <String, String>{};
      final res = await _http.get(Uri.parse(url), headers: headers).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        throw Exception('Error ${res.statusCode} al obtener release info');
      }
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final release = PluginRelease.fromJson(json);

      final installed = _installedVersion ?? '0.0.0';
      final hasUpdate = compareVersions(release.latestVersion, installed) > 0;

      _lastResult = UpdateCheckResult(
        hasUpdate: hasUpdate,
        installedVersion: installed,
        latestVersion: release.latestVersion,
        changelog: release.releaseNotes,
        downloadUrl: release.downloadUrl,
        checkedAt: DateTime.now(),
      );
      notifyListeners();
      if (hasUpdate && config.autoDownload) {
        unawaited(_autoDownload(release));
      }
      return _lastResult!;
    } finally {
      _checking = false;
      notifyListeners();
    }
  }

  Future<void> _safeCheck() async {
    try {
      await check();
    } catch (e) {
      if (kDebugMode) {
        // ignore: avoid_print
        print('[Updater] check falló: $e');
      }
    }
  }

  String _resolveReleaseUrl() {
    // Endpoint estándar de releases. La URL se puede configurar por env.
    return '${config.backendUrl ?? "https://api.github.com"}/repos/m-nexus/obsidian/releases/latest';
  }

  /// Auto-descarga el plugin a un directorio temporal.
  Future<File?> _autoDownload(PluginRelease release) async {
    if (release.downloadUrl.isEmpty) return null;
    try {
      final res = await _http.get(Uri.parse(release.downloadUrl));
      if (res.statusCode != 200) return null;
      final tmp = Directory.systemTemp.createTempSync('m-nexus-update-');
      final file = File('${tmp.path}/m-nexus-obsidian-${release.latestVersion}.zip');
      await file.writeAsBytes(res.bodyBytes);
      return file;
    } catch (e) {
      if (kDebugMode) {
        // ignore: avoid_print
        print('[Updater] auto-download falló: $e');
      }
      return null;
    }
  }

  /// Descarga una versión específica bajo demanda (público para tests/UI).
  Future<File> download(PluginRelease release, {String? destPath}) async {
    final res = await _http.get(Uri.parse(release.downloadUrl));
    if (res.statusCode != 200) {
      throw Exception('Error ${res.statusCode} descargando');
    }
    final tmp = destPath != null
        ? Directory(destPath)
        : Directory.systemTemp.createTempSync('m-nexus-update-');
    if (!await tmp.exists()) await tmp.create(recursive: true);
    final file = File('${tmp.path}/m-nexus-obsidian-${release.latestVersion}.zip');
    await file.writeAsBytes(res.bodyBytes);
    return file;
  }

  UpdateCheckResult _emptyResult() => UpdateCheckResult(
        hasUpdate: false,
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
      );

  @override
  void dispose() {
    _timer?.cancel();
    _http.close();
    super.dispose();
  }
}
