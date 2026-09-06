// UpdaterIO: APK download + install (separate from orchestrator).

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';
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
    if (update.apkDownloadUrl.isEmpty) {
      AdvancedLogger.instance.warn('updater_io', 'empty apkDownloadUrl', context: {'version': update.version});
      return null;
    }
    return await guardAsync<File?>('updater_io', 'EC-UP-002',
      'downloadApk failed', () async {
      const maxAttempts = 3;
      const initialBackoff = Duration(seconds: 2);
      AdvancedLogger.instance.info('updater_io', 'download start', context: {
        'url': update.apkDownloadUrl,
        'version': update.version,
        'expectedSize': update.apkSize,
      });
      for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          final f = await _doDownload(update);
          AdvancedLogger.instance.info('updater_io', 'download ok', context: {
            'attempt': attempt, 'path': f.path, 'bytes': await f.length(),
          });
          return f;
        } catch (e, s) {
          AdvancedLogger.instance.warn('updater_io', 'download attempt failed', context: {
            'attempt': attempt, 'maxAttempts': maxAttempts, 'error': e.toString(),
          }, error: e);
          if (attempt == maxAttempts) rethrow;
          await Future.delayed(initialBackoff * attempt);
        }
      }
      return null;
    }, context: {'url': update.apkDownloadUrl, 'version': update.version},
       category: ErrorCategory.up);
  }

  static Future<File> _doDownload(AppUpdate update) async {
    return await guardAsync<File>('updater_io', 'EC-UP-003',
      '_doDownload failed', () async {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/${update.apkFileName}');
      AdvancedLogger.instance.network(method: 'GET', url: update.apkDownloadUrl);
      final resp = await _http.get(Uri.parse(update.apkDownloadUrl));
      AdvancedLogger.instance.network(method: 'GET', url: update.apkDownloadUrl,
        statusCode: resp.statusCode, responseBytes: resp.bodyBytes.length);
      if (resp.statusCode != 200) {
        throw AppError.net('EC-UP-004', 'APK download non-200',
          context: {'url': update.apkDownloadUrl, 'status': resp.statusCode});
      }
      if (update.apkSize > 0) {
        final diff = (resp.bodyBytes.length - update.apkSize).abs();
        if (diff > update.apkSize * 0.02) {
          throw AppError.net('EC-UP-005', 'APK size mismatch',
            context: {'expected': update.apkSize, 'got': resp.bodyBytes.length});
        }
      }
      await file.writeAsBytes(resp.bodyBytes);
      return file;
    }, context: {'url': update.apkDownloadUrl},
       category: ErrorCategory.up) ??
      File('${(await getTemporaryDirectory()).path}/${update.apkFileName}');
  }

  /// Abre el intent INSTALL_PACKAGE. Solo Android.
  static Future<bool> installApk(File apkFile) async {
    if (!_isAndroid) return false;
    if (!await apkFile.exists()) {
      AdvancedLogger.instance.warn('updater_io', 'APK not found for install',
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
        AdvancedLogger.instance.logPlatform('updater_io', 'com.mnexus.app/install', 'installApk', args: {'path': apkFile.path});
        final ok = await channel.invokeMethod<bool>('installApk', {
          'path': apkFile.path,
        });
        AdvancedLogger.instance.info('updater_io', 'installApk result', context: {'ok': ok});
        return ok ?? false;
      },
    );
    return r.value ?? false;
  }
}
