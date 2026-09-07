// Updater I/O: descarga e instalación de APKs.
// v0.45: refactorizado con safeCallAsync + AppError.

import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:flutter/services.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart' as logger_mod;
import 'updater_models.dart';

bool get _isAndroid => Platform.isAndroid;

class UpdaterIO {
  static final _http = http.Client();

  /// Descarga el APK. Reintenta 3x con backoff (2s, 4s).
  /// Verifica tamaño (±2%) y existencia del archivo.
  static Future<File?> downloadApk(AppUpdate update) async {
    if (update.apkDownloadUrl.isEmpty) {
      logger_mod.AdvancedLogger.instance.warn('updater_io', 'empty apkDownloadUrl', context: {'version': update.latestVersion});
      return null;
    }
    final r = await safeCallAsync<File?>(
      component: 'updater_io',
      code: 'EC-UP-002',
      message: 'downloadApk failed',
      category: ErrorCategory.up,
      context: {'url': update.apkDownloadUrl, 'version': update.latestVersion},
      hint: 'Check network connectivity and GitHub release availability',
      op: () => _doDownload(update),
    );
    return r.value;
  }

  static Future<File?> _doDownload(AppUpdate update) async {
    const maxAttempts = 3;
    const initialBackoff = Duration(seconds: 2);
    logger_mod.AdvancedLogger.instance.info('updater_io', 'download start', context: {
      'url': update.apkDownloadUrl,
      'version': update.latestVersion,
      'expectedSize': update.apkSize,
    });
    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final tmp = await getTemporaryDirectory();
        final file = File('${tmp.path}/${update.apkFileName}');
        final resp = await _http.get(Uri.parse(update.apkDownloadUrl));
        if (resp.statusCode != 200) {
          throw AppError.net('EC-UP-003', 'APK download non-200', context: {'url': update.apkDownloadUrl, 'status': resp.statusCode});
        }
        if (update.apkSize > 0) {
          final diff = (resp.bodyBytes.length - update.apkSize).abs();
          if (diff > update.apkSize * 0.02) {
            throw AppError.net('EC-UP-004', 'APK size mismatch', context: {'expected': update.apkSize, 'got': resp.bodyBytes.length});
          }
        }
        await file.writeAsBytes(resp.bodyBytes);
        logger_mod.AdvancedLogger.instance.info('updater_io', 'download ok', context: {
          'attempt': attempt, 'path': file.path, 'bytes': await file.length(),
        });
        return file;
      } catch (e) {
        logger_mod.AdvancedLogger.instance.warn('updater_io', 'download attempt failed', context: {
          'attempt': attempt, 'maxAttempts': maxAttempts, 'error': e.toString(),
        });
        if (attempt == maxAttempts) rethrow;
        await Future.delayed(initialBackoff * attempt);
      }
    }
    return null;
  }

  /// Abre el intent INSTALL_PACKAGE. Solo Android.
  static Future<bool> installApk(File apkFile) async {
    if (!_isAndroid) return false;
    if (!await apkFile.exists()) {
      logger_mod.AdvancedLogger.instance.warn('updater_io', 'APK not found for install',
        context: {'path': apkFile.path});
      return false;
    }
    final r = await safeCallAsync<bool>(
      component: 'updater_io',
      code: 'EC-UP-006',
      message: 'installApk failed',
      category: ErrorCategory.up,
      context: {'channel': 'com.mnexus.app/install', 'path': apkFile.path},
      hint: 'User cancelled or system blocked install',
      op: () async {
        const channel = MethodChannel('com.mnexus.app/install');
        final ok = await channel.invokeMethod<bool>('installApk', {
          'path': apkFile.path,
        });
        logger_mod.AdvancedLogger.instance.info('updater_io', 'installApk result', context: {'ok': ok});
        return ok ?? false;
      },
    );
    return r.value ?? false;
  }
}
