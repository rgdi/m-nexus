// HelpPage: guía de instalación + FAQ + info del sistema.
//
// v0.32: oculta del backend (Settings → "Ayuda" → "Avanzado") y
// accesible directamente desde el menú principal.
// Incluye:
//   - Quickstart (qué hacer al instalar)
//   - Configurar backend
//   - FAQ (por qué no carga, dónde están las grabaciones, etc.)
//   - Permisos necesarios
//   - Info del sistema (versión, build, device, logs)
//   - Link al GitHub para issues

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';
import '../services/app_info.dart';
import '../services/device_id.dart';
import '../services/backend_client.dart';
import '../services/permissions.dart';

class HelpPage extends StatefulWidget {
  const HelpPage({super.key});
  @override
  State<HelpPage> createState() => _HelpPageState();
}

class _HelpPageState extends State<HelpPage> {
  late Future<HelpData> _data;

  @override
  void initState() {
    super.initState();
    _data = _loadData();
  }

  Future<HelpData> _loadData() async {
    final info = await AppInfo.load();
    final identity = await DeviceIdentity.load();
    final url = await BackendClient.getBackendUrl();
    final perms = await PermissionsService.getAll();
    return HelpData(
      appInfo: info,
      deviceId: identity.deviceId,
      deviceModel: identity.model ?? 'Desconocido',
      backendUrl: url,
      permissions: perms,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Guía de instalación'),
        actions: [
          IconButton(
            icon: const Icon(Icons.open_in_new),
            tooltip: 'Abrir GitHub',
            onPressed: _openGithub,
          ),
        ],
      ),
      body: FutureBuilder<HelpData>(
        future: _data,
        builder: (ctx, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final d = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildHero(),
              const SizedBox(height: 16),
              _buildQuickstart(),
              const SizedBox(height: 16),
              _buildBackendSection(d),
              const SizedBox(height: 16),
              _buildRecordingSection(d),
              const SizedBox(height: 16),
              _buildPermissionsSection(d),
              const SizedBox(height: 16),
              _buildTroubleshooting(),
              const SizedBox(height: 16),
              _buildSystemInfo(d),
              const SizedBox(height: 16),
              _buildLinksSection(),
              const SizedBox(height: 80),
            ],
          );
        },
      ),
    );
  }

  Widget _buildHero() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.indigo.shade700, Colors.indigo.shade400],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.medical_services, color: Colors.white, size: 32),
              SizedBox(width: 12),
              Text(
                'M-NEXUS Companion',
                style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Esta app graba tus clases, instala el plugin en Obsidian y conecta con el backend.',
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickstart() {
    return _Section(
      icon: Icons.rocket_launch,
      title: 'Quickstart (5 minutos)',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          _Step(num: 1, text: 'Abre Obsidian en tu teléfono y crea al menos un vault.'),
          _Step(num: 2, text: 'Vuelve a esta app: el vault debería aparecer automáticamente.'),
          _Step(num: 3, text: 'Toca el ícono de descarga junto al vault para instalar el plugin.'),
          _Step(num: 4, text: 'Abre Obsidian → Settings → Community plugins → habilita M-NEXUS.'),
          _Step(num: 5, text: 'Toca el botón rojo "Grabar" para empezar a grabar una clase.'),
        ],
      ),
    );
  }

  Widget _buildBackendSection(HelpData d) {
    return _Section(
      icon: Icons.cloud,
      title: 'Backend M-NEXUS',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'El backend sincroniza tus flashcards FSRS, propuestas de voice notes, '
            'y notas entre dispositivos. Si NO tienes backend, la app sigue '
            'funcionando localmente (modo offline).',
            style: TextStyle(color: Colors.black87),
          ),
          const SizedBox(height: 12),
          _InfoRow(label: 'URL actual', value: d.backendUrl ?? 'No configurado'),
          const SizedBox(height: 8),
          const Text(
            'Para configurar un backend:',
            style: TextStyle(fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 4),
          const _Code('curl -fsSL https://m-nexus.app/install.sh | bash'),
          const SizedBox(height: 4),
          const Text(
            'Luego ingresa la URL en Settings → Backend M-NEXUS.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: () => _copyToClipboard(d.backendUrl ?? ''),
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copiar URL'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _openBackendDocs,
                icon: const Icon(Icons.menu_book, size: 16),
                label: const Text('Docs'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRecordingSection(HelpData d) {
    return _Section(
      icon: Icons.mic,
      title: 'Grabación de clases',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          Text(
            'La app puede grabar tus clases en formato AAC (m4a) y opcionalmente '
            'transcribirlas en vivo usando el motor on-device de Android. '
            'Las grabaciones se guardan en /Android/data/com.mnexus.installer/files/voice_notes/ '
            'y NO se suben a ningún servidor a menos que lo configures.',
          ),
          SizedBox(height: 12),
          Text('Permisos necesarios:', style: TextStyle(fontWeight: FontWeight.w500)),
          SizedBox(height: 4),
          _Step(num: 1, text: 'Micrófono (obligatorio)'),
          _Step(num: 2, text: 'Almacenamiento (para guardar las grabaciones)'),
          _Step(num: 3, text: 'Notificaciones (para la grabación en background)'),
          SizedBox(height: 12),
          Text('Para grabar en background:', style: TextStyle(fontWeight: FontWeight.w500)),
          SizedBox(height: 4),
          Text(
            'Cuando inicies una grabación, la app lanza un "foreground service" '
            'con una notificación persistente. Android no matará la grabación '
            'mientras la app esté en background.',
            style: TextStyle(fontSize: 13, color: Colors.black87),
          ),
        ],
      ),
    );
  }

  Widget _buildPermissionsSection(HelpData d) {
    final granted = d.permissions.where((p) => p.granted).length;
    return _Section(
      icon: Icons.shield,
      title: 'Permisos ($granted/${d.permissions.length})',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ...d.permissions.map((p) => _PermissionRow(status: p)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () async {
                    await PermissionsService.requestAll();
                    setState(() {
                      _data = _loadData();
                    });
                  },
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Pedir todos'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  await PermissionsService.openSettings();
                },
                icon: const Icon(Icons.settings, size: 18),
                label: const Text('Settings del sistema'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTroubleshooting() {
    return _Section(
      icon: Icons.help_outline,
      title: 'Problemas frecuentes',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          _FaqItem(
            q: 'La pantalla de instalación del plugin no avanza',
            a: 'La app necesita conexión a GitHub para descargar el ZIP del plugin. '
               'Verifica que tienes internet, espera unos segundos y reintenta. '
               'Si el problema persiste, ve a Settings → Avanzado → "Forzar descarga desde GitHub".',
          ),
          _FaqItem(
            q: 'El plugin no aparece en Obsidian',
            a: 'Abre Obsidian → Settings → Community plugins → asegúrate de que '
               '"Restricted mode" está desactivado → busca "M-NEXUS" → Install → Enable.',
          ),
          _FaqItem(
            q: 'Las grabaciones están vacías',
            a: 'Verifica que diste permiso de micrófono y que la app no está siendo '
               'optimizada por el sistema (Settings → Apps → M-NEXUS → Battery → '
               '"Sin restricciones").',
          ),
          _FaqItem(
            q: 'El backend no se conecta',
            a: 'Comprueba que la URL sea accesible desde tu teléfono (puedes abrirla '
               'en el navegador). Si usas un servidor en tu casa, el móvil debe estar '
               'en la misma WiFi o usar una VPN. El emulador usa 10.0.2.2 en lugar de localhost.',
          ),
          _FaqItem(
            q: 'Android pide desinstalar antes de actualizar',
            a: 'Esto pasa si instalaste una versión firmada con un certificado distinto. '
               'La v0.32.0+ usa una firma consistente. Si te pasa, desinstala, reinstala '
               'la última versión y tus datos deberían sobrevivir.',
          ),
        ],
      ),
    );
  }

  Widget _buildSystemInfo(HelpData d) {
    return _Section(
      icon: Icons.info,
      title: 'Información del sistema',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InfoRow(label: 'Versión', value: d.appInfo.fullVersion),
          _InfoRow(label: 'Dispositivo', value: d.deviceModel),
          _InfoRow(label: 'OS', value: d.appInfo.osVersion),
          _InfoRow(label: 'Device ID', value: d.deviceId, copyable: true),
          _InfoRow(label: 'Backend', value: d.backendUrl ?? '(no configurado)', copyable: d.backendUrl != null),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _copyDiagnostics(d),
            icon: const Icon(Icons.bug_report, size: 16),
            label: const Text('Copiar diagnóstico (para reportar un bug)'),
          ),
        ],
      ),
    );
  }

  Widget _buildLinksSection() {
    return _Section(
      icon: Icons.link,
      title: 'Enlaces',
      body: Column(
        children: [
          _LinkRow(
            icon: Icons.code,
            label: 'Repositorio en GitHub',
            onTap: _openGithub,
          ),
          _LinkRow(
            icon: Icons.bug_report,
            label: 'Reportar un problema',
            onTap: _openIssues,
          ),
          _LinkRow(
            icon: Icons.menu_book,
            label: 'Documentación',
            onTap: _openDocs,
          ),
          _LinkRow(
            icon: Icons.cloud_download,
            label: 'Última release del APK',
            onTap: _openLatestRelease,
          ),
        ],
      ),
    );
  }

  Future<void> _openGithub() async {
    final url = Uri.parse('https://github.com/rgdi/m-nexus');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openIssues() async {
    final url = Uri.parse('https://github.com/rgdi/m-nexus/issues');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openDocs() async {
    final url = Uri.parse('https://github.com/rgdi/m-nexus#readme');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openBackendDocs() async {
    final url = Uri.parse('https://github.com/rgdi/m-nexus/blob/main/docs/AUTO_UPDATE.md');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openLatestRelease() async {
    final url = Uri.parse('https://github.com/rgdi/m-nexus/releases/latest');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  void _copyToClipboard(String text) {
    if (text.isEmpty) return;
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copiado al portapapeles'), duration: Duration(seconds: 2)),
    );
  }

  void _copyDiagnostics(HelpData d) {
    final diag = '''
M-NEXUS Companion diagnostic
============================
Version: ${d.appInfo.fullVersion}
Device: ${d.deviceModel}
OS: ${d.appInfo.osVersion}
Device ID: ${d.deviceId}
Backend: ${d.backendUrl ?? '(none)'}
Permissions: ${d.permissions.where((p) => p.granted).length}/${d.permissions.length} granted
Date: ${DateTime.now().toIso8601String()}
''';
    Clipboard.setData(ClipboardData(text: diag));
    if (Platform.isAndroid || Platform.isIOS) {
      Share.share(diag, subject: 'M-NEXUS diagnostic');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Diagnóstico copiado')),
      );
    }
  }
}

class HelpData {
  final AppInfo appInfo;
  final String deviceId;
  final String deviceModel;
  final String? backendUrl;
  final List<PermissionStatus> permissions;

  HelpData({
    required this.appInfo,
    required this.deviceId,
    required this.deviceModel,
    required this.backendUrl,
    required this.permissions,
  });
}

class _Section extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget body;

  const _Section({required this.icon, required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 12),
            body,
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  final int num;
  final String text;
  const _Step({required this.num, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 24, height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primary.withOpacity(0.15),
              shape: BoxShape.circle,
            ),
            child: Text(
              '$num',
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool copyable;
  const _InfoRow({required this.label, required this.value, this.copyable = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: const TextStyle(color: Colors.grey, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (copyable)
            IconButton(
              icon: const Icon(Icons.copy, size: 14),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Copiado')),
                );
              },
            ),
        ],
      ),
    );
  }
}

class _Code extends StatelessWidget {
  final String text;
  const _Code(this.text);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: SelectableText(
        text,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  final PermissionStatus status;
  const _PermissionRow({required this.status});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        status.granted
            ? Icons.check_circle
            : (status.permanentlyDenied ? Icons.lock : Icons.warning),
        color: status.granted
            ? Colors.green
            : (status.permanentlyDenied ? Colors.red : Colors.orange),
      ),
      title: Text(status.displayName, style: const TextStyle(fontSize: 13)),
      subtitle: Text(
        status.granted
            ? 'Concedido'
            : (status.permanentlyDenied
                ? 'Denegado permanentemente'
                : 'No concedido'),
        style: const TextStyle(fontSize: 11),
      ),
    );
  }
}

class _FaqItem extends StatelessWidget {
  final String q;
  final String a;
  const _FaqItem({required this.q, required this.a});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text(q, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
        childrenPadding: const EdgeInsets.fromLTRB(0, 0, 0, 8),
        children: [
          Text(a, style: const TextStyle(fontSize: 12, color: Colors.black87)),
        ],
      ),
    );
  }
}

class _LinkRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _LinkRow({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(icon, size: 18),
      title: Text(label, style: const TextStyle(fontSize: 13)),
      trailing: const Icon(Icons.chevron_right, size: 18),
      onTap: onTap,
    );
  }
}
