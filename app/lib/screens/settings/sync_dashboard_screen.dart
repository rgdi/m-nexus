// sync_dashboard_screen.dart: dashboard de sincronizacion end-to-end.
//
// v0.51.6: muestra el estado real de la sincronizacion vault<->backend:
// - Backend online? version?
// - CRDT: rooms activos, bytes
// - Local: archivos, tamano
// - Last sync: timestamp y duracion
// - Conflicts: archivos modificados desde el ultimo sync
// - Botones Push / Pull / Force check

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../services/sync_dashboard_service.dart';
import '../../services/settings_service.dart';
import '../../state/app_state.dart';

class SyncDashboardScreen extends StatefulWidget {
  const SyncDashboardScreen({super.key});

  @override
  State<SyncDashboardScreen> createState() => _SyncDashboardScreenState();
}

class _SyncDashboardScreenState extends State<SyncDashboardScreen> {
  SyncState? _state;
  bool _loading = false;
  bool _pushing = false;
  bool _pulling = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final settings = await SettingsService.instance.load();
    final app = AppState.instance;
    final svc = SyncDashboardService(
      backendUrl: settings.backendUrl,
      vaultPath: app.activeVault?.path ?? '/tmp',
    );
    final s = await svc.snapshot();
    if (!mounted) return;
    setState(() {
      _state = s;
      _loading = false;
    });
  }

  Future<void> _push() async {
    setState(() => _pushing = true);
    final settings = await SettingsService.instance.load();
    final app = AppState.instance;
    final svc = SyncDashboardService(
      backendUrl: settings.backendUrl,
      vaultPath: app.activeVault?.path ?? '/tmp',
    );
    final ok = await svc.push();
    if (!mounted) return;
    setState(() => _pushing = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok ? 'Push OK' : 'Push failed'),
      duration: const Duration(seconds: 2),
    ));
    await _refresh();
  }

  Future<void> _pull() async {
    setState(() => _pulling = true);
    final settings = await SettingsService.instance.load();
    final app = AppState.instance;
    final svc = SyncDashboardService(
      backendUrl: settings.backendUrl,
      vaultPath: app.activeVault?.path ?? '/tmp',
    );
    final ok = await svc.pull();
    if (!mounted) return;
    setState(() => _pulling = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok ? 'Pull OK' : 'Pull failed'),
      duration: const Duration(seconds: 2),
    ));
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sync dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _refresh,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading && _state == null
        ? const Center(child: CircularProgressIndicator())
        : _state == null
          ? const Center(child: Text('No data'))
          : _buildBody(),
    );
  }

  Widget _buildBody() {
    final s = _state!;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Status general
          _StatusCard(state: s),
          const SizedBox(height: 16),
          // Backend info
          _SectionTitle('Backend'),
          _InfoRow(label: 'Online', value: s.backendOnline ? 'Sí' : 'No', icon: Icons.cloud_done),
          if (s.backendVersion != null)
            _InfoRow(label: 'Versión', value: s.backendVersion!, icon: Icons.tag),
          const SizedBox(height: 16),
          // CRDT info
          _SectionTitle('CRDT sync'),
          _InfoRow(label: 'Estado', value: s.crdtOk ? 'OK' : 'Error', icon: Icons.sync),
          _InfoRow(label: 'Rooms activos', value: s.crdtRooms.toString(), icon: Icons.workspaces),
          _InfoRow(label: 'Bytes CRDT', value: _fmtBytes(s.crdtTotalBytes), icon: Icons.storage),
          const SizedBox(height: 16),
          // Local info
          _SectionTitle('Vault local'),
          _InfoRow(label: 'Archivos .md', value: s.localFiles.toString(), icon: Icons.description),
          _InfoRow(label: 'Tamaño total', value: _fmtBytes(s.localSize), icon: Icons.folder),
          const SizedBox(height: 16),
          // Last sync
          _SectionTitle('Última sincronización'),
          _InfoRow(
            label: 'Fecha',
            value: s.lastSyncAt != null ? _fmtDateTime(s.lastSyncAt!) : 'Nunca',
            icon: Icons.schedule,
          ),
          const SizedBox(height: 16),
          // Conflicts
          if (s.conflicts.isNotEmpty) ...[
            _SectionTitle('Conflictos pendientes (${s.conflicts.length})'),
            ...s.conflicts.take(20).map((c) => ListTile(
              dense: true,
              leading: const Icon(Icons.warning_amber, color: Colors.orange),
              title: Text(c.notePath, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
              subtitle: Text(c.reason),
            )),
            if (s.conflicts.length > 20)
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Text('+${s.conflicts.length - 20} más',
                  style: Theme.of(context).textTheme.bodySmall),
              ),
          ],
          const SizedBox(height: 16),
          if (s.error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text('Error: ${s.error}'),
            ),
            const SizedBox(height: 16),
          ],
          // Action buttons
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  icon: _pushing
                    ? const SizedBox(width: 14, height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.cloud_upload),
                  label: const Text('Push'),
                  onPressed: _pushing || _pulling ? null : _push,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonalIcon(
                  icon: _pulling
                    ? const SizedBox(width: 14, height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.cloud_download),
                  label: const Text('Pull'),
                  onPressed: _pushing || _pulling ? null : _pull,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _fmtBytes(int b) {
    if (b < 1024) return '$b B';
    if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    if (b < 1024 * 1024 * 1024) return '${(b / 1024 / 1024).toStringAsFixed(2)} MB';
    return '${(b / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
  }

  String _fmtDateTime(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inSeconds < 60) return 'hace ${diff.inSeconds}s';
    if (diff.inMinutes < 60) return 'hace ${diff.inMinutes}m';
    if (diff.inHours < 24) return 'hace ${diff.inHours}h';
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

class _StatusCard extends StatelessWidget {
  final SyncState state;
  const _StatusCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final ok = state.isHealthy;
    final color = ok ? Colors.green : Colors.orange;
    return Card(
      color: color.withValues(alpha: 0.1),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(ok ? Icons.check_circle : Icons.warning, color: color, size: 32),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ok ? 'Todo sincronizado' : 'Atención requerida',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  if (state.error != null)
                    Text(state.error!,
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Text(text, style: Theme.of(context).textTheme.titleSmall),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _InfoRow({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 20),
      title: Text(label, style: const TextStyle(fontSize: 13)),
      trailing: Text(value,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
    );
  }
}
