// ChunkedUpload: cliente de subida por chunks para archivos grandes (v0.33).
//
// Diseñado para grabaciones de audio que pueden ser grandes (50+ MB).
// Resumable: si se interrumpe, el siguiente intento continúa donde quedó.
//
// Flujo:
//   1) init: avisa al backend el archivo y obtiene uploadId
//   2) upload chunks de 1 MB (pueden venir en cualquier orden)
//   3) complete: backend ensambla y verifica SHA-256
//   4) Si falla, retry con backoff exponencial
//
// Uso:
//   final uploader = ChunkedUpload(client: backendClient);
//   final result = await uploader.upload(
//     file: audioFile,
//     deviceId: 'd1',
//     targetSubdir: 'recordings/2026-09',
//     expectedSha256: sha256, // opcional, precalculado
//     onProgress: (sent, total) => print('$sent / $total'),
//   );

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

class ChunkedUploadResult {
  final String uploadId;
  final String filename;
  final int size;
  final String sha256;
  final String? path;
  final int attempts;
  final Duration duration;

  ChunkedUploadResult({
    required this.uploadId,
    required this.filename,
    required this.size,
    required this.sha256,
    this.path,
    required this.attempts,
    required this.duration,
  });
}

class ChunkedUploadException implements Exception {
  final String code;
  final String message;
  final int? statusCode;
  ChunkedUploadException(this.code, this.message, [this.statusCode]);
  @override
  String toString() => "ChunkedUploadException($code, $message, $statusCode)";
}

class ChunkedUpload {
  final http.Client _http;
  final String Function() _baseUrlGetter;
  static const int _defaultChunkSize = 1 * 1024 * 1024; // 1 MB
  static const int _maxRetries = 3;
  static const Duration _baseBackoff = Duration(seconds: 1);

  ChunkedUpload({
    required http.Client client,
    required String Function() baseUrlGetter,
  }) : _http = client,
       _baseUrlGetter = baseUrlGetter;

  /// Sube un archivo por chunks. Retorna ChunkedUploadResult con metadata.
  Future<ChunkedUploadResult> upload({
    required File file,
    required String deviceId,
    String? targetSubdir,
    String? expectedSha256,
    int chunkSize = _defaultChunkSize,
    void Function(int sent, int total)? onProgress,
  }) async {
    final start = DateTime.now();
    final size = await file.length();
    if (size == 0) {
      throw ChunkedUploadException("EMPTY_FILE", "El archivo está vacío");
    }
    final baseUrl = _baseUrlGetter();

    // 1) init
    final initBody = {
      'filename': file.uri.pathSegments.last,
      'totalSize': size,
      'chunkSize': chunkSize,
      'deviceId': deviceId,
      if (expectedSha256 != null) 'expectedSha256': expectedSha256,
      if (targetSubdir != null) 'targetSubdir': targetSubdir,
    };
    final initResp = await _postJson('$baseUrl/api/v1/upload/init', initBody);
    final uploadId = initResp['uploadId'] as String;

    // 2) status (en caso de retry: solo subimos lo que falta)
    final statusResp = await _getJson('$baseUrl/api/v1/upload/$uploadId/status');
    final Set<int> alreadyReceived = (statusResp['received'] as List<dynamic>?)?.cast<int>().toSet() ?? <int>{};
    int sent = alreadyReceived.length * chunkSize;
    if (sent > size) sent = size;
    if (onProgress != null) onProgress(sent, size);

    // 3) upload chunks
    int attempts = 0;
    final raf = await file.open();
    try {
      final totalChunks = (size + chunkSize - 1) ~/ chunkSize;
      for (int i = 0; i < totalChunks; i++) {
        if (alreadyReceived.contains(i)) continue;
        final offset = i * chunkSize;
        final length = (offset + chunkSize > size) ? size - offset : chunkSize;
        await raf.setPosition(offset);
        final bytes = await raf.read(length);
        attempts++;
        await _uploadChunkWithRetry(
          baseUrl: baseUrl,
          uploadId: uploadId,
          index: i,
          bytes: bytes,
        );
        sent += bytes.length;
        if (onProgress != null) onProgress(sent, size);
      }
    } finally {
      await raf.close();
    }

    // 4) complete
    final completeBody = {
      if (expectedSha256 != null) 'expectedSha256': expectedSha256,
    };
    final completeResp = await _postJson(
      '$baseUrl/api/v1/upload/$uploadId/complete',
      completeBody,
    );

    return ChunkedUploadResult(
      uploadId: uploadId,
      filename: file.uri.pathSegments.last,
      size: size,
      sha256: completeResp['sha256'] as String? ?? '',
      path: completeResp['path'] as String?,
      attempts: attempts,
      duration: DateTime.now().difference(start),
    );
  }

  Future<void> _uploadChunkWithRetry({
    required String baseUrl,
    required String uploadId,
    required int index,
    required List<int> bytes,
  }) async {
    int attempt = 0;
    while (true) {
      attempt++;
      try {
        final req = http.Request(
          'PUT',
          Uri.parse('$baseUrl/api/v1/upload/$uploadId/chunk/$index'),
        );
        req.bodyBytes = bytes;
        req.headers['Content-Type'] = 'application/octet-stream';
        req.headers['X-Device-Id'] = 'chunked-upload';
        final resp = await _http.send(req).timeout(const Duration(seconds: 30));
        if (resp.statusCode == 200) return;
        // Si la sesión expiró, no reintentamos
        if (resp.statusCode == 404) {
          throw ChunkedUploadException(
            "SESSION_EXPIRED",
            "La sesión de upload expiró",
            404,
          );
        }
        if (attempt >= _maxRetries) {
          final body = await resp.stream.bytesToString();
          throw ChunkedUploadException(
            "CHUNK_FAILED",
            "Falló chunk $index después de $attempt intentos: HTTP ${resp.statusCode} $body",
            resp.statusCode,
          );
        }
        // Backoff exponencial
        await Future.delayed(_baseBackoff * (1 << (attempt - 1)));
      } on SocketException catch (e) {
        if (attempt >= _maxRetries) {
          throw ChunkedUploadException("NETWORK_ERROR", e.message);
        }
        await Future.delayed(_baseBackoff * (1 << (attempt - 1)));
      }
    }
  }

  Future<Map<String, dynamic>> _postJson(String url, Map<String, dynamic> body) async {
    final resp = await _http
        .post(
          Uri.parse(url),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 15));
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw ChunkedUploadException(
        "HTTP_ERROR",
        "HTTP ${resp.statusCode} en POST $url",
        resp.statusCode,
      );
    }
    return jsonDecode(resp.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _getJson(String url) async {
    final resp = await _http.get(Uri.parse(url)).timeout(const Duration(seconds: 15));
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw ChunkedUploadException(
        "HTTP_ERROR",
        "HTTP ${resp.statusCode} en GET $url",
        resp.statusCode,
      );
    }
    return jsonDecode(resp.body) as Map<String, dynamic>;
  }
}
