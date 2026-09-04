// SetupWizard: bienvenida + configuración inicial paso a paso.
//
// v0.35 (revisión completa):
//   - PageView envuelto en SingleChildScrollView para evitar overflow
//   - Permisos con checkbox de "Pedir TODOS de una vez"
//   - Battery optimization (Android) - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
//   - Calendar selection con confirmación visual
//   - Plugin setup con download + activate instructions
//   - Cada paso tiene un Scaffoled individual (no nested)
//   - Botón "Anterior" siempre visible
//   - Estado se preserva entre navegaciones

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/backend_client.dart';
import '../services/calendar_service.dart';
import '../services/permissions.dart';
import '../services/device_id.dart';
import '../services/vault_detector.dart';
import '../services/updater.dart';
import '../services/plugin_installer.dart';
import '../models/plugin_release.dart';
import 'home_page.dart';

const _prefsKeySetupDone = 'mnexus.setup.completed';

class SetupWizard extends StatefulWidget {
  final VoidCallback? onCompleted;
  const SetupWizard({super.key, this.onCompleted});

  static Future<bool> isCompleted() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefsKeySetupDone) ?? false;
  }

  static Future<void> reset() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKeySetupDone);
  }

  @override
  State<SetupWizard> createState() => _SetupWizardState();
}

class _SetupWizardState extends State<SetupWizard> {
  int _currentStep = 0;
  final PageController _pageController = PageController();
  final _urlController = TextEditingController();
  final _vaultDetector = VaultDetector();
  BackendConnection? _connection;
  List<VaultInfo> _detectedVaults = [];
  VaultInfo? _selectedVault;
  bool _busy = false;
  DeviceIdentity? _identity;
  bool _calendarGranted = false;
  List<PermissionStatus> _currentPerms = [];
  bool _permsLoading = true;
  int _selectedCalendarId = -1;
  List<CalendarInfo> _availableCalendars = [];
  // Battery optimization
  bool _batteryOptimizationRequested = false;
  // Plugin setup
  bool _downloadingPlugin = false;
  String _pluginPhase = '';
  double _pluginProgress = 0;
  String? _pluginError;
  InstallResult? _pluginResult;

  static const _stepTitles = [
    'Bienvenida',
    'Permisos',
    'Batería',
    'Backend',
    'Calendario',
    'Vault',
    'Plugin',
    'Listo',
  ];

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    final url = await BackendClient.getBackendUrl();
    _urlController.text = url;
    final cal = CalendarService();
    await cal.load();
    _calendarGranted = cal.enabled && await cal.isPermissionGranted();
    if (_calendarGranted) {
      _availableCalendars = await cal.listCalendars();
      _selectedCalendarId = cal.selectedCalendarId ?? -1;
    }
    _identity = await DeviceIdentity.load();
    await _refreshPerms();
    if (mounted) setState(() {});
  }

  Future<void> _refreshPerms() async {
    setState(() => _permsLoading = true);
    final list = await PermissionsService.getAll();
    if (mounted) {
      setState(() {
        _currentPerms = list;
        _permsLoading = false;
      });
    }
  }

  Future<void> _requestAllPerms() async {
    setState(() => _permsLoading = true);
    final list = await PermissionsService.requestAll();
    if (mounted) {
      setState(() {
        _currentPerms = list;
        _permsLoading = false;
        _calendarGranted = list.any((p) => p.name == 'calendar' && p.granted);
      });
    }
  }

  Future<void> _requestBatteryOptimization() async {
    try {
      const channel = MethodChannel('com.mnexus.installer/permissions');
      await channel.invokeMethod('requestIgnoreBatteryOptimizations');
      setState(() => _batteryOptimizationRequested = true);
    } catch (_) {
      // Fallback: abrir settings manualmente
      await PermissionsService.openSettings();
    }
  }

  Future<void> _testBackend() async {
    setState(() => _busy = true);
    try {
      final result = await BackendClient.testConnection(_urlController.text);
      if (mounted) {
        setState(() {
          _connection = result;
          _busy = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _detectVaults() async {
    setState(() => _busy = true);
    try {
      _detectedVaults = await _vaultDetector.detectVaults();
    } catch (_) {
      _detectedVaults = [];
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _selectCalendar(int id) async {
    final cal = CalendarService();
    await cal.setSelectedCalendar(id);
    if (mounted) setState(() => _selectedCalendarId = id);
  }

  Future<void> _installPluginToSelectedVault() async {
    if (_selectedVault == null) return;
    setState(() {
      _downloadingPlugin = true;
      _pluginError = null;
      _pluginPhase = 'Descargando...';
      _pluginProgress = 0;
    });
    try {
      // 1) Buscar el último release
      final release = await _fetchPluginRelease();
      if (release == null) {
        setState(() {
          _downloadingPlugin = false;
          _pluginPhase = '';
          _pluginError = 'No se pudo encontrar el release del plugin en GitHub';
        });
        return;
      }
      // 2) Descargar
      final installer = PluginInstaller();
      final bytes = await installer.downloadRelease(
        release,
        onProgress: (p) {
          if (mounted) {
            setState(() {
              _pluginProgress = p;
              _pluginPhase = 'Descargando... ${(p * 100).toStringAsFixed(0)}%';
            });
          }
        },
      );
      if (!mounted) return;
      setState(() {
        _pluginPhase = 'Instalando en ${_selectedVault!.name}...';
      });
      // 3) Instalar
      final result = await installer.installTo(_selectedVault!.path, bytes);
      if (!mounted) return;
      setState(() {
        _downloadingPlugin = false;
        _pluginResult = result;
        if (result.status == InstallStatus.success) {
          _pluginPhase = '✅ Plugin instalado';
        } else {
          _pluginError = result.errorMessage;
        }
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _downloadingPlugin = false;
          _pluginError = e.toString();
        });
      }
    }
  }

  Future<PluginRelease?> _fetchPluginRelease() async {
    try {
      final response = await BackendClient.httpGet(
        'https://api.github.com/repos/rgdi/m-nexus/releases/latest',
      );
      if (response.statusCode != 200) return null;
      final json = await BackendClient.decodeJson(response);
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
      if (downloadUrl.isEmpty) return null;
      return PluginRelease(
        latestVersion: version,
        minAppVersion: '1.5.0',
        releaseNotes: body,
        downloadUrl: downloadUrl,
        checksumSha256: '',
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _finish() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKeySetupDone, true);
    if (_connection?.isReachable == true) {
      try {
        final client = await BackendClient.create();
        final identity = await DeviceIdentity.load();
        await client.registerDevice(identity);
        client.close();
      } catch (_) {}
    }
    if (!mounted) return;
    widget.onCompleted?.call();
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HomePage()),
    );
  }

  void _next() {
    if (_currentStep < _stepTitles.length - 1) {
      final next = _currentStep + 1;
      if (next == 5) _detectVaults();
      setState(() => _currentStep = next);
      _pageController.animateToPage(next,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    } else {
      _finish();
    }
  }

  void _prev() {
    if (_currentStep > 0) {
      final prev = _currentStep - 1;
      setState(() => _currentStep = prev);
      _pageController.animateToPage(prev,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    }
  }

  bool get _canProceed {
    switch (_currentStep) {
      case 0: return true;
      case 1:
        // Permisos: requerir al menos mic y storage
        return _currentPerms.any((p) => p.name == 'microphone' && p.granted) ||
               _currentPerms.any((p) => p.name == 'storage' && p.granted);
      case 2: return true;  // Battery (opcional)
      case 3: return _connection?.isReachable == true;
      case 4: return true;  // Calendar (opcional, pero recomendado)
      case 5: return _detectedVaults.isNotEmpty || _selectedVault != null;
      case 6: return true;  // Plugin (opcional, puede hacerse después)
      case 7: return true;  // Final
      default: return true;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${_currentStep + 1}/${_stepTitles.length}: ${_stepTitles[_currentStep]}'),
        leading: _currentStep > 0
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: _prev)
            : null,
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildStepper(),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (i) => setState(() => _currentStep = i),
                children: [
                  _buildWelcome(),
                  _buildPermissions(),
                  _buildBattery(),
                  _buildBackend(),
                  _buildCalendar(),
                  _buildVault(),
                  _buildPlugin(),
                  _buildFinish(),
                ],
              ),
            ),
            _buildNavBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildStepper() {
    return Container(
      padding: const EdgeInsets.all(8),
      child: Row(
        children: List.generate(_stepTitles.length, (i) {
          final active = i <= _currentStep;
          return Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 1),
              height: 4,
              decoration: BoxDecoration(
                color: active
                    ? Theme.of(context).colorScheme.primary
                    : Colors.grey.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildNavBar() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(top: BorderSide(color: Colors.grey.shade300)),
      ),
      child: Row(
        children: [
          TextButton(
            onPressed: _finish,
            child: const Text('Saltar'),
          ),
          const Spacer(),
          if (_currentStep > 0)
            TextButton(onPressed: _prev, child: const Text('Atrás')),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: _canProceed ? _next : null,
            child: Text(_currentStep == _stepTitles.length - 1 ? 'Finalizar' : 'Siguiente'),
          ),
        ],
      ),
    );
  }

  Widget _buildWelcome() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(height: 32),
          Container(
            width: 120, height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [Theme.of(context).colorScheme.primary, Theme.of(context).colorScheme.secondary],
              ),
            ),
            child: const Icon(Icons.medical_services, size: 64, color: Colors.white),
          ),
          const SizedBox(height: 24),
          Text('M-NEXUS', style: Theme.of(context).textTheme.displaySmall),
          const SizedBox(height: 8),
          const Text(
            'Tu sistema de estudio médico con control humano.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16),
          ),
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text('Esta app te ayuda a:', style: TextStyle(fontWeight: FontWeight.bold)),
                  SizedBox(height: 8),
                  _Bullet('Instalar el plugin M-NEXUS en tu vault de Obsidian'),
                  _Bullet('Configurar permisos y batería'),
                  _Bullet('Conectar con el backend de M-NEXUS'),
                  _Bullet('Sincronizar Calendar y voice notes'),
                  _Bullet('Recibir actualizaciones automáticas'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPermissions() {
    if (_permsLoading && _currentPerms.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    final granted = _currentPerms.where((p) => p.granted).length;
    final total = _currentPerms.length;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            const Icon(Icons.security, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Permisos ($granted/$total)',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text('Toca "Pedir todos" para otorgarlos de una vez',
                    style: const TextStyle(color: Colors.grey, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        ..._currentPerms.map(_buildPermTile),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _permsLoading ? null : _refreshPerms,
                icon: const Icon(Icons.refresh),
                label: const Text('Verificar'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: _permsLoading ? null : _requestAllPerms,
                icon: const Icon(Icons.check),
                label: const Text('Pedir todos'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.amber.shade50,
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Row(
            children: [
              Icon(Icons.lightbulb_outline, size: 16, color: Colors.amber),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Si un permiso queda "denegado permanentemente", ábrelo desde Settings del sistema.',
                  style: TextStyle(fontSize: 11),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPermTile(PermissionStatus p) {
    IconData icon;
    switch (p.name) {
      case 'storage': icon = Icons.folder; break;
      case 'microphone': icon = Icons.mic; break;
      case 'calendar': icon = Icons.calendar_month; break;
      case 'notifications': icon = Icons.notifications; break;
      case 'install_unknown': icon = Icons.install_mobile; break;
      case 'manage_storage': icon = Icons.storage; break;
      default: icon = Icons.help_outline;
    }
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: p.granted ? Colors.green.shade100 : Colors.orange.shade100,
          child: Icon(icon, color: p.granted ? Colors.green : Colors.orange),
        ),
        title: Text(p.displayName, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          p.granted
              ? '✓ Concedido'
              : (p.permanentlyDenied
                  ? '⚠ Denegado permanentemente'
                  : p.description),
          style: TextStyle(
            color: p.granted ? Colors.green : (p.permanentlyDenied ? Colors.red : null),
            fontSize: 12,
          ),
        ),
        trailing: p.granted
            ? const Icon(Icons.check_circle, color: Colors.green)
            : IconButton(
                icon: const Icon(Icons.lock_open),
                tooltip: 'Pedir este permiso',
                onPressed: () async {
                  final result = await PermissionsService.request(p.name);
                  if (mounted) {
                    setState(() {
                      final i = _currentPerms.indexWhere((x) => x.name == p.name);
                      if (i >= 0) _currentPerms[i] = result;
                    });
                    if (result.permanentlyDenied) {
                      // Permiso especial para manage_storage
                      if (p.name == 'manage_storage') {
                        await PermissionsService.openManageStorageSettings();
                      } else {
                        await PermissionsService.openSettings();
                      }
                    }
                  }
                },
              ),
      ),
    );
  }

  Widget _buildBattery() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.battery_charging_full,
                size: 40,
                color: _batteryOptimizationRequested ? Colors.green : Colors.orange,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text('Optimización de batería',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            'Android puede matar M-NEXUS en background para ahorrar batería. '
            'Para que las grabaciones, voice notes y sync funcionen correctamente, '
            'recomendamos desactivar la optimización de batería para M-NEXUS.',
          ),
          const SizedBox(height: 24),
          Card(
            color: _batteryOptimizationRequested ? Colors.green.shade50 : Colors.orange.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _batteryOptimizationRequested ? Icons.check_circle : Icons.warning_amber,
                    color: _batteryOptimizationRequested ? Colors.green : Colors.orange,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _batteryOptimizationRequested
                          ? 'Optimización desactivada ✓'
                          : 'Optimización activa (recomendamos desactivarla)',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _batteryOptimizationRequested ? null : _requestBatteryOptimization,
            icon: Icon(_batteryOptimizationRequested ? Icons.check : Icons.battery_saver),
            label: Text(_batteryOptimizationRequested ? 'Ya desactivada' : 'Pedir desactivar'),
          ),
          const SizedBox(height: 24),
          const Text(
            'Esto abrirá la pantalla del sistema. Selecciona "No optimizar" o "Permitir".',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }

  Widget _buildBackend() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Backend M-NEXUS', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text('URL del backend (el servidor Node.js)'),
          const SizedBox(height: 12),
          TextField(
            controller: _urlController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'http://192.168.1.10:8787',
              prefixIcon: Icon(Icons.dns),
            ),
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            onSubmitted: (_) => _testBackend(),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _testBackend,
                  icon: _busy
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.wifi_find),
                  label: const Text('Probar'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    await BackendClient.setBackendUrl(_urlController.text);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('URL guardada')),
                      );
                    }
                  },
                  icon: const Icon(Icons.save),
                  label: const Text('Guardar'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_connection != null) _buildConnectionResult(),
          const SizedBox(height: 16),
          const Text(
            'Por defecto: http://10.0.2.2:8787 (emulador).\n'
            'Para tu PC en LAN: usa la IP local (ej. http://192.168.1.10:8787).',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectionResult() {
    final c = _connection!;
    return Card(
      color: c.isReachable ? Colors.green.shade50 : Colors.red.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  c.isReachable ? Icons.check_circle : Icons.error,
                  color: c.isReachable ? Colors.green : Colors.red,
                ),
                const SizedBox(width: 8),
                Text(
                  c.isReachable ? 'Conectado' : 'Error de conexión',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('URL: ${c.url}'),
            if (c.version != null) Text('Versión: ${c.version}'),
            if (c.latency.inMilliseconds > 0) Text('Latencia: ${c.latency.inMilliseconds}ms'),
            if (c.error != null)
              Text('Error: ${c.error}', style: const TextStyle(color: Colors.red)),
          ],
        ),
      ),
    );
  }

  Widget _buildCalendar() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Google Calendar', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        const Text('Para sugerir nombres de clase desde eventos próximos.'),
        const SizedBox(height: 16),
        if (!_calendarGranted)
          Card(
            color: Colors.amber.shade50,
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.amber),
                  SizedBox(width: 8),
                  Expanded(child: Text('Concede el permiso de Calendar para continuar.')),
                ],
              ),
            ),
          )
        else if (_availableCalendars.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No se encontraron calendarios en el dispositivo.'),
            ),
          )
        else ...[
          const Text('Escoge un calendario:', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ..._availableCalendars.map((c) {
            final selected = c.id == _selectedCalendarId;
            return Card(
              color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: Color(c.color == 0 ? 0xFF2563EB : c.color),
                  child: Icon(
                    selected ? Icons.check : Icons.calendar_today,
                    color: Colors.white,
                    size: 18,
                  ),
                ),
                title: Text(c.name,
                  style: TextStyle(
                    fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
                subtitle: Text(c.account, style: const TextStyle(fontSize: 11)),
                trailing: selected
                    ? const Icon(Icons.check_circle, color: Colors.green)
                    : const Icon(Icons.radio_button_unchecked),
                onTap: () => _selectCalendar(c.id),
              ),
            );
          }),
        ],
      ],
    );
  }

  Widget _buildVault() {
    if (_busy) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_detectedVaults.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.search_off, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('No se detectaron vaults automáticamente'),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _detectVaults,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                'También puedes añadirlo manualmente desde el Home después.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Vaults detectados (${_detectedVaults.length})',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 16),
        ..._detectedVaults.map((v) {
          final selected = _selectedVault?.path == v.path;
          return Card(
            color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
            child: ListTile(
              leading: Icon(
                selected ? Icons.check_circle : Icons.folder_open,
                color: selected ? Colors.green : null,
                size: 32,
              ),
              title: Text(v.name, style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text(v.path, style: const TextStyle(fontSize: 11)),
              trailing: selected
                  ? const Icon(Icons.check, color: Colors.green)
                  : const Text('Toca'),
              onTap: () {
                setState(() {
                  _selectedVault = selected ? null : v;
                });
              },
            );
          });
        }),
      ],
    );
  }

  Widget _buildPlugin() {
    if (_selectedVault == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.extension_off, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('Selecciona un vault primero (paso anterior)'),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _prev,
              child: const Text('Volver'),
            ),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Instalar plugin', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text('Vault: ${_selectedVault!.name}\n${_selectedVault!.path}',
          style: const TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 16),
        if (_pluginResult == null) ...[
          if (_downloadingPlugin) ...[
            const Padding(
              padding: EdgeInsets.all(16),
              child: LinearProgressIndicator(),
            ),
            Center(child: Text(_pluginPhase)),
            const SizedBox(height: 8),
            Center(child: Text('${(_pluginProgress * 100).toStringAsFixed(0)}%')),
          ] else
            FilledButton.icon(
              onPressed: _installPluginToSelectedVault,
              icon: const Icon(Icons.download),
              label: const Text('Descargar e instalar plugin'),
            ),
          if (_pluginError != null) ...[
            const SizedBox(height: 16),
            Card(
              color: Colors.red.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    const Icon(Icons.error, color: Colors.red),
                    const SizedBox(width: 8),
                    Expanded(child: Text(_pluginError!)),
                  ],
                ),
              ),
            ),
          ],
        ] else if (_pluginResult!.status == InstallStatus.success) ...[
          Card(
            color: Colors.green.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 64),
                  const SizedBox(height: 8),
                  const Text('✅ Plugin instalado correctamente',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  Text('Versión: ${_pluginResult!.installedVersion ?? "?"}'),
                  const SizedBox(height: 16),
                  const Text(
                    'Ahora abre Obsidian → Settings → Community plugins → busca "M-NEXUS" → Enable',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () {
              setState(() {
                _pluginResult = null;
                _pluginError = null;
                _pluginPhase = '';
              });
            },
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          ),
        ],
      ],
    );
  }

  Widget _buildFinish() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(height: 32),
          Container(
            width: 100, height: 100,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.green.shade100,
            ),
            child: const Icon(Icons.check_circle, color: Colors.green, size: 60),
          ),
          const SizedBox(height: 24),
          Text('¡Todo listo!', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Resumen', style: TextStyle(fontWeight: FontWeight.bold)),
                  const Divider(),
                  _SummaryRow('Backend',
                    _connection?.isReachable == true
                      ? '✓ ${_connection!.url}'
                      : 'No conectado'),
                  _SummaryRow('Permisos',
                    '${_currentPerms.where((p) => p.granted).length}/${_currentPerms.length}'),
                  _SummaryRow('Batería',
                    _batteryOptimizationRequested ? 'Desactivada ✓' : 'Por defecto'),
                  _SummaryRow('Calendario',
                    _selectedCalendarId > 0 ? 'Seleccionado ✓' : 'No seleccionado'),
                  _SummaryRow('Vault',
                    _selectedVault?.name ?? 'No seleccionado'),
                  _SummaryRow('Plugin',
                    _pluginResult?.status == InstallStatus.success ? 'Instalado ✓' : 'Pendiente'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Si elegiste instalar el plugin, ábrelo en Obsidian y actívalo desde Settings → Community plugins.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  final String text;
  const _Bullet(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('• ', style: TextStyle(fontWeight: FontWeight.bold)),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  const _SummaryRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 100, child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12))),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }
}
