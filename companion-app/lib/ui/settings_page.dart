// SettingsPage: configuración de la app (auto-update, backend URL, etc).

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/updater.dart';

class SettingsPage extends StatefulWidget {
  final Updater updater;
  const SettingsPage({super.key, required this.updater});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late TextEditingController _backendController;
  late TextEditingController _tokenController;
  late TextEditingController _intervalController;
  late TextEditingController _releaseUrlController;
  bool _autoDownload = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _backendController = TextEditingController();
    _tokenController = TextEditingController();
    _intervalController = TextEditingController(text: '6');
    _releaseUrlController = TextEditingController();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _backendController.text = prefs.getString('backend_url') ?? '';
      _tokenController.text = prefs.getString('auth_token') ?? '';
      _intervalController.text = (prefs.getInt('check_interval_hours') ?? 6).toString();
      _releaseUrlController.text = prefs.getString('release_url') ?? '';
      _autoDownload = prefs.getBool('auto_download') ?? false;
      _loading = false;
    });
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('backend_url', _backendController.text.trim());
    await prefs.setString('auth_token', _tokenController.text.trim());
    final hours = int.tryParse(_intervalController.text) ?? 6;
    await prefs.setInt('check_interval_hours', hours);
    await prefs.setString('release_url', _releaseUrlController.text.trim());
    await prefs.setBool('auto_download', _autoDownload);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Configuración guardada')),
    );
  }

  Future<void> _checkNow() async {
    try {
      final r = await widget.updater.check(force: true);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            r.hasUpdate
                ? 'Actualización v${r.update!.latestVersion} disponible'
                : 'Estás al día (v${r.installedVersion})',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configuración'),
        actions: [
          IconButton(
            icon: const Icon(Icons.save),
            onPressed: _save,
            tooltip: 'Guardar',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const _SectionHeader('Actualizaciones automáticas'),
          SwitchListTile(
            title: const Text('Descargar automáticamente'),
            subtitle: const Text('Cuando haya una nueva versión, descárgala en segundo plano'),
            value: _autoDownload,
            onChanged: (v) => setState(() => _autoDownload = v),
          ),
          TextField(
            controller: _intervalController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Intervalo de chequeo (horas)',
              helperText: 'Cada cuántas horas consultar releases',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _releaseUrlController,
            decoration: const InputDecoration(
              labelText: 'URL del release info',
              helperText: 'JSON con latest_version, download_url, etc. Vacío = default',
            ),
          ),
          const SizedBox(height: 8),
          ElevatedButton.icon(
            onPressed: _checkNow,
            icon: const Icon(Icons.refresh),
            label: const Text('Buscar actualización ahora'),
          ),
          const SizedBox(height: 24),
          const _SectionHeader('Backend M-NEXUS'),
          TextField(
            controller: _backendController,
            decoration: const InputDecoration(
              labelText: 'URL del backend',
              helperText: 'Ej: https://mi-server.example.com',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _tokenController,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Token de autenticación',
              helperText: 'JWT del backend M-NEXUS (opcional, registrado al instalar)',
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(text, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}
