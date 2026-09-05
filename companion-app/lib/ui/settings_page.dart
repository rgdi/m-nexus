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
import '../services/app_info.dart';
import 'help_page.dart';
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
        if (_calendar!.enabled && _calendars.isNotEmpty) ...[
          // v0.38: Calendario activo (clickable)
          _buildSelectedCalendarTile(),
          // v0.38: Lista de calendarios disponibles (todos, scrollable)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                const Text('Calendarios disponibles:',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _showAllCalendarsSheet,
                  icon: const Icon(Icons.list, size: 16),
                  label: Text('Ver todos (${_calendars.length})'),
                ),
              ],
            ),
          ),
          // v0.38: Mostrar solo los 5 primeros (preview)
          ..._calendars.take(5).map((c) => _buildCalendarTile(c, isPreview: true)),
        ],
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

  /// v0.38: tile del calendario actualmente seleccionado.
  /// Si no hay ninguno, muestra "Todos los calendarios".
  Widget _buildSelectedCalendarTile() {
    final selectedId = _calendar!.selectedCalendarId;
    CalendarInfo? selected;
    try {
      selected = _calendars.firstWhere((c) => c.id == selectedId);
    } catch (_) {
      selected = null;
    }
    if (selected == null) {
      return ListTile(
        leading: const Icon(Icons.calendar_today, color: Colors.blue),
        title: const Text('Todos los calendarios'),
        subtitle: const Text('Toca para elegir uno específico'),
        trailing: const Icon(Icons.chevron_right),
        onTap: _showCalendarPicker,
      );
    }
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: Color(selected.color),
        radius: 14,
        child: const Icon(Icons.check, color: Colors.white, size: 16),
      ),
      title: Text(selected.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(selected.account, style: const TextStyle(fontSize: 11)),
      trailing: TextButton(
        onPressed: _showCalendarPicker,
        child: const Text('Cambiar'),
      ),
    );
  }

  /// v0.38: tile de un calendario individual en la lista preview.
  Widget _buildCalendarTile(CalendarInfo c, {bool isPreview = false}) {
    final isSelected = c.id == _calendar!.selectedCalendarId;
    return ListTile(
      dense: true,
      leading: CircleAvatar(
        backgroundColor: Color(c.color),
        radius: 10,
        child: isSelected
            ? const Icon(Icons.check, color: Colors.white, size: 12)
            : null,
      ),
      title: Text(c.name),
      subtitle: Text(c.account, style: const TextStyle(fontSize: 11)),
      trailing: isSelected
          ? const Icon(Icons.check_circle, color: Colors.green, size: 20)
          : const Icon(Icons.chevron_right, size: 16),
      onTap: () => _selectCalendar(c),
    );
  }

  /// v0.38: muestra un modal con TODOS los calendarios para elegir.
  Future<void> _showCalendarPicker() async {
    if (_calendars.isEmpty) return;
    final picked = await showModalBottomSheet<CalendarInfo>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, scrollController) {
            return Column(
              children: [
                // Header
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: Column(
                    children: [
                      Container(
                        width: 40, height: 4,
                        decoration: BoxDecoration(
                          color: Colors.grey.shade400,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Text('Elegir calendario',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Text('${_calendars.length} disponibles',
                        style: const TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                // Lista de todos los calendarios
                Expanded(
                  child: ListView.builder(
                    controller: scrollController,
                    itemCount: _calendars.length + 1, // +1 para "Todos"
                    itemBuilder: (_, i) {
                      if (i == 0) {
                        return ListTile(
                          leading: const CircleAvatar(
                            backgroundColor: Colors.blue,
                            radius: 12,
                            child: Icon(Icons.all_inclusive, color: Colors.white, size: 14),
                          ),
                          title: const Text('Todos los calendarios',
                            style: TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text('Mostrar eventos de cualquier calendario'),
                          trailing: _calendar!.selectedCalendarId == null
                              ? const Icon(Icons.check_circle, color: Colors.green)
                              : null,
                          onTap: () => Navigator.of(ctx).pop(null),
                        );
                      }
                      final c = _calendars[i - 1];
                      final isSelected = c.id == _calendar!.selectedCalendarId;
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: Color(c.color),
                          radius: 12,
                        ),
                        title: Text(c.name),
                        subtitle: Text(c.account, style: const TextStyle(fontSize: 11)),
                        trailing: isSelected
                            ? const Icon(Icons.check_circle, color: Colors.green)
                            : const Icon(Icons.chevron_right, size: 16),
                        onTap: () => Navigator.of(ctx).pop(c),
                      );
                    },
                  ),
                ),
              ],
            );
          },
        );
      },
    );
    if (picked != null || _calendar!.selectedCalendarId != null) {
      // Si picked es null y selected era null, no hacer nada
      // Si picked es null y selected tenía algo, significa "Todos"
      await _selectCalendar(picked);
    } else if (_calendar!.selectedCalendarId != null) {
      // El usuario eligió "Todos" (null)
      await _selectCalendar(null);
    }
  }

  /// v0.38: muestra un bottom sheet con TODOS los calendarios.
  Future<void> _showAllCalendarsSheet() async {
    await _showCalendarPicker();
  }

  /// v0.38: selecciona un calendario y persiste.
  Future<void> _selectCalendar(CalendarInfo? c) async {
    if (_calendar == null) return;
    await _calendar!.setSelectedCalendar(c?.id);
    if (!mounted) return;
    setState(() {}); // refrescar UI
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(c == null
          ? 'Mostrando eventos de todos los calendarios'
          : 'Calendario seleccionado: ${c.name}'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Widget _buildAboutSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Acerca de'),
        FutureBuilder<AppInfo>(
          future: AppInfo.load(),
          builder: (ctx, snap) {
            final info = snap.data;
            return Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.info),
                  title: const Text('Versión'),
                  subtitle: Text(info?.fullVersion ?? '...'),
                  trailing: info != null && info.buildNumber.isNotEmpty
                    ? Chip(label: Text('build ${info.buildNumber}'))
                    : null,
                ),
                ListTile(
                  leading: const Icon(Icons.phone_android),
                  title: const Text('Dispositivo'),
                  subtitle: Text(info?.model ?? '...'),
                ),
                ListTile(
                  leading: const Icon(Icons.android),
                  title: const Text('Sistema'),
                  subtitle: Text(info?.osVersion ?? '...'),
                ),
                ListTile(
                  leading: const Icon(Icons.help_outline, color: Colors.indigo),
                  title: const Text('Guía de instalación'),
                  subtitle: const Text('Quickstart, FAQ, troubleshooting, links'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const HelpPage()),
                    );
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.link),
                  title: const Text('Repositorio'),
                  subtitle: const Text('github.com/rgdi/m-nexus'),
                ),
                ListTile(
                  leading: const Icon(Icons.bug_report),
                  title: const Text('Reportar problema'),
                  subtitle: const Text('github.com/rgdi/m-nexus/issues'),
                ),
              ],
            );
          },
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
