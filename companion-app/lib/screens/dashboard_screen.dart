// DashboardScreen v0.41: home principal de la app standalone.
//
// Layout:
//   - Header con saludo, stats rápidas
//   - Próximo evento del calendar
//   - Stats del vault (notas, flashcards, próximas repasos)
//   - Acciones rápidas (grabar, crear nota, explorar vault)
//   - Update disponible (si lo hay)
//
// Adaptativo:
//   - Mobile: 1 columna
//   - Tablet: 2 columnas
//   - Desktop: 3 columnas (sidebar nav + 2 cols body)

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../services/app_info.dart';
import '../services/calendar_service.dart';
import '../services/updater.dart';
import '../utils/theme.dart';
import '../ui/vault_browser_page.dart';
import '../ui/flashcards_viewer.dart';
import 'note_editor_screen.dart';
import '../ui/recording_page.dart';
import 'settings_screen.dart';
import 'help_screen.dart';

class DashboardData {
  final List<VaultInfo> vaults;
  final List<CalendarEvent> upcomingEvents;
  final AppUpdate? update;
  final String appVersion;
  final int noteCount;
  final int flashcardCount;
  final int flashcardsDue;

  const DashboardData({
    required this.vaults,
    required this.upcomingEvents,
    required this.update,
    required this.appVersion,
    required this.noteCount,
    required this.flashcardCount,
    required this.flashcardsDue,
  });

  bool get hasUpdate => update != null;
  bool get hasVaults => vaults.isNotEmpty;
  CalendarEvent? get nextEvent => upcomingEvents.isEmpty ? null : upcomingEvents.first;
}

class DashboardScreen extends StatefulWidget {
  final VoidCallback? onLogout;
  const DashboardScreen({super.key, this.onLogout});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _updater = Updater();
  final _vaultDetector = VaultDetector();
  CalendarService? _calendar;
  DashboardData? _data;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _calendar = CalendarService();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final info = await AppInfo.load();
    try {
      await _calendar!.load();
      final events = _calendar!.enabled
          ? await _calendar!.listUpcoming(limit: 5, daysAhead: 14)
          : <CalendarEvent>[];
      final vaults = await _vaultDetector.detectVaults();
      final update = await _updater.check(force: false);
      final noteCount = await _countNotes(vaults);
      final fcInfo = await _countFlashcards(vaults);
      if (!mounted) return;
      setState(() {
        _data = DashboardData(
          vaults: vaults,
          upcomingEvents: events,
          update: update.update,
          appVersion: info.fullVersion,
          noteCount: noteCount,
          flashcardCount: fcInfo.total,
          flashcardsDue: fcInfo.due,
        );
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; });
    }
  }

  Future<int> _countNotes(List<VaultInfo> vaults) async {
    var count = 0;
    for (final v in vaults) {
      try {
        final dir = Directory(v.path);
        if (!await dir.exists()) continue;
        await for (final f in dir.list(recursive: true)) {
          if (f is File && p.extension(f.path) == '.md') count++;
        }
      } catch (_) {}
    }
    return count;
  }

  Future<({int total, int due})> _countFlashcards(List<VaultInfo> vaults) async {
    var total = 0;
    var due = 0;
    for (final v in vaults) {
      final fcDir = Directory(p.join(v.path, '_M-NEXUS', 'Flashcards', 'Approved'));
      if (!await fcDir.exists()) continue;
      await for (final f in fcDir.list()) {
        if (f is! File || p.extension(f.path) != '.md') continue;
        total++;
        try {
          final content = await f.readAsString();
          if (RegExp(r'nextReview:\s*(\d{4}-\d{2}-\d{2})').firstMatch(content)
              ?.group(1) != null) {
            final m = RegExp(r'nextReview:\s*(\d{4}-\d{2}-\d{2})').firstMatch(content)!;
            final d = DateTime.tryParse(m.group(1)!);
            if (d != null && d.isBefore(DateTime.now())) due++;
          }
        } catch (_) {}
      }
    }
    return (total: total, due: due);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _data == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: _DashboardContent(
        data: _data!,
        onOpenVault: (v) async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => VaultBrowserPage(vaultPath: v.path),
          ));
        },
        onOpenFlashcards: (v) async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => FlashcardsViewerPage(vaultPath: v.path),
          ));
        },
        onNewNote: (v) async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => NoteEditorScreen(vaultPath: v.path),
          ));
          _load();
        },
        onRecord: () async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => const RecordingPage(),
          ));
          _load();
        },
        onSettings: () async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => const SettingsScreen(),
          ));
          _load();
        },
        onHelp: () {
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => const HelpScreen(),
          ));
        },
      ),
    );
  }
}

class _DashboardContent extends StatelessWidget {
  final DashboardData data;
  final void Function(VaultInfo) onOpenVault;
  final void Function(VaultInfo) onOpenFlashcards;
  final void Function(VaultInfo) onNewNote;
  final VoidCallback onRecord;
  final VoidCallback onSettings;
  final VoidCallback onHelp;

  const _DashboardContent({
    required this.data,
    required this.onOpenVault,
    required this.onOpenFlashcards,
    required this.onNewNote,
    required this.onRecord,
    required this.onSettings,
    required this.onHelp,
  });

  @override
  Widget build(BuildContext context) {
    final isWide = MnexusTheme.isDesktop(context);
    return CustomScrollView(
      slivers: [
        SliverAppBar.large(
          title: const Text('M-NEXUS'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () {
                final state = context.findAncestorStateOfType<_DashboardScreenState>();
                state?._load();
              },
              tooltip: 'Recargar',
            ),
            IconButton(
              icon: const Icon(Icons.settings_outlined),
              onPressed: onSettings,
              tooltip: 'Configuración',
            ),
            IconButton(
              icon: const Icon(Icons.help_outline),
              onPressed: onHelp,
              tooltip: 'Ayuda',
            ),
            const SizedBox(width: 8),
          ],
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              if (data.hasUpdate) ...[
                _UpdateBanner(update: data.update!),
                const SizedBox(height: 16),
              ],
              _Greeting(),
              const SizedBox(height: 20),
              _StatsRow(data: data),
              const SizedBox(height: 20),
              if (isWide)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _QuickActions(
                      vaults: data.vaults,
                      onOpenVault: onOpenVault,
                      onOpenFlashcards: onOpenFlashcards,
                      onNewNote: onNewNote,
                      onRecord: onRecord,
                    )),
                    const SizedBox(width: 16),
                    Expanded(child: _UpcomingEvent(event: data.nextEvent)),
                  ],
                )
              else ...[
                _QuickActions(
                  vaults: data.vaults,
                  onOpenVault: onOpenVault,
                  onOpenFlashcards: onOpenFlashcards,
                  onNewNote: onNewNote,
                  onRecord: onRecord,
                ),
                const SizedBox(height: 16),
                _UpcomingEvent(event: data.nextEvent),
              ],
              const SizedBox(height: 16),
              if (data.hasVaults) _VaultsCard(
                vaults: data.vaults,
                onOpenVault: onOpenVault,
              ),
            ]),
          ),
        ),
      ],
    );
  }
}

class _Greeting extends StatelessWidget {
  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 6) return 'Buenas noches';
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_greeting(),
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: scheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 4),
        Text('¿Qué querés aprender hoy?',
          style: Theme.of(context).textTheme.displaySmall,
        ),
      ],
    );
  }
}

class _StatsRow extends StatelessWidget {
  final DashboardData data;
  const _StatsRow({required this.data});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _StatCard(
          icon: Icons.description_outlined,
          label: 'Notas',
          value: '${data.noteCount}',
          color: Colors.blue,
        )),
        const SizedBox(width: 12),
        Expanded(child: _StatCard(
          icon: Icons.style_outlined,
          label: 'Flashcards',
          value: '${data.flashcardCount}',
          subtitle: data.flashcardsDue > 0
              ? '${data.flashcardsDue} para repasar'
              : 'al día',
          color: data.flashcardsDue > 0 ? Colors.orange : Colors.green,
        )),
        const SizedBox(width: 12),
        Expanded(child: _StatCard(
          icon: Icons.folder_outlined,
          label: 'Vaults',
          value: '${data.vaults.length}',
          subtitle: '${data.vaults.where((v) => v.installedPluginVersion != null).length} con plugin',
          color: Colors.purple,
        )),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String? subtitle;
  final Color color;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: color, size: 20),
                ),
                Text(label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(value,
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 2),
              Text(subtitle!,
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _UpdateBanner extends StatelessWidget {
  final AppUpdate update;
  const _UpdateBanner({required this.update});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.system_update,
              color: Theme.of(context).colorScheme.onPrimaryContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Actualización disponible',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                    ),
                  ),
                  Text('v${update.latestVersion}',
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                    ),
                  ),
                ],
              ),
            ),
            FilledButton.tonal(
              onPressed: () {
                showDialog(context: context, builder: (_) =>
                  AlertDialog(
                    title: const Text('Actualizar'),
                    content: Text(update.body.length > 500
                        ? update.body.substring(0, 500) + '...'
                        : update.body),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(context),
                        child: const Text('Cerrar')),
                    ],
                  ),
                );
              },
              child: const Text('Ver'),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  final List<VaultInfo> vaults;
  final void Function(VaultInfo) onOpenVault;
  final void Function(VaultInfo) onOpenFlashcards;
  final void Function(VaultInfo) onNewNote;
  final VoidCallback onRecord;

  const _QuickActions({
    required this.vaults,
    required this.onOpenVault,
    required this.onOpenFlashcards,
    required this.onNewNote,
    required this.onRecord,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            if (vaults.isNotEmpty)
              _ActionTile(
                icon: Icons.add_circle_outline,
                title: 'Nueva nota',
                subtitle: 'Crear nota en ${vaults.first.name}',
                color: Colors.blue,
                onTap: () => onNewNote(vaults.first),
              ),
            _ActionTile(
              icon: Icons.mic_none,
              title: 'Grabar clase',
              subtitle: kIsWeb ? 'Solo Android' : 'Audio + transcripción',
              color: Colors.red,
              onTap: kIsWeb ? null : onRecord,
            ),
            if (vaults.isNotEmpty)
              _ActionTile(
                icon: Icons.style_outlined,
                title: 'Repasar flashcards',
                subtitle: '${vaults.first.name} · _M-NEXUS/Flashcards',
                color: Colors.orange,
                onTap: () => onOpenFlashcards(vaults.first),
              ),
            if (vaults.isNotEmpty)
              _ActionTile(
                icon: Icons.folder_open,
                title: 'Explorar vault',
                subtitle: vaults.first.path,
                color: Colors.purple,
                onTap: () => onOpenVault(vaults.first),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Color color;
  final VoidCallback? onTap;
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.color,
    this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title,
        style: const TextStyle(fontWeight: FontWeight.w500)),
      subtitle: subtitle != null ? Text(subtitle!, style: const TextStyle(fontSize: 11)) : null,
      trailing: const Icon(Icons.arrow_forward_ios, size: 14),
      enabled: onTap != null,
      onTap: onTap,
    );
  }
}

class _UpcomingEvent extends StatelessWidget {
  final CalendarEvent? event;
  const _UpcomingEvent({required this.event});

  @override
  Widget build(BuildContext context) {
    if (event == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Icon(Icons.event_available, size: 40,
                color: Theme.of(context).colorScheme.onSurfaceVariant),
              const SizedBox(height: 8),
              const Text('Sin eventos próximos',
                style: TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              Text(
                kIsWeb
                    ? 'Conectá un calendario en la app Android'
                    : 'Activa Calendar en Configuración',
                style: TextStyle(fontSize: 11,
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    final now = DateTime.now();
    final isHappening = now.isAfter(event!.start) && now.isBefore(event!.end);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isHappening ? Icons.event_available : Icons.event,
                  color: isHappening ? Colors.green : Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  isHappening ? 'En curso ahora' : 'Próximo evento',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(event!.title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              maxLines: 2, overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.schedule, size: 14, color: Colors.grey),
                const SizedBox(width: 4),
                Text(
                  '${event!.start.hour.toString().padLeft(2, '0')}:${event!.start.minute.toString().padLeft(2, '0')}'
                  ' — ${event!.end.hour.toString().padLeft(2, '0')}:${event!.end.minute.toString().padLeft(2, '0')}',
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                ),
                if (event!.location.isNotEmpty) ...[
                  const SizedBox(width: 12),
                  const Icon(Icons.location_on, size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(event!.location,
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VaultsCard extends StatelessWidget {
  final List<VaultInfo> vaults;
  final void Function(VaultInfo) onOpenVault;
  const _VaultsCard({required this.vaults, required this.onOpenVault});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Tus vaults',
              style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            ...vaults.map((v) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: v.installedPluginVersion != null
                    ? Colors.green.shade100
                    : Theme.of(context).colorScheme.surfaceContainerHighest,
                child: Icon(
                  v.installedPluginVersion != null ? Icons.check : Icons.folder,
                  color: v.installedPluginVersion != null ? Colors.green : null,
                ),
              ),
              title: Text(v.name),
              subtitle: Text('${v.path}\nvía ${v.detectionMethod ?? "auto"}',
                style: const TextStyle(fontSize: 11)),
              trailing: const Icon(Icons.arrow_forward_ios, size: 14),
              onTap: () => onOpenVault(v),
            )),
          ],
        ),
      ),
    );
  }
}

// Necesito el import para Directory
// (lo agrego en el archivo principal)
