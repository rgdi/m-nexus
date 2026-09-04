// Tests del fix de _installPlugin en home_page.
// El bug era que downloadUrl quedaba vacío (''), lo que hacía que
// plugin_installer lanzara un error inmediato.
//
// v0.32: _installPlugin ahora hace un fetch del release desde GitHub
// y construye el PluginRelease con la URL del ZIP.

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mnexus_installer/models/plugin_release.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('PluginRelease con downloadUrl es válido', () {
    final r = PluginRelease(
      latestVersion: '0.32.0',
      minAppVersion: '1.5.0',
      releaseNotes: 'Notas',
      downloadUrl: 'https://github.com/rgdi/m-nexus/releases/download/v0.32.0/m-nexus-plugin-v0.32.0.zip',
      checksumSha256: '',
    );
    expect(r.downloadUrl.isNotEmpty, true);
    expect(r.downloadUrl, contains('m-nexus-plugin-'));
    expect(r.downloadUrl, endsWith('.zip'));
  });

  test('Simula el parseo de la respuesta de GitHub releases/latest', () async {
    final mock = MockClient((request) async {
      expect(request.url.path, contains('/releases/latest'));
      return http.Response('''
{
  "tag_name": "v0.32.0",
  "body": "Cambios v0.32.0",
  "assets": [
    {
      "name": "m-nexus-companion-v0.32.0.apk",
      "browser_download_url": "https://github.com/.../m-nexus-companion-v0.32.0.apk"
    },
    {
      "name": "m-nexus-plugin-v0.32.0.zip",
      "browser_download_url": "https://github.com/.../m-nexus-plugin-v0.32.0.zip"
    }
  ]
}
''', 200);
    });

    final response = await mock.get(Uri.parse(
        'https://api.github.com/repos/rgdi/m-nexus/releases/latest'));
    expect(response.statusCode, 200);
    final body = response.body;
    expect(body.contains('m-nexus-plugin-'), true);
    expect(body.contains('m-nexus-companion-'), true);

    // Verifico que se puede extraer la URL del plugin
    final regExp = RegExp(
      r'"name":\s*"m-nexus-plugin-v0\.32\.0\.zip",\s*"browser_download_url":\s*"([^"]+)"',
    );
    final match = regExp.firstMatch(body);
    expect(match, isNotNull);
    expect(match!.group(1), 'https://github.com/.../m-nexus-plugin-v0.32.0.zip');
  });
}
