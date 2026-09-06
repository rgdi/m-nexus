// SettingsScreen: configuración real de la app.
// - Tema (system/light/dark)
// - Backend URL
// - Detección de vault
// - Calendar (permiso y selección)
// - Tipografía (escala)
// - Changelog

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants.dart';
import '../../services/app_info.dart';
import '../../services/calendar_service.dart';
import '../../services/logger.dart';
import '../../services/settings_service.dart';
import '../../services/vault_detector.dart';
import 'changelog_view.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  AppSettings _settings = const AppSettings();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final log = AdvancedLogger.instance;
    try {
      final s = await SettingsService().load();
      if (!mounted) return;
      log.debug('settings', 'settings loaded', context: s.toJson());
      setState(() {
        _settings = s;
        _loading = false;
      });
    } catch (e, s) {
      log.error('settings', '[EC-CFG-011] Load settings failed', error: e, stack: s);
      if (!mounted) return;
      setState(() { _loading = false; });
    }
  }

  Future<void> _save() async {
    try {
      await SettingsService().save(_settings);
      AdvancedLogger.instance.info('settings', 'settings saved', context: _settings.toJson());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Guardado'), duration: Duration(seconds: 1)),
      );
    } catch (e, s) {
      AdvancedLogger.instance.error('settings', '[EC-CFG-010] Save settings failed',
        error: e, stack: s);
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
      appBar: AppBar(title: const Text('Ajustes')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (kIsWeb) const _WebBanner(),
          _buildSection(title: 'General', tiles: [
            _Tile(icon: Icons.folder, title: 'Vaults',
              subtitle: 'Detectar vault activo', onTap: _showVaultsDialog),
            if (!kIsWeb) _Tile(icon: Icons.calendar_month, title: 'Calendar',
              subtitle: 'Seleccionar calendario', onTap: _showCalendarPicker),
            _Tile(icon: Icons.cloud, title: 'Backend',
              subtitle: _settings.backendUrl ?? 'No configurado', onTap: _showBackendDialog),
          ]),
          _buildSection(title: 'Apariencia', tiles: [
            _Tile(icon: Icons.dark_mode, title: 'Tema',
              subtitle: _themeLabel(_settings.themeMode), onTap: _showThemeDialog),
            _Tile(icon: Icons.text_fields, title: 'Tamaño de texto',
              subtitle: '${(_settings.fontScale * 100).toStringAsFixed(0)}%',
              onTap: _showFontScaleDialog),
            _Tile(icon: Icons.vibration, title: 'Vibración',
              subtitle: _settings.enableHaptics ? 'Activada' : 'Desactivada',
              onTap: _toggleHaptics),
          ]),
          _buildSection(title: 'Avanzado', tiles: [
            _Tile(icon: Icons.bug_report, title: 'Reportar bug',
              subtitle: 'github.com/rgdi/m-nexus/issues',
              onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus/issues'))),
            _Tile(icon: Icons.book, title: 'Documentación',
              subtitle: 'github.com/rgdi/m-nexus',
              onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus'))),
            _Tile(icon: Icons.code, title: 'Changelog',
              subtitle: 'Versiones',
              onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const ChangelogView()))),
          ]),
          const SizedBox(height: 24),
          Center(
            child: FutureBuilder<AppInfo>(
              future: AppInfo.load(),
              builder: (ctx, snap) => Text(
                '${AppConstants.name} v${snap.data?.fullVersion ?? "..."}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _themeLabel(AppThemeMode m) => switch (m) {
    AppThemeMode.system => 'Sistema',
    AppThemeMode.light => 'Claro',
    AppThemeMode.dark => 'Oscuro',
  };

  Future<void> _showThemeDialog() async {
    final r = await showDialog<AppThemeMode>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Tema'),
        children: AppThemeMode.values.map((m) => RadioListTile<AppThemeMode>(
          title: Text(_themeLabel(m)),
          value: m,
          groupValue: _settings.themeMode,
          onChanged: (v) => Navigator.pop(ctx, v),
        )).toList(),
      ),
    );
    if (r != null) {
      setState(() => _settings = _settings.copyWith(themeMode: r));
      await _save();
    }
  }

  Future<void> _showFontScaleDialog() async {
    final r = await showDialog<double>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Tamaño de texto'),
        children: [0.85, 1.0, 1.15, 1.3].map((s) => RadioListTile<double>(
          title: Text('${(s * 100).toStringAsFixed(0)}%'),
          value: s,
          groupValue: _settings.fontScale,
          onChanged: (v) => Navigator.pop(ctx, v),
        )).toList(),
      ),
    );
    if (r != null) {
      setState(() => _settings = _settings.copyWith(fontScale: r));
      await _save();
    }
  }

  Future<void> _toggleHaptics() async {
    setState(() => _settings = _settings.copyWith(enableHaptics: !_settings.enableHaptics));
    await _save();
  }

  Future<void> _showBackendDialog() async {
    final c = TextEditingController(text: _settings.backendUrl ?? '');
    final r = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('URL del Backend'),
        content: TextField(
          controller: c, autofocus: true,
          decoration: const InputDecoration(
            hintText: 'http://192.168.1.10:3000',
            helperText: 'Sin slash final. Vacío = sin backend',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, c.text.trim().isEmpty ? null : c.text.trim()),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    if (r != _settings.backendUrl) {
      setState(() => _settings = _settings.copyWith(backendUrl: r));
      await _save();
    }
  }

  Future<void> _showVaultsDialog() async {
    final vaults = await VaultDetector().detectVaults();
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Vaults detectados'),
        content: vaults.isEmpty
            ? const Text('No hay vaults. Usá SAF picker desde el home.')
            : SizedBox(
                width: double.maxFinite,
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: vaults.length,
                  itemBuilder: (_, i) {
                    final v = vaults[i];
                    return ListTile(
                      leading: const Icon(Icons.folder),
                      title: Text(v.name),
                      subtitle: Text('${v.path}\nMétodo: ${v.detectionMethod ?? "auto"}'),
                      isThreeLine: true,
                    );
                  },
                ),
              ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
        ],
      ),
    );
  }

  Future<void> _showCalendarPicker() async {
    if (kIsWeb) return;
    final cal = CalendarService();
    if (!await cal.isPermissionGranted()) {
      final ok = await cal.requestPermission();
      if (!ok) return;
    }
    final cals = await cal.listCalendars();
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Calendarios'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: cals.length,
            itemBuilder: (_, i) {
              final c = cals[i];
              return ListTile(
                leading: CircleAvatar(backgroundColor: c.color, child: Text(c.name[0])),
                title: Text(c.name),
                subtitle: Text(c.accountName ?? 'Sin cuenta'),
                trailing: Icon(
                  c.isSelected ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: c.isSelected ? Theme.of(context).colorScheme.primary : null,
                ),
                onTap: () async {
                  await cal.setSelectedCalendar(c.id);
                  if (mounted) Navigator.pop(ctx);
                },
              );
            },
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
        ],
      ),
    );
  }

  Widget _buildSection({required String title, required List<Widget> tiles}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
            child: Text(title,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.grey)),
          ),
          Card(
            child: Column(
              children: [
                for (var i = 0; i < tiles.length; i++) ...[
                  tiles[i],
                  if (i < tiles.length - 1) const Divider(height: 1),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  const _Tile({required this.icon, required this.title, this.subtitle, this.onTap});
  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, size: 20),
      title: Text(title),
      subtitle: subtitle != null ? Text(subtitle!, style: const TextStyle(fontSize: 12)) : null,
      trailing: onTap != null ? const Icon(Icons.chevron_right, size: 16) : null,
      onTap: onTap,
    );
  }
}

class _WebBanner extends StatelessWidget {
  const _WebBanner();
  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: const Padding(
        padding: EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.web, size: 20),
            SizedBox(width: 8),
            Expanded(child: Text(
              'Estás en la versión Web. Algunas funciones (Calendar, Vault local) solo están disponibles en Android.',
              style: TextStyle(fontSize: 12),
            )),
          ],
        ),
      ),
    );
  }
}
