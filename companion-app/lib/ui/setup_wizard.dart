// SetupWizard: pantalla de bienvenida + pasos de configuración inicial.
//
// v0.31: reemplaza la app de una sola pantalla por un wizard paso a paso.
//
// Flujo:
// 1. Bienvenida: explica qué es M-NEXUS
// 2. Permisos: pide permisos (almacenamiento, calendario, etc.)
// 3. Backend: configurar URL del backend + test de conexión
// 4. Vault: detectar o añadir el vault de Obsidian
// 5. Instalar plugin: descarga y extrae el plugin
// 6. Activar: instrucciones para activar el plugin en Obsidian
//
// Después del wizard, el dispositivo queda registrado y se muestra
// el HomePage normal.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/backend_client.dart';
import '../services/calendar_service.dart';
import '../services/device_id.dart';
import '../services/vault_detector.dart';
import 'home_page.dart';

const _prefsKeySetupDone = 'mnexus.setup.completed';

class SetupWizard extends StatefulWidget {
  final VoidCallback? onCompleted;
  const SetupWizard({super.key, this.onCompleted});

  /// Devuelve true si el setup ya fue completado.
  static Future<bool> isCompleted() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefsKeySetupDone) ?? false;
  }

  /// Resetea el flag (para forzar el wizard de nuevo).
  static Future<void> reset() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKeySetupDone);
  }

  @override
  State<SetupWizard> createState() => _SetupWizardState();
}

class _SetupWizardState extends State<SetupWizard> {
  int _currentStep = 0;
  final _urlController = TextEditingController();
  BackendConnection? _connection;
  VaultDetector _vaultDetector = VaultDetector();
  List<VaultInfo> _detectedVaults = [];
  bool _busy = false;
  bool _calendarGranted = false;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    final url = await BackendClient.getBackendUrl();
    _urlController.text = url;
    final cal = CalendarService();
    await cal.load();
    _calendarGranted = cal.enabled && await cal.isPermissionGranted();
    setState(() {});
  }

  Future<void> _testBackend() async {
    setState(() => _busy = true);
    final result = await BackendClient.testConnection(_urlController.text);
    setState(() {
      _connection = result;
      _busy = false;
    });
  }

  Future<void> _saveUrl() async {
    await BackendClient.setBackendUrl(_urlController.text.trim());
  }

  Future<void> _detectVaults() async {
    setState(() => _busy = true);
    try {
      _detectedVaults = await _vaultDetector.detectVaults();
    } catch (_) {
      _detectedVaults = [];
    }
    setState(() => _busy = false);
  }

  Future<void> _requestCalendar() async {
    final cal = CalendarService();
    await cal.load();
    final ok = await cal.setEnabled(true);
    setState(() => _calendarGranted = ok);
  }

  Future<void> _finish() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKeySetupDone, true);
    // Registrar el device en el backend si está conectado
    if (_connection?.isReachable == true) {
      final client = await BackendClient.create();
      final identity = await DeviceIdentity.load();
      await client.registerDevice(identity);
      client.close();
    }
    if (!mounted) return;
    widget.onCompleted?.call();
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HomePage()),
    );
  }

  void _next() {
    if (_currentStep < 4) {
      setState(() => _currentStep++);
      // Auto-actions per step
      if (_currentStep == 3) _detectVaults();
    } else {
      _finish();
    }
  }

  void _prev() {
    if (_currentStep > 0) {
      setState(() => _currentStep--);
    }
  }

  bool get _canProceed {
    switch (_currentStep) {
      case 0: return true;     // Bienvenida
      case 1: return true;     // Permisos (opcional)
      case 2: return _connection?.isReachable == true; // Backend
      case 3: return true;     // Vault
      case 4: return true;     // Confirmar
      default: return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _buildStepper(),
            Expanded(
              child: PageView(
                controller: PageController(initialPage: _currentStep),
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildWelcome(),
                  _buildPermissions(),
                  _buildBackend(),
                  _buildVault(),
                  _buildConfirm(),
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
      padding: const EdgeInsets.all(16),
      child: Row(
        children: List.generate(5, (i) {
          final active = i <= _currentStep;
          return Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
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
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          if (_currentStep > 0)
            TextButton(onPressed: _prev, child: const Text('Atrás'))
          else
            TextButton(
              onPressed: () {
                // Skip setup
                _finish();
              },
              child: const Text('Saltar'),
            ),
          const Spacer(),
          FilledButton(
            onPressed: _canProceed ? _next : null,
            child: Text(_currentStep == 4 ? 'Finalizar' : 'Siguiente'),
          ),
        ],
      ),
    );
  }

  Widget _buildWelcome() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.medical_services, size: 96, color: Theme.of(context).colorScheme.primary),
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
                  _Bullet('Configurar tu dispositivo y permisos'),
                  _Bullet('Conectar con el backend de M-NEXUS'),
                  _Bullet('Grabar clases y vincularlas a tu calendario'),
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
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Icon(Icons.security, size: 64),
        const SizedBox(height: 16),
        Text('Permisos', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        _PermTile(
          icon: Icons.folder,
          title: 'Almacenamiento',
          subtitle: 'Para acceder a tu vault de Obsidian',
          granted: true,
        ),
        _PermTile(
          icon: Icons.calendar_month,
          title: 'Google Calendar (opcional)',
          subtitle: 'Para sugerir nombre de clase al grabar',
          granted: _calendarGranted,
          onRequest: _requestCalendar,
        ),
        _PermTile(
          icon: Icons.mic,
          title: 'Micrófono (opcional)',
          subtitle: 'Para grabar clases',
          granted: false,
        ),
        _PermTile(
          icon: Icons.install_mobile,
          title: 'Instalar apps',
          subtitle: 'Para auto-actualizar el companion',
          granted: true,
        ),
        const SizedBox(height: 16),
        const Text(
          'Los permisos opcionales se pueden activar después en Configuración.',
          style: TextStyle(fontSize: 12, color: Colors.grey),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildBackend() {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Icon(Icons.dns, size: 64),
        const SizedBox(height: 16),
        Text('Configurar backend', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        const Text(
          'Ingresa la URL del backend M-NEXUS.\n'
          'Por defecto usa emulador (10.0.2.2) o localhost.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _urlController,
          decoration: InputDecoration(
            labelText: 'URL del backend',
            hintText: 'http://192.168.1.10:8787',
            border: const OutlineInputBorder(),
            prefixIcon: const Icon(Icons.link),
            suffixIcon: _busy
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(
                    icon: const Icon(Icons.wifi_find),
                    onPressed: _testBackend,
                  ),
          ),
          keyboardType: TextInputType.url,
          autocorrect: false,
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _busy ? null : _testBackend,
          icon: const Icon(Icons.network_check),
          label: const Text('Probar conexión'),
        ),
        if (_connection != null) ...[
          const SizedBox(height: 16),
          Card(
            color: _connection!.isReachable
                ? Colors.green.withOpacity(0.1)
                : Colors.red.withOpacity(0.1),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _connection!.isReachable ? '✓ Conexión exitosa' : '✗ No se pudo conectar',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  Text('URL: ${_connection!.url}'),
                  if (_connection!.version != null) Text('Versión: ${_connection!.version}'),
                  if (_connection!.error != null) Text('Error: ${_connection!.error}'),
                  Text('Latencia: ${_connection!.latency.inMilliseconds} ms'),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildVault() {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Icon(Icons.folder, size: 64),
        const SizedBox(height: 16),
        Text('Detectar vault', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        const Text(
          'Buscaremos automáticamente los vaults de Obsidian en tu dispositivo.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        if (_busy)
          const Center(child: CircularProgressIndicator())
        else if (_detectedVaults.isEmpty)
          Column(
            children: [
              const Icon(Icons.search_off, size: 48, color: Colors.grey),
              const SizedBox(height: 8),
              const Text('No se detectaron vaults'),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _detectVaults,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          )
        else
          ..._detectedVaults.map((v) => Card(
                child: ListTile(
                  leading: const Icon(Icons.folder_open, color: Colors.green),
                  title: Text(v.name),
                  subtitle: Text(v.path, style: const TextStyle(fontSize: 11)),
                ),
              )),
        const SizedBox(height: 16),
        const Text(
          'Podrás añadir vaults manualmente después desde el Home.',
          style: TextStyle(fontSize: 12, color: Colors.grey),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildConfirm() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle, size: 96, color: Colors.green),
          const SizedBox(height: 24),
          Text('¡Todo listo!', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Resumen:', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  _SummaryRow('Backend', _connection?.url ?? '-'),
                  _SummaryRow('Versión', _connection?.version ?? '-'),
                  _SummaryRow('Vaults detectados', _detectedVaults.length.toString()),
                  _SummaryRow('Calendar', _calendarGranted ? 'Activado' : 'No activado'),
                  _SummaryRow('Device ID', (_identity?.deviceId ?? '-').substring(0, 8) + '...'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'El plugin se descargará e instalará en tu vault desde el Home.\n'
            'Luego te mostraremos cómo activarlo en Obsidian.',
            textAlign: TextAlign.center,
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

class _PermTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool granted;
  final VoidCallback? onRequest;

  const _PermTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.granted,
    this.onRequest,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon, color: granted ? Colors.green : Colors.grey),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: granted
            ? const Icon(Icons.check_circle, color: Colors.green)
            : (onRequest != null
                ? TextButton(onPressed: onRequest, child: const Text('Pedir'))
                : const Text('Opcional', style: TextStyle(fontSize: 11, color: Colors.grey))),
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
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }
}
