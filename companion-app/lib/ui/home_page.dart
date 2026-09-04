// HomePage: pantalla principal después del setup.
//
// v0.32: rediseñada para mostrar info diferenciada en cada sección
// (estado de vaults, próxima clase, update disponible, permisos, backend).
// Antes: misma info repetida en todas las tarjetas.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/plugin_release.dart';
import '../services/app_info.dart';
import '../services/calendar_service.dart';
import '../services/device_id.dart';
import '../services/permissions.dart';
import '../services/updater.dart';
import '../services/vault_detector.dart';
import 'activate_plugin_page.dart';
import 'install_page.dart';
import 'recording_page.dart';
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
  List<PermissionStatus> _permissions = [];
  AppInfo? _appInfo;
  String? _backendUrl;
  int _vaultsWithPlugin = 0;

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
      _appInfo = await AppInfo.load();
      _calendar = CalendarService();
      await _calendar!.load();
      if (_calendar!.enabled && await _calendar!.isPermissionGranted()) {
        _upcomingClass = await _calendar!.suggestCurrentEvent();
      }
      _vaults = await _vaultDetector.detectVaults();
      _vaultsWithPlugin = _vaults.where((v) => v.installedPluginVersion != null).length;
      _permissions = await PermissionsService.getAll();
      final prefs = await SharedPreferences.getInstance();
      _backendUrl = prefs.getString('mnexus.backend.url');
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
    final r = _updater.lastResult;
    final update = r?.update;
    if (update == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Busca actualizaciones primero')),
      );
      return;
    }
    final release = PluginRelease(
      latestVersion: update.latestVersion,
      minAppVersion: '1.5.0',
      releaseNotes: update.body,
      downloadUrl: '',
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

  Future<void> _openSettings() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsPage()));
    _load();
  }

  Future<void> _requestMissingPermissions() async {
    final results = await PermissionsService.requestAll();
    if (!mounted) return;
    final granted = results.where((p) => p.granted).length;
    final denied = results.where((p) => !p.granted).toList();
    setState(() => _permissions = results);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Permisos: $granted/${results.length} concedidos'),
        action: denied.isEmpty ? null : SnackBarAction(
          label: 'Ver',
          onPressed: () => _showPermissionsDialog(denied),
        ),
      ),
    );
  }

  void _showPermissionsDialog(List<PermissionStatus> denied) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Permisos pendientes'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView(
            shrinkWrap: true,
            children: denied.map((p) => ListTile(
              leading: Icon(p.permanentlyDenied ? Icons.lock : Icons.warning, color: Colors.orange),
              title: Text(p.displayName),
              subtitle: Text(p.description),
              trailing: p.permanentlyDenied
                  ? const Chip(label: Text('Ir a Settings'), backgroundColor: Colors.red)
                  : null,
            )).toList(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              if (denied.any((p) => p.permanentlyDenied)) {
                await PermissionsService.openSettings();
              } else {
                await PermissionsService.requestAll();
              }
              await _load();
            },
            child: const Text('Reintentar'),
          ),
        ],
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('M-NEXUS'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _forceCheck,
            tooltip: 'Buscar actualizaciones',
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
      floatingActionButton: _buildFab(),
    );
  }

  Widget _buildFab() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        FloatingActionButton.extended(
          heroTag: 'recording',
          onPressed: () async {
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const RecordingPage()),
            );
            _load();
          },
          icon: const Icon(Icons.mic),
          label: const Text('Grabar'),
          backgroundColor: Colors.red.shade400,
          foregroundColor: Colors.white,
        ),
        const SizedBox(height: 12),
        FloatingActionButton(
          heroTag: 'add-vault',
          onPressed: _showManualPathInput,
          tooltip: 'Añadir vault manualmente',
          child: const Icon(Icons.folder_open),
        ),
      ],
    );
  }

  Widget _buildBody() {
    final deniedPerms = _permissions.where((p) => !p.granted).toList();
    final hasUpdate = _updater.lastResult?.hasUpdate ?? false;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1) Stats cards (3 cards: device, vaults, backend)
          _buildStatsRow(),
          const SizedBox(height: 16),

          // 2) Update banner (condicional, arriba si existe)
          if (hasUpdate) ...[
            _buildUpdateBanner(),
            const SizedBox(height: 16),
          ],

          // 3) Próxima clase (con info rica si está)
          if (_upcomingClass != null) ...[
            _buildUpcomingClassCard(),
            const SizedBox(height: 16),
          ],

          // 4) Permisos pendientes (solo si hay)
          if (deniedPerms.isNotEmpty) ...[
            _buildPermissionsCard(deniedPerms),
            const SizedBox(height: 16),
          ],

          // 5) Activar plugin (solo si hay vaults sin plugin)
          if (_vaults.isNotEmpty && _vaultsWithPlugin < _vaults.length) ...[
            _buildActivateButton(),
            const SizedBox(height: 16),
          ],

          // 6) Lista de vaults
          _buildVaultsSection(),

          const SizedBox(height: 16),

          // 7) Backend card (siempre visible, info útil)
          _buildBackendCard(),

          // 8) Device ID card (solo al final, con copy button)
          if (_identity != null) ...[
            const SizedBox(height: 16),
            _buildDeviceCard(),
          ],

          const SizedBox(height: 80), // espacio para FAB
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    final hasUpdate = _updater.lastResult?.hasUpdate ?? false;
    return Row(
      children: [
        Expanded(child: _buildStatCard(
          icon: Icons.folder,
          label: 'Vaults',
          value: '${_vaults.length}',
          sub: '$_vaultsWithPlugin con plugin',
          color: Colors.blue,
        )),
        const SizedBox(width: 8),
        Expanded(child: _buildStatCard(
          icon: Icons.event,
          label: 'Próxima clase',
          value: _upcomingClass != null
              ? '${_upcomingClass!.start.hour.toString().padLeft(2, '0')}:${_upcomingClass!.start.minute.toString().padLeft(2, '0')}'
              : '—',
          sub: _upcomingClass?.title ?? 'Sin eventos',
          color: Colors.purple,
        )),
        const SizedBox(width: 8),
        Expanded(child: _buildStatCard(
          icon: hasUpdate ? Icons.update : Icons.verified,
          label: 'Update',
          value: hasUpdate ? '!' : 'OK',
          sub: hasUpdate
              ? 'v${_updater.lastResult!.update!.latestVersion}'
              : 'Al día',
          color: hasUpdate ? Colors.orange : Colors.green,
        )),
      ],
    );
  }

  Widget _buildStatCard({
    required IconData icon,
    required String label,
    required String value,
    required String sub,
    required Color color,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: color, size: 18),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(
              sub,
              style: const TextStyle(fontSize: 10, color: Colors.grey),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildUpcomingClassCard() {
    final e = _upcomingClass!;
    final now = DateTime.now();
    final minsUntil = e.start.difference(now).inMinutes;
    final isHappening = now.isAfter(e.start) && now.isBefore(e.end);
    return Card(
      color: isHappening ? Colors.green.shade50 : Theme.of(context).colorScheme.primaryContainer,
      child: ListTile(
        leading: Icon(
          isHappening ? Icons.event_available : Icons.event,
          size: 40,
          color: isHappening ? Colors.green : null,
        ),
        title: Text(
          e.title,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${e.start.hour.toString().padLeft(2, '0')}:${e.start.minute.toString().padLeft(2, '0')} - '
                '${e.end.hour.toString().padLeft(2, '0')}:${e.end.minute.toString().padLeft(2, '0')}'),
            if (e.location.isNotEmpty) Text('📍 ${e.location}'),
            Text(
              isHappening
                ? '🟢 EN CURSO (terminó hace ${-minsUntil}min, faltan ${e.end.difference(now).inMinutes}min)'
                : minsUntil > 60
                  ? 'En ${(minsUntil / 60).toStringAsFixed(1)}h'
                  : 'En ${minsUntil}min',
              style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic),
            ),
          ],
        ),
        isThreeLine: true,
        trailing: IconButton(
          icon: const Icon(Icons.mic, size: 28),
          tooltip: 'Grabar esta clase',
          onPressed: () async {
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const RecordingPage()),
            );
            _load();
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
    final missing = _vaults.length - _vaultsWithPlugin;
    return Card(
      color: Colors.amber.shade50,
      child: ListTile(
        leading: const Icon(Icons.bolt, color: Colors.amber, size: 32),
        title: Text('$missing vault(s) sin plugin'),
        subtitle: const Text('Ver pasos para activarlo en Obsidian'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _showActivateInstructions,
      ),
    );
  }

  Widget _buildPermissionsCard(List<PermissionStatus> denied) {
    return Card(
      color: Colors.orange.shade50,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shield, color: Colors.orange, size: 28),
                const SizedBox(width: 8),
                Text(
                  '${denied.length} permiso(s) pendiente(s)',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...denied.map((p) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Icon(
                    p.permanentlyDenied ? Icons.lock : Icons.warning,
                    size: 16,
                    color: p.permanentlyDenied ? Colors.red : Colors.orange,
                  ),
                  const SizedBox(width: 8),
                  Text(p.displayName, style: const TextStyle(fontSize: 13)),
                  if (p.permanentlyDenied)
                    const Padding(
                      padding: EdgeInsets.only(left: 8),
                      child: Text(
                        '(denegado permanentemente)',
                        style: TextStyle(fontSize: 11, color: Colors.red, fontStyle: FontStyle.italic),
                      ),
                    ),
                ],
              ),
            )),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _requestMissingPermissions,
                    icon: const Icon(Icons.check, size: 18),
                    label: const Text('Pedir permisos'),
                  ),
                ),
                if (denied.any((p) => p.permanentlyDenied)) ...[
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () async {
                      await PermissionsService.openSettings();
                    },
                    icon: const Icon(Icons.settings, size: 18),
                    label: const Text('Settings'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVaultsSection() {
    if (_error != null) {
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.folder_outlined),
            const SizedBox(width: 8),
            Text(
              'Tus vaults (${_vaults.length})',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_vaults.isEmpty)
          Card(
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
          )
        else
          ..._vaults.map(_buildVaultCard),
      ],
    );
  }

  Widget _buildVaultCard(VaultInfo vault) {
    final hasPlugin = vault.installedPluginVersion != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  hasPlugin ? Icons.check_circle : Icons.folder_outlined,
                  color: hasPlugin ? Colors.green : Colors.grey,
                  size: 28,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        vault.name,
                        style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 16),
                      ),
                      Text(
                        vault.path,
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.download),
                  tooltip: hasPlugin ? 'Actualizar plugin' : 'Instalar plugin',
                  onPressed: () => _installPlugin(vault),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                _buildChip(
                  icon: vault.hasObsidianFolder ? Icons.folder_open : Icons.folder_off,
                  label: vault.hasObsidianFolder ? '.obsidian' : 'No es vault',
                  color: vault.hasObsidianFolder ? Colors.blue : Colors.grey,
                ),
                _buildChip(
                  icon: hasPlugin ? Icons.extension : Icons.extension_off,
                  label: hasPlugin ? 'v${vault.installedPluginVersion}' : 'Sin plugin',
                  color: hasPlugin ? Colors.green : Colors.orange,
                ),
                if (vault.hasObsidianFolder)
                  _buildChip(
                    icon: Icons.book,
                    label: '${vault.name}',
                    color: Colors.purple,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChip({
    required IconData icon,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: color)),
        ],
      ),
    );
  }

  Widget _buildBackendCard() {
    final url = _backendUrl;
    return Card(
      child: ListTile(
        leading: Icon(
          url != null ? Icons.cloud_done : Icons.cloud_off,
          color: url != null ? Colors.green : Colors.grey,
        ),
        title: Text(url ?? 'Sin backend configurado'),
        subtitle: Text(url != null
            ? 'El backend está accesible para sync FSRS'
            : 'Configura el backend en Settings para sincronizar'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _openSettings,
      ),
    );
  }

  Widget _buildDeviceCard() {
    final id = _identity!;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.phone_android, size: 18),
                const SizedBox(width: 8),
                Text(id.displayName ?? id.model ?? 'Device',
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                const Spacer(),
                Text('v${_appInfo?.version ?? "?"}',
                    style: const TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    'ID: ${id.id}',
                    style: const TextStyle(fontSize: 11, color: Colors.grey, fontFamily: 'monospace'),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy, size: 14),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('ID copiado (largo presionado para seleccionar)')),
                    );
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
