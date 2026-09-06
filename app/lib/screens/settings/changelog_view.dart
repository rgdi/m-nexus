// ChangelogView: lista de cambios por versión.

import 'package:flutter/material.dart';

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
            version: 'v0.44.1',
            date: '2026-09-06',
            changes: [
              'SINGLE APP: matamos el plugin de Obsidian. App totalmente independiente.',
              'Renombrado: companion-app → app, mnexus_installer → mnexus_app.',
              'Adaptividad: DeviceInfo detecta platform/form factor/perf tier.',
              'Widgets adaptivos: AdaptiveText, ResponsiveGrid, LowPerfGuard.',
              'Backend refactorizado: adaptiveQuiz/crossRelevance/structuredRoutes en archivos <400 líneas.',
              'Bug fixes: NoteEditor/NoteView ahora reciben vaultPath explícito.',
              'shared_preferences restaurado, recorder/sync_queue legacy eliminados.',
            ],
          ),
          _ChangelogEntry(
            version: 'v0.43.0',
            date: '2026-09-05',
            changes: [
              'SINGLE APP: companion → app, com.mnexus.installer → com.mnexus.app',
              'Cero referencias a Obsidian en código activo',
              'APK assets: m-nexus-companion → m-nexus-app',
            ],
          ),
          _ChangelogEntry(
            version: 'v0.42.0',
            date: '2026-09-05',
            changes: [
              'UNIFIED ARCHITECTURE: matamos lib/ui/ (6270 líneas)',
              'Nueva estructura: lib/{core,state,services,widgets,screens/}',
              '3163 líneas totales en 18 archivos, todos <400 líneas',
              'Atajos: Ctrl+1/2/3/4, Ctrl+N/S/E/B/I, Ctrl+R, Ctrl+/',
              'Material 3 + AdaptiveScaffold (bottom nav mobile / rail desktop)',
            ],
          ),
          _ChangelogEntry(
            version: 'v0.41.0',
            date: '2026-09-05',
            changes: [
              'Standalone app: VaultBrowser, MarkdownViewer, FlashcardsViewer sin Obsidian',
              'Flutter Web support: PWA manifest + splash',
              'Material 3 theme + AdaptiveScaffold',
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
