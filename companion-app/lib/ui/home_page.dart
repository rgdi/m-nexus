// HomePage: pantalla principal después del setup.
//
// Integra:
// - Detección de vaults de Obsidian
// - Botón "Activar plugin en Obsidian" (instrucciones)
// - Diálogo de instalación del plugin (descarga ZIP + extrae)
// - Update dialog (auto-update)
// - FAB para forzar check de updates
// - Botón de grabación (futuro, con calendar)
//
// v0.31: integracion con device identity, backend client, calendar service.

import 'package:flutter/material.dart';
import '../models/plugin_release.dart';
import '../services/calendar_service.dart';
import '../services/device_id.dart';
import '../services/updater.dart';
import '../services/vault_detector.dart';
import 'activate_plugin_page.dart';
import 'install_page.dart';
import 'settings_page.dart';
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
  DeviceIdentity? _identity;
  CalendarService? _calendar;
  CalendarEvent? _upcomingClass;

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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _identity = await DeviceIdentity.load();
      _calendar = CalendarService();
      await _calendar!.load();
      if (_calendar!.enabled && await _calendar!.isPermissionGranted()) {
        _upcomingClass = await _calendar!.suggestCurrentEvent();
      }
      _vaults = await _vaultDetector.detectVaults();
      setState(() {
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _onUpdaterChange() {
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.hasUpdate ?? false) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('M-NEXUS v${r!.update!.latestVersion} disponible (tienes v${r.installedVersion})'),
          action: SnackBarAction(label: 'Ver', onPressed: _showUpdateDialog),
          duration: const Duration(seconds: 10),
        ),
      );
    }
    setState(() {});
  }

  Future<void> _showUpdateDialog() async {
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.update == null || !r!.hasUpdate) return;
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
      const SnackBar(content: Text('Buscando actualizaciones...'), duration: Duration(seconds: 2)),
    );
    await _updater.check(force: true);
    if (!mounted) return;
    final r = _updater.lastResult;
    if (r?.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: ${r!.error}')));
    } else if (!r!.hasUpdate) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estás al día')));
    }
  }

  Future<void> _installPlugin(VaultInfo vault) async {
    // 1. Descargar la última versión
    final r = _updater.lastResult;
    final update = r?.update;
    if (update == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Busca actualizaciones primero')),
      );
      return;
    }
    // Por ahora usamos el plugin_release del companion (versión del plugin, no del companion)
    final release = PluginRelease(
      latestVersion: update.latestVersion,
      minAppVersion: '1.5.0',
      releaseNotes: update.body,
      downloadUrl: '', // se descarga desde el backend
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

  Future<void> _showActivateInstructions() async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const ActivatePluginPage()),
    );
    if (result == true && mounted) {
      _load();
    }
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
              if (!mounted) return;
              setState(() {
                _vaults = [
                  VaultInfo(
                    path: path,
                    name: path.split('/').last,
                    hasObsidianFolder: true,
                    installedPluginVersion: null,
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

  Future<void> _openSettings() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsPage()));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('M-NEXUS'),
        actions: [
          if (_identity != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Center(
                child: Chip(
                  avatar: const Icon(Icons.phone_android, size: 14),
                  label: Text(
                    _identity!.displayName ?? _identity!.model ?? 'device',
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: _openSettings,
            tooltip: 'Configuración',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _buildBody(),
      floatingActionButton: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          FloatingActionButton.small(
            heroTag: 'refresh',
            onPressed: _forceCheck,
            tooltip: 'Buscar actualizaciones',
            child: const Icon(Icons.refresh),
          ),
          const SizedBox(height: 12),
          FloatingActionButton.extended(
            heroTag: 'add-vault',
            onPressed: _showManualPathInput,
            icon: const Icon(Icons.folder_open),
            label: const Text('Vault'),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_upcomingClass != null) _buildUpcomingClassCard(),
          if (_updater.lastResult?.hasUpdate ?? false) _buildUpdateBanner(),
          _buildActivateButton(),
          const SizedBox(height: 16),
          Text('Tus vaults', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_error != null) _buildError(),
          if (_vaults.isEmpty) _buildEmpty(),
          ..._vaults.map(_buildVaultCard),
        ],
      ),
    );
  }

  Widget _buildUpcomingClassCard() {
    final e = _upcomingClass!;
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: ListTile(
        leading: const Icon(Icons.event, size: 32),
        title: Text(e.title),
        subtitle: Text(
          '${e.start.hour.toString().padLeft(2, '0')}:${e.start.minute.toString().padLeft(2, '0')} - '
          '${e.end.hour.toString().padLeft(2, '0')}:${e.end.minute.toString().padLeft(2, '0')}'
          '${e.location.isNotEmpty ? " • ${e.location}" : ""}',
        ),
        trailing: IconButton(
          icon: const Icon(Icons.mic),
          onPressed: () {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Próximamente: grabar esta clase')),
            );
          },
        ),
      ),
    );
  }

  Widget _buildUpdateBanner() {
    final r = _updater.lastResult!;
    return Card(
      color: Theme.of(context).colorScheme.tertiaryContainer,
      child: ListTile(
        leading: const Icon(Icons.system_update, size: 32),
        title: Text('M-NEXUS v${r.update!.latestVersion} disponible'),
        subtitle: Text('Tienes v${r.installedVersion}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _showUpdateDialog,
      ),
    );
  }

  Widget _buildActivateButton() {
    return Card(
      color: Colors.amber.shade50,
      child: ListTile(
        leading: const Icon(Icons.bolt, color: Colors.amber, size: 32),
        title: const Text('¿Plugin activado en Obsidian?'),
        subtitle: const Text('Ver pasos para activarlo'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _showActivateInstructions,
      ),
    );
  }

  Widget _buildError() {
    return Card(
      color: Colors.red.shade50,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.error, color: Colors.red),
                SizedBox(width: 8),
                Text('Error al detectar vaults'),
              ],
            ),
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
            TextButton.icon(
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.folder_open, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              'No se detectaron vaults',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            const Text(
              'Asegúrate de tener Obsidian instalado y al menos un vault creado.\n'
              'También puedes añadir una ruta manualmente.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVaultCard(VaultInfo vault) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(
          vault.hasObsidianFolder ? Icons.check_circle : Icons.folder,
          color: vault.hasObsidianFolder ? Colors.green : null,
          size: 32,
        ),
        title: Text(vault.name),
        subtitle: Text(
          vault.installedPluginVersion != null
              ? '${vault.path}\nPlugin v${vault.installedPluginVersion} instalado'
              : vault.path,
        ),
        isThreeLine: vault.installedPluginVersion != null,
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.download),
              tooltip: 'Instalar/actualizar plugin',
              onPressed: () => _installPlugin(vault),
            ),
          ],
        ),
      ),
    );
  }
}
