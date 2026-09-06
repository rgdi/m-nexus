// UpdaterIO: APK download + install (separate from orchestrator).

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'updater_models.dart';

bool get _isAndroid {
  try {
    return defaultTargetPlatform == TargetPlatform.android;
  } catch (_) {
    return false;
  }
}

class UpdaterIO {
  static final http.Client _http = http.Client();

  /// Descarga el APK. Reintenta 3x con backoff (2s, 4s).
  /// Verifica tamaño (±2%) y existencia del archivo.
  static Future<File?> downloadApk(AppUpdate update) async {
    if (update.apkDownloadUrl.isEmpty) return null;
    const maxAttempts = 3;
    const initialBackoff = Duration(seconds: 2);
    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await _doDownload(update);
      } catch (e) {
        if (attempt == maxAttempts) return null;
        await Future.delayed(initialBackoff * attempt);
      }
    }
    return null;
  }

  static Future<File> _doDownload(AppUpdate update) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/${update.apkFileName}');
    final resp = await _http.get(Uri.parse(update.apkDownloadUrl));
    if (resp.statusCode != 200) {
      throw 'HTTP ${resp.statusCode}';
    }
    if (update.apkSize > 0) {
      final diff = (resp.bodyBytes.length - update.apkSize).abs();
      if (diff > update.apkSize * 0.02) {
        throw 'Size mismatch: got ${resp.bodyBytes.length}, expected ${update.apkSize}';
      }
    }
    await file.writeAsBytes(resp.bodyBytes);
    return file;
  }

  /// Abre el intent INSTALL_PACKAGE. Solo Android.
  static Future<bool> installApk(File apkFile) async {
    if (!_isAndroid) return false;
    if (!await apkFile.exists()) return false;
    const channel = MethodChannel('com.mnexus.app/install');
    try {
      final ok = await channel.invokeMethod<bool>('installApk', {
        'path': apkFile.path,
      });
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }
}
