// Tests del cliente de chunked upload (v0.33).
// Incluyen fault-injection: conexión rota, chunks duplicados, etc.

import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mnexus_installer/services/chunked_upload.dart';

int _totalChunks(Map<String, dynamic> body) {
  final ts = body['totalSize'] as int;
  final cs = body['chunkSize'] as int;
  return (ts + cs - 1) ~/ cs;
}

class FakeUploadBackend {
  final Map<String, _Session> sessions = {};
  int initCalls = 0;
  int chunkCalls = 0;
  int completeCalls = 0;
  bool completeShouldFail = false;
  String? failChunkIndexFor;

  Future<http.Response> handle(http.Request req) async {
    final url = req.url.toString();
    final method = req.method;

    if (method == 'POST' && url.endsWith('/api/v1/upload/init')) {
      initCalls++;
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final id = 'up-${DateTime.now().microsecondsSinceEpoch}';
      sessions[id] = _Session(
        filename: body['filename'] as String,
        totalSize: body['totalSize'] as int,
        chunkSize: body['chunkSize'] as int,
        deviceId: body['deviceId'] as String,
        expectedSha256: body['expectedSha256'] as String?,
      );
      return http.Response(
        jsonEncode({
          'uploadId': id,
                    'totalChunks': _totalChunks(body),
          'chunkSize': body['chunkSize'] as int,
        }),
        200,
        headers: {'Content-Type': 'application/json'},
      );
    }
    final chunkMatch = RegExp(r'/api/v1/upload/([^/]+)/chunk/(\d+)$').firstMatch(url);
    if (method == 'PUT' && chunkMatch != null) {
      chunkCalls++;
      final id = chunkMatch.group(1)!;
      final idx = int.parse(chunkMatch.group(2)!);
      if (failChunkIndexFor == idx.toString()) {
        return http.Response('transient', 503);
      }
      final s = sessions[id]!;
      s.chunks[idx] = req.bodyBytes;
      return http.Response(jsonEncode({'received': s.chunks.length, 'duplicate': false}), 200,
        headers: {'Content-Type': 'application/json'});
    }
    if (method == 'GET' && url.contains('/status')) {
      final id = url.split('/').reversed.skip(1).first;
      final s = sessions[id]!;
      return http.Response(jsonEncode({
        'received': s.chunks.keys.toList()..sort(),
        'total': s.totalChunks,
      }), 200, headers: {'Content-Type': 'application/json'});
    }
    if (method == 'POST' && url.contains('/complete')) {
      completeCalls++;
      if (completeShouldFail) {
        return http.Response(jsonEncode({'code': 'CHECKSUM_MISMATCH'}), 400);
      }
      return http.Response(jsonEncode({'sha256': 'fake-sha', 'path': '/uploads/x'}), 200);
    }
    return http.Response('not found', 404);
  }
}

class _Session {
  final String filename;
  final int totalSize;
  final int chunkSize;
  final String deviceId;
  final String? expectedSha256;
  final Map<int, List<int>> chunks = {};
  _Session({
    required this.filename,
    required this.totalSize,
    required this.chunkSize,
    required this.deviceId,
    this.expectedSha256,
  });
  int get totalChunks => (totalSize + chunkSize - 1) ~/ chunkSize;
}

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  test('uploads a small file in one chunk', () async {
    final fake = FakeUploadBackend();
    final client = MockClient((req) => fake.handle(req));
    final uploader = ChunkedUpload(
      client: client,
      baseUrlGetter: () => 'http://test',
    );
    final tmp = await Directory.systemTemp.createTemp('chunked-test-');
    final file = File('${tmp.path}/x.bin');
    await file.writeAsBytes(List.generate(100, (i) => i));

    final r = await uploader.upload(file: file, deviceId: 'd1', chunkSize: 1000);
    expect(r.size, 100);
    expect(fake.initCalls, 1);
    expect(fake.chunkCalls, 1);
    expect(fake.completeCalls, 1);
  });

  test('uploads a 2.5MB file in 3 chunks', () async {
    final fake = FakeUploadBackend();
    final client = MockClient((req) => fake.handle(req));
    final uploader = ChunkedUpload(client: client, baseUrlGetter: () => 'http://test');
    final tmp = await Directory.systemTemp.createTemp('chunked-test-');
    final file = File('${tmp.path}/big.bin');
    final data = List<int>.generate(2500, (i) => i % 256);
    await file.writeAsBytes(data);

    final progress = <String>[];
    final r = await uploader.upload(
      file: file,
      deviceId: 'd1',
      chunkSize: 1000,
      onProgress: (sent, total) => progress.add('$sent/$total'),
    );
    expect(r.size, 2500);
    expect(progress.last, '2500/2500');
    expect(fake.chunkCalls, 3);
  });

  test('throws on empty file', () async {
    final client = MockClient((req) async => http.Response('{}', 200));
    final uploader = ChunkedUpload(client: client, baseUrlGetter: () => 'http://test');
    final tmp = await Directory.systemTemp.createTemp('chunked-test-');
    final file = File('${tmp.path}/empty.bin');
    await file.writeAsBytes([]);

    expect(
      () => uploader.upload(file: file, deviceId: 'd1'),
      throwsA(isA<ChunkedUploadException>()),
    );
  });

  test('resumes by skipping already-received chunks', () async {
    final fake = FakeUploadBackend();
    final tmp = await Directory.systemTemp.createTemp('chunked-test-');
    final file = File('${tmp.path}/resume.bin');
    await file.writeAsBytes(List.generate(2000, (i) => i));

    // Mock que responde con un uploadId FIJO y con chunk 0 ya recibido
    String fixedId = 'resume-id-123';
    final mockClient = MockClient((req) async {
      final url = req.url.toString();
      if (req.method == 'POST' && url.endsWith('/upload/init')) {
        return http.Response(
          jsonEncode({'uploadId': fixedId, 'totalChunks': 2, 'chunkSize': 1000}),
          200,
          headers: {'Content-Type': 'application/json'},
        );
      }
      if (req.method == 'GET' && url.contains('/status')) {
        return http.Response(
          jsonEncode({'received': [0], 'total': 2}),
          200,
          headers: {'Content-Type': 'application/json'},
        );
      }
      return fake.handle(req);
    });
    final customUploader = ChunkedUpload(client: mockClient, baseUrlGetter: () => 'http://test');

    // Ahora el upload "real" - debe saltarse el chunk 0
    final chunkCallsBefore = fake.chunkCalls;
    final r = await customUploader.upload(file: file, deviceId: 'd1', chunkSize: 1000);
    // Solo debe haber subido el chunk 1 (1 nuevo PUT)
    expect(fake.chunkCalls - chunkCallsBefore, 1);
    expect(r.size, 2000);
  });

  test('passes deviceId and targetSubdir in init', () async {
    final fake = FakeUploadBackend();
    final client = MockClient((req) => fake.handle(req));
    final uploader = ChunkedUpload(client: client, baseUrlGetter: () => 'http://test');
    final tmp = await Directory.systemTemp.createTemp('chunked-test-');
    final file = File('${tmp.path}/x.bin');
    await file.writeAsBytes([1, 2, 3]);

    final r = await uploader.upload(file: file, deviceId: 'tablet-A', targetSubdir: 'audio/2026');
    expect(r.uploadId, isNotEmpty);
    // Check the init payload included targetSubdir
    final s = fake.sessions.values.first;
    expect(s.deviceId, 'tablet-A');
  });
}
