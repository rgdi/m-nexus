// Updater: chequea la última versión del companion app en GitHub Releases,
// y permite al usuario descargar el APK y abrir el instalador de Android.
//
// v0.30:
//   - Consulta directa a GitHub API (misma fuente que el plugin y el backend)
//   - Diálogo con changelog y botón "Descargar e instalar"
//   - Usa DownloadManager-style download + intent INSTALL_PACKAGE
//     (Android reemplaza el APK sin desinstalar)
//   - Verificación periódica (configurable, default 6h)
//   - Persistencia de la última verificación (SharedPreferences)

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String _repoOwner = 'rgdi';
const String _repoName = 'm-nexus';
const String _githubApi = 'https://api.github.com/repos/$_repoOwner/$_repoName/releases/latest';
const String _prefsKeyLastCheck = 'mnexus.lastUpdateCheck';

class AppUpdate {
  final String latestVersion;       // ej "0.30.0"
  final String tagName;              // ej "v0.30.0"
  final String releaseUrl;           // https://github.com/.../releases/tag/v0.30.0
  final String apkDownloadUrl;       // https://github.com/.../m-nexus-companion-v0.30.0.apk
  final String apkFileName;          // m-nexus-companion-v0.30.0.apk
  final int apkSize;                 // bytes
  final String body;                 // changelog markdown
  final DateTime publishedAt;
  final bool isPrerelease;
  // v0.37: campos adicionales para diagnóstico de fallos de update
  final int? remoteVersionCode;      // versionCode del APK remoto (si está en el body o en un asset)
  final String? sha256;              // hash del APK remoto (si está)

  const AppUpdate({
    required this.latestVersion,
    required this.tagName,
    required this.releaseUrl,
    required this.apkDownloadUrl,
    required this.apkFileName,
    required this.apkSize,
    required this.body,
    required this.publishedAt,
    required this.isPrerelease,
    this.remoteVersionCode,
    this.sha256,
  });

  factory AppUpdate.fromGithub(Map<String, dynamic> json) {
    final assets = (json['assets'] as List?) ?? [];
    final apkAsset = assets.cast<Map<String, dynamic>>().firstWhere(
      (a) => (a['name'] as String? ?? '').contains('companion') && (a['name'] as String? ?? '').endsWith('.apk'),
      orElse: () => <String, dynamic>{},
    );
    final body = json['body'] as String? ?? '';
    // v0.37: extraer versionCode del body si lo añadimos en la release
    // (formato: "versionCode: 17" o "versionCode=17")
    final vcMatch = RegExp(r'versionCode[:\s=]+(\d+)').firstMatch(body);
    return AppUpdate(
      latestVersion: (json['tag_name'] as String? ?? 'v0.0.0').replaceFirst('v', ''),
      tagName: json['tag_name'] as String? ?? 'v0.0.0',
      releaseUrl: json['html_url'] as String? ?? '',
      apkDownloadUrl: apkAsset['browser_download_url'] as String? ?? '',
      apkFileName: apkAsset['name'] as String? ?? 'm-nexus-companion.apk',
      apkSize: (apkAsset['size'] as num?)?.toInt() ?? 0,
      body: body,
      publishedAt: DateTime.tryParse(json['published_at'] as String? ?? '') ?? DateTime.now(),
      isPrerelease: json['prerelease'] as bool? ?? false,
      remoteVersionCode: vcMatch != null ? int.tryParse(vcMatch.group(1)!) : null,
    );
  }

  factory AppUpdate.empty() => AppUpdate(
        latestVersion: '0.0.0',
        tagName: 'v0.0.0',
        releaseUrl: '',
        apkDownloadUrl: '',
        apkFileName: '',
        apkSize: 0,
        body: '',
        publishedAt: DateTime.fromMillisecondsSinceEpoch(0),
        isPrerelease: false,
      );
}

class UpdateCheckResult {
  final String installedVersion;
  final AppUpdate? update;        // null = no hay update o error
  final String? error;
  final DateTime checkedAt;
  final bool isFromCache;

  const UpdateCheckResult({
    required this.installedVersion,
    required this.checkedAt,
    this.update,
    this.error,
    this.isFromCache = false,
  });

  bool get hasUpdate =>
      update != null && _compareVersions(update!.latestVersion, installedVersion) > 0;
}

/// Compara versiones semver. Retorna > 0 si a > b, < 0 si a < b, 0 si iguales.
int _compareVersions(String a, String b) {
  String norm(String v) => v.replaceFirst('v', '').split('-').first.split('+').first;
  final pa = norm(a).split('.').map(int.tryParse).toList();
  final pb = norm(b).split('.').map(int.tryParse).toList();
  for (int i = 0; i < 3; i++) {
    final va = i < pa.length ? (pa[i] ?? 0) : 0;
    final vb = i < pb.length ? (pb[i] ?? 0) : 0;
    if (va != vb) return va - vb;
  }
  return 0;
}

class UpdaterConfig {
  final Duration checkInterval;
  final bool includePrerelease;
  final String? backendUrl;       // si está, consulta el backend en vez de GitHub directo
  final String? authToken;
  final Duration cacheTTL;

  const UpdaterConfig({
    this.checkInterval = const Duration(hours: 6),
    this.includePrerelease = false,
    this.backendUrl,
    this.authToken,
    this.cacheTTL = const Duration(minutes: 30),
  });
}

class Updater extends ChangeNotifier {
  final http.Client _http;
  final UpdaterConfig config;
  Timer? _timer;
  String? _installedVersion;
  UpdateCheckResult? _lastResult;
  bool _checking = false;
  double _downloadProgress = 0;
  bool _downloading = false;

  Updater({http.Client? client, this.config = const UpdaterConfig()}) : _http = client ?? http.Client();

  String? get installedVersion => _installedVersion;
  UpdateCheckResult? get lastResult => _lastResult;
  bool get isChecking => _checking;
  bool get isDownloading => _downloading;
  double get downloadProgress => _downloadProgress;

  /// Inicia el chequeo periódico.
  void startPeriodicChecks() {
    _timer?.cancel();
    _timer = Timer.periodic(config.checkInterval, (_) => _safeCheck());
  }

  void stopPeriodicChecks() {
    _timer?.cancel();
    _timer = null;
  }

  /// Lee la versión instalada del APK actual.
  Future<String> loadInstalledVersion() async {
    final info = await PackageInfo.fromPlatform();
    _installedVersion = info.version;
    return info.version;
  }

  /// v0.37: lee el versionCode del APK instalado para compararlo
  /// con el del APK remoto (necesario para diagnosticar fallos
  /// "package already installed" o "version downgrade").
  Future<int?> loadInstalledVersionCode() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return int.tryParse(info.buildNumber);
    } catch (_) {
      return null;
    }
  }

  /// Realiza un chequeo puntual. Devuelve el resultado (puede estar en cache).
  Future<UpdateCheckResult> check({bool force = false}) async {
    if (_checking) return _lastResult ?? _emptyResult();
    _checking = true;
    notifyListeners();
    try {
      // Cargar versión instalada si no la tenemos
      _installedVersion ??= await loadInstalledVersion();

      // Si hay cache fresco y no es forzado, devolver
      if (!force && _lastResult != null && DateTime.now().difference(_lastResult!.checkedAt) < config.cacheTTL) {
        _checking = false;
        return _lastResult!;
      }

      // Intentar desde backend primero (si está configurado)
      AppUpdate? update;
      String? error;

      if (config.backendUrl != null) {
        final r = await _checkViaBackend();
        update = r.update;
        error = r.error;
      } else {
        final r = await _checkViaGithub();
        update = r.update;
        error = r.error;
      }

      _lastResult = UpdateCheckResult(
        installedVersion: _installedVersion!,
        checkedAt: DateTime.now(),
        update: update,
        error: error,
      );

      // Persistir
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefsKeyLastCheck, DateTime.now().toIso8601String());
      } catch (_) {}

      notifyListeners();
      return _lastResult!;
    } finally {
      _checking = false;
      notifyListeners();
    }
  }

  Future<UpdateCheckResult> _checkViaGithub() async {
    try {
      final res = await _http.get(Uri.parse(_githubApi), headers: const {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mnexus-companion',
      }).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        return UpdateCheckResult(
          installedVersion: _installedVersion ?? '0.0.0',
          checkedAt: DateTime.now(),
          error: 'GitHub responded ${res.statusCode}',
        );
      }
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final update = AppUpdate.fromGithub(json);
      if (update.isPrerelease && !config.includePrerelease) {
        // Buscar la penúltima estable
        return await _checkLatestStable();
      }
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        update: update,
      );
    } catch (e) {
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        error: e.toString(),
      );
    }
  }

  Future<UpdateCheckResult> _checkLatestStable() async {
    try {
      final res = await _http.get(
        Uri.parse('https://api.github.com/repos/$_repoOwner/$_repoName/releases?per_page=10'),
        headers: const {'Accept': 'application/vnd.github+json', 'User-Agent': 'mnexus-companion'},
      ).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        return UpdateCheckResult(
          installedVersion: _installedVersion ?? '0.0.0',
          checkedAt: DateTime.now(),
          error: 'GitHub list responded ${res.statusCode}',
        );
      }
      final list = (jsonDecode(res.body) as List).cast<Map<String, dynamic>>();
      for (final json in list) {
        if (json['prerelease'] == true) continue;
        final update = AppUpdate.fromGithub(json);
        if (update.apkDownloadUrl.isNotEmpty) {
          return UpdateCheckResult(
            installedVersion: _installedVersion ?? '0.0.0',
            checkedAt: DateTime.now(),
            update: update,
          );
        }
      }
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        error: 'no_stable_release',
      );
    } catch (e) {
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        error: e.toString(),
      );
    }
  }

  Future<UpdateCheckResult> _checkViaBackend() async {
    try {
      final url = '${config.backendUrl}/api/v1/update';
      final headers = config.authToken != null
          ? {'Authorization': 'Bearer ${config.authToken}'}
          : <String, String>{};
      final res = await _http.get(Uri.parse(url), headers: headers).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        return UpdateCheckResult(
          installedVersion: _installedVersion ?? '0.0.0',
          checkedAt: DateTime.now(),
          error: 'backend responded ${res.statusCode}',
        );
      }
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      // El backend devuelve UpdateCheckResult con currentVersion/latestVersion
      final hasUpdate = json['hasUpdate'] == true;
      if (!hasUpdate) {
        return UpdateCheckResult(
          installedVersion: _installedVersion ?? '0.0.0',
          checkedAt: DateTime.now(),
          update: null,
        );
      }
      final update = AppUpdate(
        latestVersion: json['latestVersion'] as String? ?? '0.0.0',
        tagName: 'v${json['latestVersion']}',
        releaseUrl: json['releaseUrl'] as String? ?? '',
        apkDownloadUrl: '', // el backend devuelve el ZIP del backend, no el APK
        apkFileName: '',
        apkSize: (json['size'] as num?)?.toInt() ?? 0,
        body: json['body'] as String? ?? '',
        publishedAt: DateTime.tryParse(json['publishedAt'] as String? ?? '') ?? DateTime.now(),
        isPrerelease: json['isPrerelease'] as bool? ?? false,
      );
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        update: update,
      );
    } catch (e) {
      return UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.now(),
        error: e.toString(),
      );
    }
  }

  /// Descarga el APK y devuelve el path local. Notifica progreso.
  /// v0.37: reintenta hasta 3 veces con backoff en caso de fallo de red
  /// o HTTP 5xx. Para HTTP 4xx (excepto 408, 429) no reintenta.
  Future<File?> downloadApk(AppUpdate update) async {
    if (update.apkDownloadUrl.isEmpty) return null;
    if (_downloading) return null;
    _downloading = true;
    _downloadProgress = 0;
    notifyListeners();

    const maxAttempts = 3;
    const initialBackoff = Duration(seconds: 2);

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final file = await _doDownloadApk(update);
        _downloading = false;
        _downloadProgress = 1.0;
        notifyListeners();
        return file;
      } catch (e) {
        final isLast = attempt == maxAttempts;
        final isRetryable = e.toString().contains('5') || // 5xx
            e.toString().contains('TimeoutException') ||
            e.toString().contains('SocketException') ||
            e.toString().contains('Connection');
        if (kDebugMode) {
          // ignore: avoid_print
          print('[Updater] downloadApk attempt $attempt/$maxAttempts failed: $e');
        }
        if (isLast || !isRetryable) {
          _downloading = false;
          notifyListeners();
          return null;
        }
        // backoff: 2s, 4s
        await Future.delayed(initialBackoff * attempt);
      }
    }
    _downloading = false;
    notifyListeners();
    return null;
  }

  Future<File> _doDownloadApk(AppUpdate update) async {
    final req = http.Request('GET', Uri.parse(update.apkDownloadUrl));
    final res = await _http.send(req).timeout(const Duration(minutes: 5));
    if (res.statusCode != 200) {
      throw Exception('Download failed: HTTP ${res.statusCode}');
    }
    final total = res.contentLength ?? update.apkSize;
    final tmp = Directory.systemTemp.createTempSync('mnexus-update-');
    final file = File('${tmp.path}/${update.apkFileName}');
    final sink = file.openWrite();
    int downloaded = 0;
    try {
      await res.stream.listen((chunk) {
        downloaded += chunk.length;
        if (total > 0) {
          _downloadProgress = downloaded / total;
          notifyListeners();
        }
        sink.add(chunk);
      }).asFuture();
      await sink.flush();
      await sink.close();
    } catch (e) {
      await sink.close();
      // Limpiar el archivo parcial
      if (await file.exists()) await file.delete();
      rethrow;
    }
    // Verificar que el tamaño descargado coincide con el esperado (±2%)
    if (total > 0 && (downloaded - total).abs() / total > 0.02) {
      await file.delete();
      throw Exception('Size mismatch: expected $total, got $downloaded');
    }
    return file;
  }

  /// Pide al sistema Android que instale el APK. En Android 8+ usa FileProvider
  /// (la app ya debe tener el provider configurado en AndroidManifest.xml).
  /// En iOS no funciona (necesitaría App Store).
  ///
  /// v0.37: reintenta hasta 2 veces, y captura `ActivityNotFoundException`
  /// (suele pasar si el usuario desactivó el package installer).
  Future<bool> installApk(File apkFile) async {
    if (!Platform.isAndroid) {
      throw UnsupportedError('installApk solo funciona en Android');
    }
    if (!await apkFile.exists()) {
      if (kDebugMode) {
        // ignore: avoid_print
        print('[Updater] installApk: file does not exist at ${apkFile.path}');
      }
      return false;
    }
    const maxAttempts = 2;
    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const channel = MethodChannel('com.mnexus.installer/install');
        final result = await channel.invokeMethod<bool>('installApk', {
          'filePath': apkFile.path,
        });
        if (result == true) return true;
        // El platform channel devolvió false → no retry
        return false;
      } on PlatformException catch (e) {
        if (kDebugMode) {
          // ignore: avoid_print
          print('[Updater] installApk attempt $attempt: ${e.code} ${e.message}');
        }
        if (e.code == 'install_failed' || e.code == 'file_not_found') {
          return false; // no tiene sentido reintentar
        }
        if (attempt == maxAttempts) return false;
        await Future.delayed(const Duration(seconds: 1));
      } on MissingPluginException catch (e) {
        if (kDebugMode) {
          // ignore: avoid_print
          print('[Updater] installApk: platform channel not implemented: $e');
        }
        return false;
      }
    }
    return false;
  }

  Future<void> _safeCheck() async {
    try {
      await check();
    } catch (e) {
      if (kDebugMode) {
        // ignore: avoid_print
        print('[Updater] check failed: $e');
      }
    }
  }

  UpdateCheckResult _emptyResult() => UpdateCheckResult(
        installedVersion: _installedVersion ?? '0.0.0',
        checkedAt: DateTime.fromMillisecondsSinceEpoch(0),
        update: null,
        error: 'not_initialized',
      );

  @override
  void dispose() {
    _timer?.cancel();
    _http.close();
    super.dispose();
  }
}
