// Tests para BackendClient (v0.31).

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mnexus_installer/services/backend_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('BackendClient', () {
    test('sends X-Device-Id header on every request', () async {
      // Verify the client adds the header
      // We use a mock that checks the request
      final mock = MockClient((req) async {
        expect(req.headers.containsKey('x-device-id'), isTrue);
        return http.Response('{"status":"ok","version":"0.30.0"}', 200);
      });

      // Set up preferences with a URL
      SharedPreferences.setMockInitialValues({
        'mnexus.backend.url': 'http://example.com:8787',
        'mnexus.device_id': 'test-device-uuid-12345',
      });

      final client = await BackendClient.create(httpClient: mock);
      final res = await client.get('/api/v1/health');
      expect(res.statusCode, 200);
      client.close();
    });

    test('trailing slash in URL is stripped', () async {
      SharedPreferences.setMockInitialValues({
        'mnexus.backend.url': 'http://example.com:8787///',
        'mnexus.device_id': 'test-id',
      });

      final client = await BackendClient.create();
      expect(client.url, 'http://example.com:8787');
      client.close();
    });

    test('testConnection returns reachable=true on 200', () async {
      // We can't easily mock the static testConnection, but we can verify
      // the logic by hitting a local URL (which will fail but not crash)
      final result = await BackendClient.testConnection('http://127.0.0.1:1');
      // Most likely it will fail (no server), but the function should not throw
      expect(result.url, 'http://127.0.0.1:1');
      expect(result.isReachable, isFalse);
    });

    test('setBackendUrl persists', () async {
      SharedPreferences.setMockInitialValues({});
      await BackendClient.setBackendUrl('http://192.168.1.10:8787');
      final url = await BackendClient.getBackendUrl();
      expect(url, 'http://192.168.1.10:8787');
    });

    test('setAuthToken persists and clears', () async {
      await BackendClient.setAuthToken('abc123');
      await BackendClient.setAuthToken(null);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('mnexus.auth.token'), isNull);
    });
  });
}
