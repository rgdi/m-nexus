// v0.28: UpdateChecker para la companion app Flutter.
//
// Comprueba la última release en GitHub y notifica al usuario si hay
// una nueva versión. Para auto-actualizar, abre la página de release
// en el navegador para que el usuario descargue el APK.

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

const String repoOwner = 'rgdi';
const String repoName = 'm-nexus';
const String apiUrl = 'https://api.github.com/repos/$repoOwner/$repoName/releases/latest';
const String releasesUrl = 'https://github.com/$repoOwner/$repoName/releases/latest';

class UpdateInfo {
  final String current;
  final String latest;
  final bool hasUpdate;
  final String releaseNotes;
  final String downloadUrl;

  const UpdateInfo({
    required this.current,
    required this.latest,
    required this.hasUpdate,
    required this.releaseNotes,
    required this.downloadUrl,
  });
}

/// Compara versiones semver (0.28.0 < 0.28.1).
int compareVersions(String a, String b) {
  final pa = a.replaceFirst('v', '').split('.').map((s) => int.tryParse(s) ?? 0).toList();
  final pb = b.replaceFirst('v', '').split('.').map((s) => int.tryParse(s) ?? 0).toList();
  final len = pa.length > pb.length ? pa.length : pb.length;
  for (int i = 0; i < len; i++) {
    final va = i < pa.length ? pa[i] : 0;
    final vb = i < pb.length ? pb[i] : 0;
    if (va != vb) return va - vb;
  }
  return 0;
}

/// Consulta la última release de GitHub. Devuelve null si falla.
Future<Map<String, dynamic>?> fetchLatestRelease() async {
  try {
    final res = await http.get(Uri.parse(apiUrl)).timeout(
      const Duration(seconds: 5),
    );
    if (res.statusCode != 200) return null;
    return json.decode(res.body) as Map<String, dynamic>;
  } catch (e) {
    return null;
  }
}

/// Comprueba si hay updates. Devuelve UpdateInfo con la info.
Future<UpdateInfo?> checkForUpdates({bool silent = false}) async {
  final latest = await fetchLatestRelease();
  if (latest == null) return null;

  final pkg = await PackageInfo.fromPlatform();
  final current = pkg.version;
  final latestVersion = (latest['tag_name'] as String).replaceFirst('v', '');

  // Encontrar el APK asset
  final assets = (latest['assets'] as List?) ?? [];
  String downloadUrl = releasesUrl;
  for (final asset in assets) {
    final name = asset['name'] as String? ?? '';
    if (name.contains('companion') && name.endsWith('.apk')) {
      downloadUrl = asset['browser_download_url'] as String? ?? downloadUrl;
      break;
    }
  }

  final hasUpdate = compareVersions(latestVersion, current) > 0;
  return UpdateInfo(
    current: current,
    latest: latestVersion,
    hasUpdate: hasUpdate,
    releaseNotes: (latest['body'] as String?) ?? '',
    downloadUrl: downloadUrl,
  );
}
