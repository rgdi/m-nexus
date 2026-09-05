// HomePage: pantalla principal después del setup.
//
// v0.34:
//   - Calendar selector (escoger calendario a usar)
//   - Lista de próximos eventos con tap-to-open
//   - Mejor contraste / colores (eye-friendly)
//   - Sync status de grabaciones (badge en AppBar)
//   - Vault detection mejorada (con SAF picker)
//   - In-app updates con mejor UX
//   - Stats cards rediseñadas (gradientes, mejor jerarquía)

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/plugin_release.dart';
import '../services/app_info.dart';
import '../services/calendar_service.dart';
import '../services/device_id.dart';
import '../services/permissions.dart';
import '../services/sync_queue.dart';
import '../services/updater.dart';
import '../services/vault_detector.dart';
import 'activate_plugin_page.dart';
import 'help_page.dart';
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
  DeviceIdentity? _identity;
  CalendarService? _calendar;
  CalendarEvent? _upcomingClass;
  List<CalendarEvent> _upcomingEvents = [];
  List<CalendarInfo> _availableCalendars = [];
  CalendarInfo? _selectedCalendarInfo;
  int? _selectedCalendarId;
  List<PermissionStatus> _permissions = [];
  AppInfo? _appInfo;
  String? _backendUrl;
  int _vaultsWithPlugin = 0;
  int _pendingRecordings = 0;
  String? _lastNotifiedUpdateVersion;

  final _vaultDetector = VaultDetector();
  final _updater = Updater(
    config: UpdaterConfig(
      checkInterval: const Duration(hours: 6),
    ),
  );
  final _syncQueue = SyncQueue();

  @override
  void initState() {
    super.initState();
    _load();
    _updater.startPeriodicChecks();
    _updater.addListener(_onUpdaterChange);
    _syncQueue.stream.listen((_) {
      if (mounted) _updatePendingCount();
    });
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
    });
    try {
      _identity = await DeviceIdentity.load();
      _appInfo = await AppInfo.load();
      _calendar = CalendarService();
      await _calendar!.load();
      if (_calendar!.enabled && await _calendar!.isPermissionGranted()) {
        _availableCalendars = await _calendar!.listCalendars();
        _selectedCalendarId = _calendar!.selectedCalendarId;
        // Si no hay selección, usar el primero
        if (_selectedCalendarId == null && _availableCalendars.isNotEmpty) {
          _selectedCalendarId = _availableCalendars.first.id;
          await _calendar!.setSelectedCalendar(_selectedCalendarId);
        }
        // v0.37: obtener info del calendario activo (para mostrar en UI)
        _selectedCalendarInfo = await _calendar!.getSelectedCalendarInfo();
        _upcomingClass = await _calendar!.suggestCurrentEvent();
        _upcomingEvents = await _calendar!.listUpcoming(limit: 5);
      }
      _vaults = await _vaultDetector.detectVaults();
      _vaultsWithPlugin = _vaults.where((v) => v.installedPluginVersion != null).length;
      _permissions = await PermissionsService.getAll();
      final prefs = await SharedPreferences.getInstance();
      _backendUrl = prefs.getString('mnexus.backend.url');
      await _updatePendingCount();
      setState(() {
        _loading = false;
      });
    } catch (e) {
      setState(() {
        debugPrint('HomePage load error: $e');
        _loading = false;
      });
    }
  }

  Future<void> _updatePendingCount() async {
    final pending = await _syncQueue.getPending();
    if (mounted) {
      setState(() => _pendingRecordings = pending.length);
    }
  }

  void _onUpdaterChange() {
    if (!mounted) return;
    final r = _updater.lastResult;
    // Solo notificar UNA VEZ por versión (no en cada notifyListeners)
    if (r?.hasUpdate ?? false) {
      final v = r!.update!.latestVersion;
      if (_lastNotifiedUpdateVersion != v) {
        _lastNotifiedUpdateVersion = v;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('M-NEXUS v$v disponible (tienes v${r.installedVersion})'),
            action: SnackBarAction(label: 'Ver', onPressed: _showUpdateDialog),
            duration: const Duration(seconds: 10),
          ),
        );
      }
    } else {
      _lastNotifiedUpdateVersion = null;
    }
    setState(() {});
  }

  // ... (el resto de métodos se mantienen)

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

  /// v0.35: instala o actualiza el plugin en el vault seleccionado.
  /// Funciona tanto si hay update detectado como si no (busca el último release).
  Future<void> _installPlugin(VaultInfo vault) async {
    if (!mounted) return;
    // Mostrar loading
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('Buscando última versión del plugin...'),
          ],
        ),
      ),
    );
    PluginRelease? release;
    String? err;
    try {
      release = await _fetchPluginRelease();
    } catch (e) {
      err = e.toString();
    }
    if (!mounted) return;
    Navigator.of(context).pop();  // cerrar loading
    if (release == null) {
      _showInfo('Error: ${err ?? "No se pudo encontrar el release"}', error: true);
      return;
    }
    // Navegar a InstallPage
    final installedVer = vault.installedPluginVersion;
    final hasUpdate = installedVer == null || _isNewer(release.latestVersion, installedVer);
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => InstallPage(
          vault: vault,
          release: release!,
          installedVersion: installedVer,
          needsUpdate: hasUpdate,
        ),
      ),
    );
  }

  /// Compara versiones: true si a > b.
  bool _isNewer(String a, String b) {
    String norm(String v) => v.replaceFirst(RegExp(r'^v'), '').split('-').first.split('+').first;
    final pa = norm(a).split('.').map(int.tryParse).toList();
    final pb = norm(b).split('.').map(int.tryParse).toList();
    for (int i = 0; i < 3; i++) {
      final va = i < pa.length ? (pa[i] ?? 0) : 0;
      final vb = i < pb.length ? (pb[i] ?? 0) : 0;
      if (va > vb) return true;
      if (va < vb) return false;
    }
    return false;
  }

  Future<PluginRelease> _fetchPluginRelease() async {
    final response = await http.get(Uri.parse(
      'https://api.github.com/repos/rgdi/m-nexus/releases/latest',
    ));
    if (response.statusCode != 200) {
      throw Exception('GitHub release no disponible (HTTP ${response.statusCode})');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final tagName = json['tag_name'] as String? ?? 'v0.0.0';
    final version = tagName.replaceFirst('v', '');
    final body = json['body'] as String? ?? '';
    final assets = (json['assets'] as List?) ?? [];
    String downloadUrl = '';
    for (final a in assets.cast<Map<String, dynamic>>()) {
      final name = a['name'] as String? ?? '';
      if (name.contains('plugin') && name.endsWith('.zip')) {
        downloadUrl = a['browser_download_url'] as String? ?? '';
        break;
      }
    }
    if (downloadUrl.isEmpty) {
      throw Exception("No se encontró el asset del plugin en el release $tagName");
    }
    return PluginRelease(
      latestVersion: version,
      minAppVersion: '1.5.0',
      releaseNotes: body,
      downloadUrl: downloadUrl,
      checksumSha256: '',
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

  void _showPermissionsDialog(List<PermissionStatus> denied) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Permisos pendientes'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView(
            shrinkWrap: true,
            children: denied.map((p) {
              // Si es manage_storage y no está concedido, ofrecer la pantalla especial
              final isManageStorage = p.name == 'manage_storage';
              return ListTile(
                leading: Icon(
                  p.permanentlyDenied ? Icons.lock : Icons.warning,
                  color: Colors.orange,
                ),
                title: Text(p.displayName),
                subtitle: Text(p.description),
                trailing: p.permanentlyDenied
                    ? const Chip(label: Text('Ir a Settings'), backgroundColor: Colors.red)
                    : isManageStorage
                        ? const Chip(label: Text('Especial'))
                        : null,
              );
            }).toList(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              // Si hay manage_storage denegado, abrir pantalla especial
              if (denied.any((p) => p.name == 'manage_storage' && !p.granted)) {
                await PermissionsService.openManageStorageSettings();
              } else if (denied.any((p) => p.permanentlyDenied)) {
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

  /// v0.35: selector de calendario (escoge cuál usar).
  /// Si no hay permiso, lo pide. Si no hay calendarios, muestra mensaje.
  Future<void> _showCalendarSelector() async {
    if (_calendar == null) return;
    // Asegurar que tenemos el permiso
    if (!await _calendar!.isPermissionGranted()) {
      final ok = await _calendar!.requestPermission();
      if (!ok) {
        if (!mounted) return;
        _showInfo('Concede el permiso de Calendar para escoger uno');
        return;
      }
    }
    final cals = await _calendar!.listCalendars();
    if (!mounted) return;
    if (cals.isEmpty) {
      _showInfo('No se encontraron calendarios en el dispositivo');
      return;
    }
    final initialId = _selectedCalendarId ?? cals.first.id;
    final selected = await showDialog<int>(
      context: context,
      builder: (ctx) {
        int current = initialId;
        return StatefulBuilder(
          builder: (ctx2, setLocal) => SimpleDialog(
            title: Text('${cals.length} calendarios'),
            children: [
              for (final c in cals)
                RadioListTile<int>(
                  value: c.id,
                  groupValue: current,
                  onChanged: (v) {
                    if (v != null) {
                      current = v;
                      setLocal(() {});
                    }
                  },
                  title: Text(c.name,
                    style: TextStyle(
                      fontWeight: c.id == current ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  subtitle: Text(c.account, style: const TextStyle(fontSize: 11)),
                  secondary: CircleAvatar(
                    backgroundColor: Color(c.color == 0 ? 0xFF2563EB : c.color),
                    radius: 14,
                    child: Text(
                      c.name.isNotEmpty ? c.name[0].toUpperCase() : '?',
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, current),
                      child: const Text('Seleccionar'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
    if (selected != null) {
      await _calendar!.setSelectedCalendar(selected);
      await _load();
      if (!mounted) return;
      _showInfo('✓ Calendario actualizado');
    }
  }

  void _showInfo(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : null,
          duration: const Duration(seconds: 3),
        ),
      );
  }

  /// v0.34: lista los próximos eventos con tap-to-open
  Future<void> _showUpcomingEvents() async {
    if (_calendar == null) return;
    final events = await _calendar!.listUpcoming(limit: 20);
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, controller) => Container(
          color: Theme.of(ctx).colorScheme.surface,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Icon(Icons.event, size: 28),
                    const SizedBox(width: 8),
                    Text('Próximos eventos',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
              ),
              const Divider(),
              Expanded(
                child: events.isEmpty
                    ? const Center(child: Text('No hay eventos próximos'))
                    : ListView.builder(
                        controller: controller,
                        itemCount: events.length,
                        itemBuilder: (_, i) {
                          final e = events[i];
                          return ListTile(
                            leading: const Icon(Icons.event_note, color: Colors.blue),
                            title: Text(e.title.isEmpty ? '(sin título)' : e.title),
                            subtitle: Text(
                              '${_formatDate(e.start)} · ${_formatTime(e.start)}–${_formatTime(e.end)}'
                              '${e.location.isNotEmpty ? '\n📍 ${e.location}' : ''}',
                            ),
                            isThreeLine: e.location.isNotEmpty,
                            trailing: const Icon(Icons.open_in_new, size: 16),
                            onTap: () async {
                              Navigator.pop(ctx);
                              final ok = await _calendar!.openEventDetail(e.id);
                              if (!ok && mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('No se pudo abrir el evento')),
                                );
                              }
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final eventDay = DateTime(d.year, d.month, d.day);
    final diff = eventDay.difference(today).inDays;
    if (diff == 0) return 'Hoy';
    if (diff == 1) return 'Mañana';
    if (diff < 7) return ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][d.weekday - 1];
    return '${d.day}/${d.month}';
  }

  String _formatTime(DateTime d) {
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('M-NEXUS'),
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                theme.colorScheme.primary,
                theme.colorScheme.secondary,
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        foregroundColor: Colors.white,
        actions: [
          if (_pendingRecordings > 0)
            IconButton(
              icon: Badge(
                label: Text('$_pendingRecordings'),
                child: const Icon(Icons.cloud_upload_outlined),
              ),
              tooltip: '$_pendingRecordings grabaciones pendientes de sincronizar',
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const RecordingPage()),
                );
              },
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _forceCheck,
            tooltip: 'Buscar actualizaciones',
          ),
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const HelpPage()),
              );
            },
            tooltip: 'Ayuda',
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
          _buildStatsRow(),
          const SizedBox(height: 16),
          if (hasUpdate) ...[
            _buildUpdateBanner(),
            const SizedBox(height: 16),
          ],
          if (_upcomingClass != null || _upcomingEvents.isNotEmpty) ...[
            _buildCalendarCard(),
            const SizedBox(height: 16),
          ],
          if (deniedPerms.isNotEmpty) ...[
            _buildPermissionsCard(deniedPerms),
            const SizedBox(height: 16),
          ],
          if (_vaults.isNotEmpty && _vaultsWithPlugin < _vaults.length) ...[
            _buildActivateButton(),
            const SizedBox(height: 16),
          ],
          _buildVaultsSection(),
          const SizedBox(height: 16),
          _buildBackendCard(),
          if (_identity != null) ...[
            const SizedBox(height: 16),
            _buildDeviceCard(),
          ],
          const SizedBox(height: 80),
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
          label: 'Próxima',
          value: _upcomingClass != null
              ? _formatTime(_upcomingClass!.start)
              : (_upcomingEvents.isNotEmpty ? _formatTime(_upcomingEvents.first.start) : '—'),
          sub: _upcomingClass?.title ?? _upcomingEvents.firstOrNull?.title ?? 'Sin eventos',
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
      elevation: 2,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: LinearGradient(
            colors: [color.withOpacity(0.1), Colors.transparent],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: color, size: 18),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(label,
                    style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
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

  Widget _buildUpdateBanner() {
    return Card(
      color: Colors.orange.shade50,
      elevation: 4,
      child: ListTile(
        leading: const Icon(Icons.update, color: Colors.orange, size: 40),
        title: Text('v${_updater.lastResult!.update!.latestVersion} disponible',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text('Tienes v${_updater.lastResult!.installedVersion}\nToca para descargar e instalar'),
        isThreeLine: true,
        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
        onTap: _showUpdateDialog,
      ),
    );
  }

  Widget _buildCalendarCard() {
    final e = _upcomingClass;
    final next = e ?? (_upcomingEvents.isNotEmpty ? _upcomingEvents.first : null);
    if (next == null) return const SizedBox.shrink();
    final now = DateTime.now();
    final isHappening = now.isAfter(next.start) && now.isBefore(next.end);
    final theme = Theme.of(context);
    return Card(
      elevation: 2,
      color: isHappening ? Colors.green.shade50 : theme.colorScheme.primaryContainer,
      child: Column(
        children: [
          // v0.37: muestra el calendario activo si hay uno
          if (_selectedCalendarInfo != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              color: Color(_selectedCalendarInfo!.color).withOpacity(0.15),
              child: Row(
                children: [
                  Container(
                    width: 12, height: 12,
                    decoration: BoxDecoration(
                      color: Color(_selectedCalendarInfo!.color),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Calendario: ${_selectedCalendarInfo!.name}',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (_availableCalendars.length > 1)
                    TextButton.icon(
                      icon: const Icon(Icons.swap_horiz, size: 14),
                      label: const Text('Cambiar', style: TextStyle(fontSize: 11)),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 28),
                      ),
                      onPressed: _showCalendarSelector,
                    ),
                ],
              ),
            ),
          ListTile(
            leading: Icon(
              isHappening ? Icons.event_available : Icons.event,
              size: 40,
              color: isHappening ? Colors.green : null,
            ),
            title: Text(next.title.isEmpty ? '(sin título)' : next.title,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${_formatTime(next.start)} - ${_formatTime(next.end)}'
                    '${next.location.isNotEmpty ? '  📍 ${next.location}' : ''}'),
                Text(
                  isHappening
                      ? '🟢 EN CURSO'
                      : _formatDate(next.start),
                  style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic),
                ),
              ],
            ),
            isThreeLine: true,
            trailing: PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert),
              onSelected: (v) async {
                switch (v) {
                  case 'open':
                    final ok = await _calendar!.openEventDetail(next.id);
                    if (!ok && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('No se pudo abrir el evento')),
                      );
                    }
                    break;
                  case 'select_calendar':
                    await _showCalendarSelector();
                    break;
                  case 'show_all':
                    await _showUpcomingEvents();
                    break;
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'open', child: Text('Abrir en Calendar')),
                PopupMenuItem(value: 'show_all', child: Text('Ver todos los próximos')),
                PopupMenuItem(value: 'select_calendar', child: Text('Escoger calendario')),
              ],
            ),
          ),
          if (_upcomingEvents.length > 1) ...[
            const Divider(height: 1),
            ListTile(
              dense: true,
              leading: const Icon(Icons.list, size: 18),
              title: Text('${_upcomingEvents.length - 1} eventos más próximos',
                style: const TextStyle(fontSize: 12),
              ),
              trailing: const Icon(Icons.chevron_right, size: 16),
              onTap: _showUpcomingEvents,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPermissionsCard(List<PermissionStatus> denied) {
    return Card(
      color: Colors.amber.shade50,
      child: ListTile(
        leading: const Icon(Icons.security, color: Colors.orange, size: 32),
        title: const Text('Permisos pendientes',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text('${denied.length} permiso(s) sin conceder'),
        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
        onTap: () => _showPermissionsDialog(denied),
      ),
    );
  }

  Widget _buildActivateButton() {
    final without = _vaults.where((v) => v.installedPluginVersion == null).toList();
    return Card(
      color: Colors.blue.shade50,
      child: ListTile(
        leading: const Icon(Icons.extension, color: Colors.blue, size: 32),
        title: const Text('Activar plugin',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text('${without.length} vault(s) sin plugin instalado'),
        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
        onTap: _showActivateInstructions,
      ),
    );
  }

  Widget _buildVaultsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          child: Row(
            children: [
              const Icon(Icons.folder, size: 18, color: Colors.blue),
              const SizedBox(width: 6),
              Text('Vaults (${_vaults.length})',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ],
          ),
        ),
        if (_vaults.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const Icon(Icons.search_off, size: 48, color: Colors.grey),
                  const SizedBox(height: 8),
                  const Text('No se detectaron vaults automáticamente'),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    children: [
                      OutlinedButton.icon(
                        icon: const Icon(Icons.folder_open),
                        label: const Text('Path manual'),
                        onPressed: _showManualPathInput,
                      ),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.security),
                        label: const Text('Más permisos'),
                        onPressed: () async {
                          await PermissionsService.openManageStorageSettings();
                          await _load();
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ),
          )
        else
          ..._vaults.map((v) => _buildVaultCard(v)),
      ],
    );
  }

  Widget _buildVaultCard(VaultInfo v) {
    final hasPlugin = v.installedPluginVersion != null;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: hasPlugin ? Colors.green.shade100 : Colors.grey.shade200,
          child: Icon(
            hasPlugin ? Icons.check_circle : Icons.folder,
            color: hasPlugin ? Colors.green : Colors.grey,
          ),
        ),
        title: Text(v.name),
        subtitle: Text(
          '${v.path}\n'
          'Plugin: ${v.installedPluginVersion ?? "no instalado"}'
          '${v.detectionMethod != null ? " · vía ${v.detectionMethod}" : ""}',
        ),
        isThreeLine: true,
        trailing: PopupMenuButton<String>(
          icon: const Icon(Icons.more_vert),
          onSelected: (action) async {
            switch (action) {
              case 'install':
                await _installPlugin(v);
                break;
              case 'activate':
                await _showActivateInstructions();
                break;
              case 'copy':
                await _copyToClipboard(v.path);
                break;
            }
          },
          itemBuilder: (_) => [
            if (!hasPlugin) const PopupMenuItem(value: 'install', child: Text('Instalar plugin')),
            if (!hasPlugin) const PopupMenuItem(value: 'activate', child: Text('Cómo activar')),
            const PopupMenuItem(value: 'copy', child: Text('Copiar path')),
          ],
        ),
      ),
    );
  }

  Future<void> _copyToClipboard(String text) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Copiado: $text'), duration: const Duration(seconds: 2)),
    );
  }

  Widget _buildBackendCard() {
    final connected = _backendUrl != null && _backendUrl!.isNotEmpty;
    return Card(
      child: ListTile(
        leading: Icon(
          connected ? Icons.cloud_done : Icons.cloud_off,
          color: connected ? Colors.green : Colors.grey,
          size: 32,
        ),
        title: const Text('Backend', style: TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(
          connected ? _backendUrl! : 'No configurado',
          style: TextStyle(
            color: connected ? Colors.black87 : Colors.grey,
            fontFamily: 'monospace',
            fontSize: 11,
          ),
        ),
        trailing: TextButton(
          onPressed: _openSettings,
          child: const Text('Configurar'),
        ),
      ),
    );
  }

  Widget _buildDeviceCard() {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.smartphone, size: 32),
        title: Text(_appInfo?.model ?? 'Desconocido',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          'ID: ${_identity!.deviceId.substring(0, 8)}...\n'
          'OS: ${_appInfo?.osVersion ?? "?"} · App: v${_appInfo?.version ?? "?"}',
        ),
        isThreeLine: true,
        trailing: TextButton(
          onPressed: () {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Device ID: ${_identity!.deviceId}')),
            );
          },
          child: const Text('Ver ID'),
        ),
      ),
    );
  }
}
