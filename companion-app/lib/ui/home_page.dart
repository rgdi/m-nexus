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
    config: const UpdaterConfig(
      checkInterval: Duration(hours: 6),
      autoDownload: false,
    ),
  );
  // Endpoint de releases. En producción, URL al servidor M-NEXUS.
  static const _releaseInfoUrl = 'https://raw.githubusercontent.com/rodrigo/m-nexus/main/release-info.json';

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
    final prefs = await SharedPreferences.getInstance();
    final customUrl = prefs.getString('release_url') ?? _releaseInfoUrl;
    try {
      await _updater.setVault(vault.path);
      final result = await _updater.check(releaseUrl: customUrl);
      if (!mounted) return;
      // Convertir result a release info (mínimo) para InstallPage
      final release = PluginRelease(
        latestVersion: result.latestVersion ?? '0.0.0',
        minAppVersion: '1.5.0',
        releaseNotes: result.changelog ?? '',
        downloadUrl: result.downloadUrl ?? '',
        checksumSha256: '',
      );
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => InstallPage(
            vault: vault,
            release: release,
            installedVersion: result.installedVersion,
            needsUpdate: result.hasUpdate,
          ),
        ),
      ).then((_) => _load());
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('M-NEXUS Installer'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
            tooltip: 'Reescanear',
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: _showSettings,
            tooltip: 'Ajustes',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(error: _error!, onRetry: _load)
              : _vaults.isEmpty
                  ? const _EmptyView()
                  : _VaultList(
                      vaults: _vaults,
                      onTap: _checkAndInstall,
                    ),
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
              // setState callback is not async — resolve the version first, then call setState.
              final installedVersion = await _updater.readInstalledVersion(path);
              if (!mounted) return;
              setState(() {
                _vaults = [
                  VaultInfo(
                    path: path,
                    name: path.split('/').last,
                    hasObsidianFolder: true,
                    installedPluginVersion: installedVersion,
                  ),
                ];
              });
            },
            child: const Text('Usar'),
          ),
        ],
      ),
    );
  }

  Future<void> _showSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final controller = TextEditingController(text: prefs.getString('release_url') ?? _releaseInfoUrl);
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Endpoint de releases'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'URL del release-info.json',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () async {
              await prefs.setString('release_url', controller.text);
              if (!mounted) return;
              Navigator.pop(ctx);
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
  }
}

class _VaultList extends StatelessWidget {
  final List<VaultInfo> vaults;
  final Future<void> Function(VaultInfo) onTap;
  const _VaultList({required this.vaults, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: vaults.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (ctx, i) {
        final v = vaults[i];
        final version = v.installedPluginVersion;
        return Card(
          child: ListTile(
            leading: CircleAvatar(
              child: Text(v.name.isNotEmpty ? v.name[0].toUpperCase() : '?'),
            ),
            title: Text(v.name),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(v.path, style: const TextStyle(fontSize: 12)),
                if (version != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Chip(
                      label: Text('M-NEXUS v$version'),
                      visualDensity: VisualDensity.compact,
                    ),
                  )
                else
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('Sin M-NEXUS instalado', style: TextStyle(fontStyle: FontStyle.italic)),
                  ),
              ],
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onTap(v),
          ),
        );
      },
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.folder_off, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              'No se detectaron vaults de Obsidian',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Asegúrate de que Obsidian tiene al menos un vault creado, o introduce la ruta manualmente con el botón inferior.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.help_outline),
              label: const Text('Ayuda'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Colors.red),
            const SizedBox(height: 16),
            Text(error, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}
