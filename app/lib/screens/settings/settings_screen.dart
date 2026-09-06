// SettingsScreen: minimalista, customizable.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants.dart';
import '../../services/app_info.dart';
import '../../widgets/empty_state.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustes')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (kIsWeb) _WebBanner(),
          _buildSection(
            title: 'General',
            tiles: [
              _Tile(
                icon: Icons.folder,
                title: 'Vaults',
                subtitle: 'Detectar o cambiar vault activo',
                onTap: () => _showComingSoon(context, 'Vaults'),
              ),
              _Tile(
                icon: Icons.calendar_month,
                title: 'Calendar',
                subtitle: kIsWeb ? 'Solo en Android' : 'Integración con Calendar',
                onTap: kIsWeb ? null : () => _showComingSoon(context, 'Calendar'),
              ),
              _Tile(
                icon: Icons.cloud,
                title: 'Backend',
                subtitle: 'Conectar con el backend Node.js',
                onTap: () => _showComingSoon(context, 'Backend'),
              ),
            ],
          ),
          _buildSection(
            title: 'Apariencia',
            tiles: [
              _Tile(
                icon: Icons.dark_mode,
                title: 'Tema',
                subtitle: 'Sigue el sistema (M3 Material You)',
              ),
              _Tile(
                icon: Icons.text_fields,
                title: 'Tipografía',
                subtitle: 'Default del sistema',
              ),
            ],
          ),
          _buildSection(
            title: 'Avanzado',
            tiles: [
              _Tile(
                icon: Icons.bug_report,
                title: 'Reportar bug',
                subtitle: 'github.com/rgdi/m-nexus/issues',
                onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus/issues')),
              ),
              _Tile(
                icon: Icons.book,
                title: 'Documentación',
                subtitle: 'github.com/rgdi/m-nexus',
                onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus')),
              ),
              _Tile(
                icon: Icons.code,
                title: 'Changelog',
                subtitle: 'Versiones',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const ChangelogView()),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Center(
            child: FutureBuilder<AppInfo>(
              future: AppInfo.load(),
              builder: (ctx, snap) {
                return Text(
                  '${AppConstants.name} v${snap.data?.fullVersion ?? "..."}',
                  style: Theme.of(context).textTheme.bodySmall,
                );
              },
            ),
          ),
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

  void _showComingSoon(BuildContext c, String name) {
    showDialog(
      context: c,
      builder: (_) => AlertDialog(
        title: Text(name),
        content: const Text('Configuración detallada próximamente en v0.43.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK')),
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
  const _Tile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
  });
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
  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.web, size: 20),
            const SizedBox(width: 8),
            const Expanded(child: Text(
              'Estás en la versión Web. Algunas funciones (Calendar, Vault local) solo están disponibles en Android.',
              style: TextStyle(fontSize: 12),
            )),
          ],
        ),
      ),
    );
  }
}

class ChangelogView extends StatelessWidget {
  const ChangelogView({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Changelog')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          _ChangelogEntry(
            version: 'v0.42',
            date: '2026-09-05',
            changes: [
              'Refactor completo: arquitectura modular con archivos <300 líneas',
              'MainShell con shortcuts (Ctrl+1/2/3/4 para cambiar de sección)',
              'NoteEditor con split view + preview en vivo + atajos (Ctrl+B, Ctrl+I, Ctrl+E, Ctrl+S)',
              'VaultBrowser con árbol de archivos + filtro',
              'FlashcardsList con review + edit (crear nuevas)',
              'HomeScreen con saludo dinámico, stats, acciones, recientes y panel de atajos',
              'Tema Material 3 + soporte Flutter Web',
            ],
          ),
          _ChangelogEntry(
            version: 'v0.41',
            date: '2026-09-05',
            changes: [
              'Primer refactor a standalone',
              'Dashboard inicial',
              'Material 3 theme',
            ],
          ),
        ],
      ),
    );
  }
}

class _ChangelogEntry extends StatelessWidget {
  final String version;
  final String date;
  final List<String> changes;
  const _ChangelogEntry({
    required this.version,
    required this.date,
    required this.changes,
  });
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(version,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(color: Theme.of(context).colorScheme.primary)),
          Text(date, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          ...changes.map((c) => Padding(
            padding: const EdgeInsets.only(left: 16, top: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('• '),
                Expanded(child: Text(c)),
              ],
            ),
          )),
        ],
      ),
    );
  }
}
