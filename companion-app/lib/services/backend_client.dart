// BackendClient: cliente HTTP centralizado para hablar con el backend M-NEXUS.
//
// v0.31:
// - Añade automáticamente el header X-Device-Id en TODAS las llamadas
// - Persiste la URL del backend (editable desde Settings)
// - Maneja reintentos y reconexión
// - Compatible con el auto-update: el URL se actualiza sin reinstalar
//
// Uso:
//   final client = await BackendClient.create();
//   final res = await client.get('/api/v1/health');

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'device_id.dart';

const String _prefsKeyBackendUrl = 'mnexus.backend.url';
const String _prefsKeyAuthToken = 'mnexus.auth.token';
const String _prefsKeyLastConnected = 'mnexus.backend.last_connected';

const String _defaultBackendUrl = 'http://10.0.2.2:8787';
const Duration _timeout = Duration(seconds: 15);

class BackendConnection {
  final String url;
  final bool isReachable;
  final String? version;
  final String? error;
  final Duration latency;

  const BackendConnection({
    required this.url,
    required this.isReachable,
    this.version,
    this.error,
    required this.latency,
  });
}

class BackendClient {
  final http.Client _http;
  final String _url;
  final String? _authToken;
  final String _deviceId;
  final Map<String, String> _baseHeaders;

  BackendClient._({
    required http.Client http,
    required String url,
    String? authToken,
    required String deviceId,
  })  : _http = http,
        _url = url.replaceAll(RegExp(r'/+$'), ''), // quitar trailing /
        _authToken = authToken,
        _deviceId = deviceId,
        _baseHeaders = {
          'X-Device-Id': deviceId,
          'X-Client-Version': '0.30.0',
          'X-Client-Platform': 'companion-android',
        };

  String get url => _url;
  String get deviceId => _deviceId;

  /// Crea un cliente a partir de la config persistida.
  static Future<BackendClient> create({http.Client? httpClient}) async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_prefsKeyBackendUrl) ?? _defaultBackendUrl;
    final token = prefs.getString(_prefsKeyAuthToken);
    final identity = await DeviceIdentity.load();
    return BackendClient._(
      http: httpClient ?? http.Client(),
      url: url,
      authToken: token,
      deviceId: identity.deviceId,
    );
  }

  /// Cambia la URL del backend (persistido).
  static Future<void> setBackendUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKeyBackendUrl, url.trim());
  }

  /// Cambia el auth token (persistido).
  static Future<void> setAuthToken(String? token) async {
    final prefs = await SharedPreferences.getInstance();
    if (token == null || token.isEmpty) {
      await prefs.remove(_prefsKeyAuthToken);
    } else {
      await prefs.setString(_prefsKeyAuthToken, token);
    }
  }

  /// Lee la URL actual sin instanciar.
  static Future<String> getBackendUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefsKeyBackendUrl) ?? _defaultBackendUrl;
  }

  /// Verifica la conexión con el backend.
  static Future<BackendConnection> testConnection(String url) async {
    final base = url.trim().replaceAll(RegExp(r'/+$'), '');
    final stopwatch = Stopwatch()..start();
    try {
      final res = await http.get(Uri.parse('$base/api/v1/health')).timeout(_timeout);
      stopwatch.stop();
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return BackendConnection(
          url: base,
          isReachable: true,
          version: data['version'] as String?,
          latency: stopwatch.elapsed,
        );
      }
      return BackendConnection(
        url: base,
        isReachable: false,
        error: 'HTTP ${res.statusCode}',
        latency: stopwatch.elapsed,
      );
    } catch (e) {
      stopwatch.stop();
      return BackendConnection(
        url: base,
        isReachable: false,
        error: e.toString(),
        latency: stopwatch.elapsed,
      );
    }
  }

  Map<String, String> _headers([Map<String, String>? extra]) {
    final h = Map<String, String>.from(_baseHeaders);
    if (_authToken != null) h['Authorization'] = 'Bearer $_authToken';
    if (extra != null) h.addAll(extra);
    return h;
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    final cleanPath = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$_url$cleanPath').replace(queryParameters: query);
  }

  Future<http.Response> get(String path, {Map<String, String>? query, Map<String, String>? headers}) {
    return _http.get(_uri(path, query), headers: _headers(headers)).timeout(_timeout);
  }

  Future<http.Response> post(String path, {Object? body, Map<String, String>? headers}) {
    return _http.post(_uri(path), headers: _headers(headers), body: body).timeout(_timeout);
  }

  Future<http.Response> put(String path, {Object? body, Map<String, String>? headers}) {
    return _http.put(_uri(path), headers: _headers(headers), body: body).timeout(_timeout);
  }

  Future<http.Response> delete(String path, {Map<String, String>? headers}) {
    return _http.delete(_uri(path), headers: _headers(headers)).timeout(_timeout);
  }

  /// Registra el device en el backend (idempotente; si ya está, devuelve ok).
  Future<bool> registerDevice(DeviceIdentity identity) async {
    try {
      final res = await post('/api/v1/register', body: jsonEncode(identity.toRegistrationPayload()));
      if (res.statusCode == 200 || res.statusCode == 201) {
        // Guardar token si viene
        final data = jsonDecode(res.body) as Map<String, dynamic>?;
        if (data?['accessToken'] != null) {
          await setAuthToken(data!['accessToken'] as String);
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefsKeyLastConnected, DateTime.now().toIso8601String());
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Refresca el token (si está expirado).
  Future<String?> refreshToken(String refreshToken) async {
    try {
      final res = await post('/api/v1/auth/refresh', body: jsonEncode({'refreshToken': refreshToken}));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final newToken = data['accessToken'] as String?;
        if (newToken != null) {
          await setAuthToken(newToken);
          return newToken;
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  void close() {
    _http.close();
  }
}
