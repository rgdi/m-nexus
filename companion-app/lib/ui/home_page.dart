// HomePage: detecta vaults, muestra estado, permite instalar/actualizar.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/plugin_release.dart';
import '../services/vault_detector.dart';
import '../services/updater.dart';
import 'install_page.dart';
import 'update_dialog.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<VaultInfo> _vaults = [];
  bool _loading = true;
  String? _error;
  final _vaultDetector = VaultDetector();
  final _updater = Updater(
    config: UpdaterConfig(
      checkInterval: const Duration(hours: 6),
    ),
  );

  @override
  void initState() {
    super.initState();
    _load();
    _updater.startPeriodicChecks();
    _updater.addListener(_onUpdaterChange);
  }

  @override
  void dispose() {
    _updater.stopPeriodicChecks();
    _updater.removeListener(_onUpdaterChange);
    _updater.dispose();
    super.dispose();
  }

  void _onUpdaterChange() {
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.hasUpdate ?? false) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('M-NEXUS v${r!.update!.latestVersion} disponible (tienes v${r.installedVersion})'),
          action: SnackBarAction(
            label: 'Ver',
            onPressed: _showUpdateDialog,
          ),
          duration: const Duration(seconds: 10),
        ),
      );
    }
    setState(() {});
  }

  Future<void> _showUpdateDialog() async {
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.update == null || !r!.hasUpdate) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay actualizaciones disponibles')),
      );
      return;
    }
    await showDialog(
      context: context,
      builder: (_) => UpdateDialog(
        update: r.update!,
        installedVersion: r.installedVersion,
        updater: _updater,
        onDismiss: () => Navigator.of(context).pop(),
      ),
    );
  }

  Future<void> _forceCheck() async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Buscando actualizaciones...'),
        duration: Duration(seconds: 2),
      ),
    );
    await _updater.check(force: true);
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al buscar updates: ${r!.error}')),
      );
    } else if (!r!.hasUpdate) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay actualizaciones disponibles')),
      );
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final vaults = await _vaultDetector.detectVaults();
      setState(() {
        _vaults = vaults;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _checkAndInstall(VaultInfo vault) async {
    // Mantenido para compatibilidad: navega a InstallPage con info del plugin.
    final r = _updater.lastResult;
    final release = PluginRelease(
      latestVersion: r?.update?.latestVersion ?? '0.0.0',
      minAppVersion: '1.5.0',
      releaseNotes: r?.update?.body ?? '',
      downloadUrl: r?.update?.apkDownloadUrl ?? '',
      checksumSha256: '',
    );
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => InstallPage(
          vault: vault,
          release: release,
          installedVersion: vault.installedPluginVersion,
          needsUpdate: r?.hasUpdate ?? false,
        ),
      ),
    );
  }

  Future<void> _showManualPathInput() async {
    final controller = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ruta del vault'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: '/storage/emulated/0/Documents/MiVault',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () async {
              final path = controller.text.trim();
              if (path.isEmpty) return;
              Navigator.pop(ctx);
              // Resolve the version first, then call setState.
              final installedVersion = await _updater.loadInstalledVersion();
              if (!mounted) return;
              setState(() {
                _vaults = [
                  VaultInfo(
                    path: path,
                    name: path.split('/').last,
                    hasObsidianFolder: true,
                    installedPluginVersion: installedVersion,
                  ),
                  ..._vaults,
                ];
              });
            },
            child: const Text('Añadir'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('M-NEXUS Installer'),
        actions: [
          if (_updater.isChecking)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                ),
              ),
            )
          else if (_updater.lastResult?.hasUpdate ?? false)
            IconButton(
              icon: Badge(
                label: Text('!'),
                child: const Icon(Icons.system_update),
              ),
              tooltip: 'Actualización disponible',
              onPressed: _showUpdateDialog,
            ),
        ],
      ),
      body: _buildBody(),
      floatingActionButton: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          FloatingActionButton.small(
            heroTag: 'update-check',
            onPressed: _forceCheck,
            tooltip: 'Buscar actualizaciones',
            child: const Icon(Icons.refresh),
          ),
          const SizedBox(height: 12),
          FloatingActionButton.extended(
            heroTag: 'vault-manual',
            onPressed: _showManualPathInput,
            icon: const Icon(Icons.folder_open),
            label: const Text('Vault manual'),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return _buildError();
    if (_vaults.isEmpty) return _buildEmpty();
    return ListView.builder(
      itemCount: _vaults.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) return _buildUpdateBanner();
        final vault = _vaults[index - 1];
        return Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: ListTile(
            leading: Icon(
              vault.hasObsidianFolder ? Icons.check_circle : Icons.folder,
              color: vault.hasObsidianFolder ? Colors.green : null,
            ),
            title: Text(vault.name),
            subtitle: Text(vault.path),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _checkAndInstall(vault),
          ),
        );
      },
    );
  }

  Widget _buildUpdateBanner() {
    final r = _updater.lastResult;
    if (r == null || !r.hasUpdate) return const SizedBox.shrink();
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      margin: const EdgeInsets.all(12),
      child: ListTile(
        leading: const Icon(Icons.system_update),
        title: Text('v${r.update!.latestVersion} disponible'),
        subtitle: Text('Tienes v${r.installedVersion}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _showUpdateDialog,
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Colors.red),
            const SizedBox(height: 16),
            Text('Error: $_error', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.folder_open, size: 64),
            const SizedBox(height: 16),
            const Text(
              'No se detectaron vaults de Obsidian.\n\n'
              'Usa "Vault manual" para añadir uno, o abre Obsidian '
              'y crea un vault primero.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
