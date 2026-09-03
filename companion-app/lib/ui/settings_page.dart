// SettingsPage: configuración completa de M-NEXUS companion.
//
// Secciones:
// - Backend: URL/IP, test de conexión, info del servidor
// - Dispositivo: nombre, ID, plataforma
// - Calendar: integración con Google Calendar
// - Auto-update: configurar intervalo, incluir prereleases
// - Grabación: calidad de audio, formato
// - Acerca de: versión, links

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/backend_client.dart';
import '../services/calendar_service.dart';
import '../services/device_id.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _urlController = TextEditingController();
  final _nameController = TextEditingController();
  BackendConnection? _connection;
  DeviceIdentity? _identity;
  CalendarService? _calendar;
  bool _testing = false;
  bool _loading = true;
  bool _calendarAvailable = false;
  List<CalendarInfo> _calendars = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _urlController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final url = await BackendClient.getBackendUrl();
    _urlController.text = url;
    _identity = await DeviceIdentity.load();
    _nameController.text = _identity?.displayName ?? _identity?.model ?? '';
    _calendar = CalendarService();
    await _calendar!.load();
    if (_calendar!.enabled) {
      _calendarAvailable = await _calendar!.isPermissionGranted();
      if (_calendarAvailable) {
        _calendars = await _calendar!.listCalendars();
      }
    }
    setState(() => _loading = false);
  }

  Future<void> _testConnection() async {
    setState(() => _testing = true);
    final result = await BackendClient.testConnection(_urlController.text);
    setState(() {
      _connection = result;
      _testing = false;
    });
  }

  Future<void> _saveUrl() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;
    await BackendClient.setBackendUrl(url);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('URL guardada')),
    );
  }

  Future<void> _saveName() async {
    final name = _nameController.text.trim();
    if (name.isEmpty || _identity == null) return;
    await _identity!.setDisplayName(name);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Nombre actualizado')),
    );
  }

  Future<void> _enableCalendar() async {
    if (_calendar == null) return;
    final ok = await _calendar!.setEnabled(true);
    if (!ok) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Permiso de calendario denegado')),
      );
      return;
    }
    _calendars = await _calendar!.listCalendars();
    setState(() => _calendarAvailable = true);
  }

  Future<void> _disableCalendar() async {
    if (_calendar == null) return;
    await _calendar!.setEnabled(false);
    setState(() {
      _calendarAvailable = false;
      _calendars = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Configuración')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          _buildBackendSection(),
          const Divider(),
          _buildDeviceSection(),
          const Divider(),
          _buildCalendarSection(),
          const Divider(),
          _buildAboutSection(),
        ],
      ),
    );
  }

  Widget _buildBackendSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Backend M-NEXUS'),
        ListTile(
          leading: const Icon(Icons.dns),
          title: const Text('URL del backend'),
          subtitle: TextField(
            controller: _urlController,
            decoration: const InputDecoration(
              border: InputBorder.none,
              hintText: 'http://192.168.1.10:8787',
            ),
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            onSubmitted: (_) => _saveUrl(),
          ),
          trailing: _testing
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : IconButton(
                  icon: const Icon(Icons.wifi_find),
                  tooltip: 'Probar conexión',
                  onPressed: _testConnection,
                ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              FilledButton.icon(
                onPressed: _saveUrl,
                icon: const Icon(Icons.save),
                label: const Text('Guardar URL'),
              ),
              const SizedBox(width: 12),
              if (_connection != null) _buildConnectionChip(),
            ],
          ),
        ),
        if (_connection?.isReachable == true)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Card(
              color: Colors.green.withOpacity(0.1),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('✓ Conectado a ${_connection!.url}'),
                    Text('Versión: ${_connection!.version ?? "?"}'),
                    Text('Latencia: ${_connection!.latency.inMilliseconds} ms'),
                  ],
                ),
              ),
            ),
          )
        else if (_connection?.error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Card(
              color: Colors.red.withOpacity(0.1),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text('✗ ${_connection!.error}'),
              ),
            ),
          ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Text(
            'Por defecto: http://10.0.2.2:8787 (emulador) o http://localhost:8787 (mismo dispositivo). '
            'Para LAN: usa la IP del servidor (ej. http://192.168.1.10:8787).',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ),
      ],
    );
  }

  Widget _buildConnectionChip() {
    if (_connection == null) return const SizedBox.shrink();
    return Chip(
      avatar: Icon(
        _connection!.isReachable ? Icons.check_circle : Icons.error,
        color: _connection!.isReachable ? Colors.green : Colors.red,
        size: 18,
      ),
      label: Text(_connection!.isReachable ? 'OK' : 'Error'),
    );
  }

  Widget _buildDeviceSection() {
    if (_identity == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Dispositivo'),
        ListTile(
          leading: const Icon(Icons.badge),
          title: const Text('Nombre'),
          subtitle: TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              border: InputBorder.none,
              hintText: 'Mi Pixel 7',
            ),
            onSubmitted: (_) => _saveName(),
          ),
          trailing: IconButton(
            icon: const Icon(Icons.save),
            onPressed: _saveName,
          ),
        ),
        ListTile(
          leading: const Icon(Icons.fingerprint),
          title: const Text('Device ID'),
          subtitle: SelectableText(
            _identity!.deviceId,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
          trailing: IconButton(
            icon: const Icon(Icons.copy),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: _identity!.deviceId));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Device ID copiado')),
              );
            },
          ),
        ),
        ListTile(
          leading: const Icon(Icons.phone_android),
          title: const Text('Modelo'),
          subtitle: Text(_identity!.model ?? 'Desconocido'),
        ),
        ListTile(
          leading: const Icon(Icons.info_outline),
          title: const Text('Versión Android'),
          subtitle: Text(_identity!.osVersion ?? 'Desconocida'),
        ),
        ListTile(
          leading: const Icon(Icons.calendar_today),
          title: const Text('Registrado'),
          subtitle: Text(
            _identity!.createdAt.toLocal().toString().split('.').first,
          ),
        ),
      ],
    );
  }

  Widget _buildCalendarSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Google Calendar'),
        SwitchListTile(
          secondary: const Icon(Icons.calendar_month),
          title: const Text('Integración con Calendar'),
          subtitle: Text(_calendar!.enabled
              ? (_calendarAvailable
                  ? 'Activado: ${_calendars.length} calendarios detectados'
                  : 'Activado pero permiso denegado')
              : 'Sugerir nombre de clase desde eventos próximos'),
          value: _calendar!.enabled,
          onChanged: (v) => v ? _enableCalendar() : _disableCalendar(),
        ),
        if (_calendar!.enabled && _calendars.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Calendarios disponibles:', style: TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 4),
                ..._calendars.take(5).map((c) => ListTile(
                      dense: true,
                      leading: CircleAvatar(
                        backgroundColor: Color(c.color),
                        radius: 10,
                      ),
                      title: Text(c.name),
                      subtitle: Text(c.account, style: const TextStyle(fontSize: 11)),
                    )),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: OutlinedButton.icon(
            onPressed: () => _calendar!.openCalendarApp(),
            icon: const Icon(Icons.open_in_new),
            label: const Text('Abrir app de Calendar'),
          ),
        ),
      ],
    );
  }

  Widget _buildAboutSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Acerca de'),
        const ListTile(
          leading: Icon(Icons.info),
          title: Text('Versión'),
          subtitle: Text('0.30.0+10'),
        ),
        const ListTile(
          leading: Icon(Icons.link),
          title: Text('Repositorio'),
          subtitle: Text('github.com/rgdi/m-nexus'),
        ),
        const ListTile(
          leading: Icon(Icons.bug_report),
          title: Text('Reportar problema'),
          subtitle: Text('github.com/rgdi/m-nexus/issues'),
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: Theme.of(context).colorScheme.primary,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}
