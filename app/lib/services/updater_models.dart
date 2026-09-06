// Update models: AppUpdate, UpdateCheckResult, UpdaterConfig.

// isAndroid helper movido a device_info.dart
import 'package:flutter/foundation.dart';

/// Una versión disponible en GitHub Releases.
class AppUpdate {
  final String latestVersion;
  final String tagName;
  final String releaseUrl;
  final String apkDownloadUrl;
  final String apkFileName;
  final int apkSize;
  final String body;
  final DateTime publishedAt;
  final bool isPrerelease;
  final int? remoteVersionCode;
  final String? sha256;

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
      (a) => (a['name'] as String? ?? '').endsWith('.apk'),
      orElse: () => <String, dynamic>{},
    );
    final body = json['body'] as String? ?? '';
    final vcMatch = RegExp(r'versionCode[:\s=]+(\d+)').firstMatch(body);
    return AppUpdate(
      latestVersion: (json['tag_name'] as String? ?? 'v0.0.0').replaceFirst('v', ''),
      tagName: json['tag_name'] as String? ?? 'v0.0.0',
      releaseUrl: json['html_url'] as String? ?? '',
      apkDownloadUrl: apkAsset['browser_download_url'] as String? ?? '',
      apkFileName: apkAsset['name'] as String? ?? 'm-nexus-app.apk',
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

/// Resultado de un check de updates.
class UpdateCheckResult {
  final String installedVersion;
  final AppUpdate? update;
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

  bool get hasUpdate => update != null;
}

/// Configuración del updater.
class UpdaterConfig {
  final Duration checkInterval;
  final Duration cacheLifetime;
  final bool enableBackendCheck;
  final String? backendUrl;

  const UpdaterConfig({
    this.checkInterval = const Duration(hours: 6),
    this.cacheLifetime = const Duration(minutes: 30),
    this.enableBackendCheck = true,
    this.backendUrl,
  });
}

/// Compara dos versiones semver (a vs b). Returns -1, 0, 1.
int compareVersions(String a, String b) {
  final pa = a.replaceFirst('v', '').split('.').map(int.tryParse).toList();
  final pb = b.replaceFirst('v', '').split('.').map(int.tryParse).toList();
  for (var i = 0; i < 3; i++) {
    final ai = i < pa.length ? (pa[i] ?? 0) : 0;
    final bi = i < pb.length ? (pb[i] ?? 0) : 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}
