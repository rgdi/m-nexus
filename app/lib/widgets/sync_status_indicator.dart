// sync_status_indicator.dart: indicador de conexion backend con tap para test.
//
// v0.49.16: muestra estado (verde=conectado, naranja=probando, rojo=offline),
// al hacer tap testea la conexion y muestra detalles.

import 'package:flutter/material.dart';
import '../../services/backend_client.dart';
import '../../services/settings_service.dart';
import '../../services/logger.dart';

class SyncStatusIndicator extends StatefulWidget {
  final bool compact; // solo el dot, sin texto
  const SyncStatusIndicator({super.key, this.compact = false});

  @override
  State<SyncStatusIndicator> createState() => _SyncStatusIndicatorState();
}

class _SyncStatusIndicatorState extends State<SyncStatusIndicator> {
  String? _status; // 'online' | 'offline' | 'testing' | 'no-backend'
  String? _detail;
  DateTime? _lastCheck;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    final url = SettingsService.instance.current.backendUrl;
    if (url == null || url.isEmpty) {
      if (!mounted) return;
      setState(() {
        _status = 'no-backend';
        _detail = 'Sin backend configurado';
        _lastCheck = DateTime.now();
      });
      return;
    }
    setState(() {
      _status = 'testing';
      _detail = 'Probando...';
    });
    final res = await BackendClient.testConnection(url);
    if (!mounted) return;
    setState(() {
      _status = res.isReachable ? 'online' : 'offline';
      _detail = res.isReachable
        ? 'Conectado · ${res.latency.inMilliseconds}ms${res.version != null ? " · v${res.version}" : ""}'
        : (res.error ?? 'Sin conexion');
      _lastCheck = DateTime.now();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = switch (_status) {
      'online' => Colors.green,
      'offline' => theme.colorScheme.error,
      'testing' => Colors.orange,
      'no-backend' => theme.colorScheme.onSurfaceVariant,
      _ => theme.colorScheme.onSurfaceVariant,
    };
    final icon = switch (_status) {
      'online' => Icons.cloud_done_rounded,
      'offline' => Icons.cloud_off_rounded,
      'testing' => Icons.sync_rounded,
      'no-backend' => Icons.cloud_queue_rounded,
      _ => Icons.cloud_queue_rounded,
    };

    if (widget.compact) {
      return InkWell(
        onTap: _onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, color: color, size: 20),
        ),
      );
    }

    return InkWell(
      onTap: _onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 16),
            const SizedBox(width: 4),
            Text(
              _status == 'online' ? 'Sync' : (_status == 'offline' ? 'Offline' : 'Sync...'),
              style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
            ),
            if (_lastCheck != null) ...[
              const SizedBox(width: 6),
              Text(
                _formatAgo(_lastCheck!),
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 10),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatAgo(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inSeconds < 60) return 'ahora';
    if (d.inMinutes < 60) return 'hace ${d.inMinutes}m';
    return 'hace ${d.inHours}h';
  }

  void _onTap() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => _buildSheet(ctx),
    );
    _check();
  }

  Widget _buildSheet(BuildContext ctx) {
    final theme = Theme.of(ctx);
    final color = switch (_status) {
      'online' => Colors.green,
      'offline' => theme.colorScheme.error,
      'testing' => Colors.orange,
      'no-backend' => theme.colorScheme.onSurfaceVariant,
      _ => theme.colorScheme.onSurfaceVariant,
    };
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.sync_rounded, color: color),
                const SizedBox(width: 8),
                Text('Estado de sincronización',
                  style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 16),
            _statusRow(theme, 'Estado', _statusLabel()),
            if (_detail != null) _statusRow(theme, 'Detalle', _detail!),
            if (_lastCheck != null) _statusRow(theme, 'Última prueba', _lastCheck!.toIso8601String()),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    icon: const Icon(Icons.refresh),
                    label: const Text('Probar ahora'),
                    onPressed: () {
                      Navigator.pop(ctx);
                      _check();
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusRow(ThemeData theme, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            )),
          ),
          Expanded(
            child: Text(value, style: theme.textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }

  String _statusLabel() {
    switch (_status) {
      case 'online': return 'Conectado';
      case 'offline': return 'Sin conexion';
      case 'testing': return 'Probando...';
      case 'no-backend': return 'Sin backend configurado';
      default: return 'Desconocido';
    }
  }
}
