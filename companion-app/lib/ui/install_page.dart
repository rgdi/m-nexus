// InstallPage: muestra el progreso de descarga + instalación.

import 'package:flutter/material.dart';
import '../models/plugin_release.dart';
import '../services/plugin_installer.dart';
import '../services/vault_detector.dart';

class InstallPage extends StatefulWidget {
  final VaultInfo vault;
  final PluginRelease release;
  final String? installedVersion;
  final bool needsUpdate;

  const InstallPage({
    super.key,
    required this.vault,
    required this.release,
    required this.installedVersion,
    required this.needsUpdate,
  });

  @override
  State<InstallPage> createState() => _InstallPageState();
}

class _InstallPageState extends State<InstallPage> {
  final _installer = PluginInstaller();
  double _progress = 0;
  String _phase = 'idle';
  InstallResult? _result;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.needsUpdate) {
      _run();
    }
  }

  Future<void> _run() async {
    setState(() {
      _phase = 'downloading';
      _progress = 0;
      _error = null;
    });
    try {
      final bytes = await _installer.downloadRelease(
        widget.release,
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
      setState(() {
        _phase = 'installing';
        _progress = 1.0;
      });
      final result = await _installer.installTo(widget.vault.path, bytes);
      if (!mounted) return;
      setState(() {
        _phase = result.status == InstallStatus.success ? 'success' : 'error';
        _result = result;
        if (result.status == InstallStatus.error) _error = result.errorMessage;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = 'error';
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.needsUpdate ? 'Actualizar M-NEXUS' : 'M-NEXUS actualizado'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Vault: ${widget.vault.name}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(widget.vault.path, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                    const Divider(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Versión instalada:'),
                        Text(widget.installedVersion ?? '(ninguna)'),
                      ],
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Última versión:'),
                        Text('v${widget.release.latestVersion}'),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (widget.needsUpdate) _buildProgress(),
            if (_phase == 'success' && _result != null) _buildResult(_result!),
            if (_phase == 'error' && _error != null) _buildError(_error!),
            const Spacer(),
            if (_phase == 'success')
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Hecho'),
              )
            else if (_phase == 'error')
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: _run,
                      child: const Text('Reintentar'),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgress() {
    final labels = {
      'downloading': 'Descargando plugin…',
      'installing': 'Extrayendo y creando carpetas…',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(labels[_phase] ?? _phase, style: const TextStyle(fontSize: 14)),
        const SizedBox(height: 8),
        LinearProgressIndicator(value: _progress == 1.0 && _phase == 'installing' ? null : _progress),
        const SizedBox(height: 8),
        Text('${(_progress * 100).toStringAsFixed(0)}%', style: const TextStyle(fontSize: 12, color: Colors.grey)),
      ],
    );
  }

  Widget _buildResult(InstallResult r) {
    return Card(
      color: Colors.green.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.check_circle, color: Colors.green.shade700),
                const SizedBox(width: 8),
                Text('M-NEXUS v${r.installedVersion ?? "?"} instalado',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('${r.installedFiles.length} archivos instalados', style: const TextStyle(fontSize: 12)),
            Text('${r.createdFolders.length} carpetas creadas', style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 12),
            // v0.36: activación automática
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: r.activated
                    ? Colors.green.shade100
                    : (r.alreadyEnabled ? Colors.blue.shade50 : Colors.orange.shade50),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                children: [
                  Icon(
                    r.activated
                        ? Icons.bolt
                        : (r.alreadyEnabled ? Icons.check : Icons.warning_amber),
                    color: r.activated
                        ? Colors.green.shade700
                        : (r.alreadyEnabled ? Colors.blue : Colors.orange),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      r.activated
                          ? '✅ Activado automáticamente en community-plugins.json'
                          : (r.alreadyEnabled
                              ? 'Ya estaba habilitado en community-plugins.json'
                              : '⚠ No se pudo activar automáticamente'),
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
            if (r.communityPluginsPath != null) ...[
              const SizedBox(height: 4),
              Text(r.communityPluginsPath!,
                style: const TextStyle(fontSize: 10, fontFamily: 'monospace', color: Colors.grey),
              ),
            ],
            const SizedBox(height: 12),
            const Text('Siguiente paso:',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
            const Text(
              '1. Cierra Obsidian si está abierto\n'
              '2. Vuelve a abrir Obsidian\n'
              '3. El plugin M-NEXUS aparecerá activo en Settings → Community plugins',
              style: TextStyle(fontSize: 11),
            ),
            const SizedBox(height: 8),
            const Text('Carpetas internas:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ...PluginInstaller.requiredFolders.map((f) => Text('  • $f', style: const TextStyle(fontSize: 11, fontFamily: 'monospace'))),
          ],
        ),
      ),
    );
  }

  Widget _buildError(String e) {
    return Card(
      color: Colors.red.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.error, color: Colors.red.shade700),
            const SizedBox(width: 8),
            Expanded(child: Text(e, style: const TextStyle(color: Colors.red))),
          ],
        ),
      ),
    );
  }
}
