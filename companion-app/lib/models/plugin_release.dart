// Modelos: release info, status de instalación.

class PluginRelease {
  final String latestVersion;
  final String minAppVersion;
  final String releaseNotes;
  final String downloadUrl;
  final String checksumSha256;

  const PluginRelease({
    required this.latestVersion,
    required this.minAppVersion,
    required this.releaseNotes,
    required this.downloadUrl,
    required this.checksumSha256,
  });

  factory PluginRelease.fromJson(Map<String, dynamic> json) {
    return PluginRelease(
      latestVersion: json['latest_version'] as String? ?? '0.0.0',
      minAppVersion: json['min_app_version'] as String? ?? '1.5.0',
      releaseNotes: json['release_notes'] as String? ?? '',
      downloadUrl: json['download_url'] as String? ?? '',
      checksumSha256: json['checksum_sha256'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'latest_version': latestVersion,
        'min_app_version': minAppVersion,
        'release_notes': releaseNotes,
        'download_url': downloadUrl,
        'checksum_sha256': checksumSha256,
      };
}

enum InstallStatus { idle, checking, downloading, installing, success, error, offline }

class InstallResult {
  final InstallStatus status;
  final String? installedVersion;
  final String? errorMessage;
  final List<String> createdFolders;
  final List<String> installedFiles;

  const InstallResult({
    required this.status,
    this.installedVersion,
    this.errorMessage,
    this.createdFolders = const [],
    this.installedFiles = const [],
  });
}
