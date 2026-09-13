// sync_screen.dart — pantalla completa de sync entre devices.
// v0.62.17: pull/push manual + auto-pull al abrir si hay backend.

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/settings_service.dart';
import '../../services/sync_service.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class SyncScreen extends StatefulWidget {
  final String vaultPath;
  const SyncScreen({super.key, required this.vaultPath});
  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  late SyncService _svc;
  late VaultService _vault;
  String _status = 'idle';
  String? _error;
  DateTime? _lastSync;
  int _pushed = 0;
  int _pulled = 0;
  int _conflicts = 0;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _svc = SyncService(widget.vaultPath);
    _vault = VaultService(widget.vaultPath);
  }

  String? get _backendUrl => SettingsService.instance.current.backendUrl;

  Future<void> _push() async {
    if (_busy) return;
    setState(() { _busy = true; _status = 'syncing'; _error = null; });
    try {
      final all = await _vault.listAll();
      final deltas = all.map((n) {
        final lm = SyncService.parseLastModified(n.content) ?? n.modified;
        return SyncDelta(path: n.path, content: n.content, lastModified: lm);
      }).toList();
      if (deltas.isEmpty) {
        setState(() { _status = 'idle'; _busy = false; });
        return;
      }
      final r = await _svc.push(deltas);
      setState(() {
        _pushed = r.accepted.length;
        _conflicts = r.conflicts.length;
        _lastSync = r.serverTime;
        _status = 'success';
        _busy = false;
      });
    } catch (e) {
      setState(() { _status = 'error'; _error = '$e'; _busy = false; });
    }
  }

  Future<void> _pull() async {
    if (_busy) return;
    setState(() { _busy = true; _status = 'syncing'; _error = null; });
    try {
      final since = _lastSync ?? DateTime(2000);
      final r = await _svc.pull(since);
      for (final n in r.notes) {
        try {
          await _vault.writeNote(n.path, n.content);
          _pulled++;
        } catch (_) {}
      }
      setState(() {
        _lastSync = r.serverTime;
        _status = 'success';
        _busy = false;
      });
    } catch (e) {
      setState(() { _status = 'error'; _error = '$e'; _busy = false; });
    }
  }

  Future<void> _syncBoth() async {
    await _push();
    await _pull();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sync', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _busy ? null : _syncBoth,
            tooltip: 'Sync ahora',
          ),
        ],
      ),
      body: SafeArea(
        top: true, bottom: false,
        child: ListView(
          padding: const EdgeInsets.all(MxSpacing.lg),
          children: [
            _StatusCard(
              status: _status,
              error: _error,
              lastSync: _lastSync,
              backendUrl: _backendUrl,
            ),
            const SizedBox(height: MxSpacing.md),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy || _backendUrl == null ? null : _pull,
                    icon: const Icon(Icons.cloud_download_outlined),
                    label: const Text('Pull'),
                    style: FilledButton.styleFrom(
                      backgroundColor: MxColors.indigoDeep,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: _busy || _backendUrl == null ? null : _push,
                    icon: const Icon(Icons.cloud_upload_outlined),
                    label: const Text('Push'),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: MxSpacing.xl),
            if (_status == 'success' || _lastSync != null) ...[
              _InfoRow(
                label: 'Última sync',
                value: _lastSync == null ? '—' : _fmtRel(_lastSync!),
                icon: Icons.schedule,
              ),
              if (_pushed > 0)
                _InfoRow(label: 'Enviadas', value: '$_pushed', icon: Icons.upload),
              if (_pulled > 0)
                _InfoRow(label: 'Recibidas', value: '$_pulled', icon: Icons.download),
              if (_conflicts > 0)
                _InfoRow(
                  label: 'Conflictos',
                  value: '$_conflicts (server más nuevo)',
                  icon: Icons.warning_amber,
                ),
            ],
            if (_backendUrl == null) ...[
              const SizedBox(height: MxSpacing.xl),
              EmptyState(
                icon: Icons.cloud_off_outlined,
                title: 'Sin backend configurado',
                subtitle: 'Configura la URL del backend en Ajustes → Sync.',
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _fmtRel(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'hace un momento';
    if (d.inMinutes < 60) return 'hace ${d.inMinutes} min';
    if (d.inHours < 24) return 'hace ${d.inHours} h';
    return 'hace ${d.inDays} d';
  }
}

class _StatusCard extends StatelessWidget {
  final String status;
  final String? error;
  final DateTime? lastSync;
  final String? backendUrl;
  const _StatusCard({
    required this.status,
    this.error,
    this.lastSync,
    this.backendUrl,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isError = status == 'error';
    final isSyncing = status == 'syncing';
    final isSuccess = status == 'success';
    final color = isError
        ? Colors.red
        : isSyncing
            ? MxColors.cyan
            : isSuccess
                ? MxColors.amber
                : theme.colorScheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.all(MxSpacing.lg),
      decoration: BoxDecoration(
        color: color.withOpacity(0.10),
        borderRadius: BorderRadius.circular(MxRadius.lg),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isSyncing
                    ? Icons.sync_rounded
                    : isError
                        ? Icons.error_outline
                        : isSuccess
                            ? Icons.cloud_done_outlined
                            : Icons.cloud_outlined,
                color: color,
                size: 28,
              ),
              const SizedBox(width: MxSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isSyncing
                          ? 'Sincronizando…'
                          : isError
                              ? 'Error de sync'
                              : isSuccess
                                  ? 'Sincronizado'
                                  : 'Listo para sincronizar',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700, color: color,
                      ),
                    ),
                    if (error != null) ...[
                      const SizedBox(height: 4),
                      Text(error!,
                        style: theme.textTheme.bodySmall?.copyWith(color: Colors.red)),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (backendUrl != null) ...[
            const SizedBox(height: 8),
            Text(backendUrl!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontFamily: 'monospace',
                fontSize: 11,
              )),
          ],
        ],
      ),
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
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: MxSpacing.xs),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 12),
          Expanded(child: Text(label)),
          Text(value, style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
          )),
        ],
      ),
    );
  }
}
