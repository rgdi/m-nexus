// CalendarService: integración con Google Calendar (v0.31).
//
// Lee los eventos del calendario del dispositivo para:
// - Sugerir horarios de clase cuando se inicia una grabación
// - Mostrar próximas clases en el home
// - Vincular la grabación a un evento automáticamente
//
// Usa el Calendar Provider nativo de Android (no requiere Google Sign-In
// porque accede directamente al provider con READ_CALENDAR permission).

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// v0.37: helper que se puede mockear con debugDefaultTargetPlatformOverride.
/// En código de producción, dart:io Platform.isAndroid siempre es true (Android).
/// En tests, debugDefaultTargetPlatformOverride = TargetPlatform.android lo fuerza.
bool get _isAndroid => defaultTargetPlatform == TargetPlatform.android;

const _channel = MethodChannel('com.mnexus.app/calendar');
const _prefsKeyCalendarEnabled = 'mnexus.calendar.enabled';
const _prefsKeySelectedCalendarId = 'mnexus.calendar.selected_id';

class CalendarInfo {
  final int id;
  final String name;
  final String account;
  final String owner;
  final int color;
  final bool visible;

  const CalendarInfo({
    required this.id,
    required this.name,
    required this.account,
    required this.owner,
    required this.color,
    required this.visible,
  });

  factory CalendarInfo.fromMap(Map<dynamic, dynamic> m) => CalendarInfo(
        id: (m['id'] as num).toInt(),
        name: m['name'] as String? ?? '',
        account: m['account'] as String? ?? '',
        owner: m['owner'] as String? ?? '',
        color: (m['color'] as num?)?.toInt() ?? 0,
        visible: m['visible'] as bool? ?? true,
      );

  @override
  String toString() => '$name ($account)';
}

class CalendarEvent {
  final int id;
  final String title;
  final String description;
  final String location;
  final DateTime start;
  final DateTime end;
  final int calendarId;

  const CalendarEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.location,
    required this.start,
    required this.end,
    required this.calendarId,
  });

  factory CalendarEvent.fromMap(Map<dynamic, dynamic> m) => CalendarEvent(
        id: (m['id'] as num).toInt(),
        title: m['title'] as String? ?? '',
        description: m['description'] as String? ?? '',
        location: m['location'] as String? ?? '',
        start: DateTime.fromMillisecondsSinceEpoch((m['startMs'] as num).toInt()),
        end: DateTime.fromMillisecondsSinceEpoch((m['endMs'] as num).toInt()),
        calendarId: (m['calendarId'] as num).toInt(),
      );

  /// Sugiere una materia/nombre de archivo basado en el título del evento.
  /// Heurística simple: primera palabra en mayúsculas o "Class" / "Lecture".
  String get suggestedClassName {
    final t = title.trim();
    if (t.isEmpty) return '';
    // Quitar prefijos comunes
    final cleaned = t
        .replaceAll(RegExp(r'^(class|lecture|sesion|sesión|clase)\s+', caseSensitive: false), '')
        .replaceAll(RegExp(r'\s*\(.*?\)\s*'), '')  // quitar "(Aula 3)"
        .trim();
    return cleaned;
  }
}

class CalendarService {
  bool _enabled = false;
  int? _selectedCalendarId;

  bool get enabled => _enabled;
  int? get selectedCalendarId => _selectedCalendarId;

  /// Carga el estado persistido.
  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _enabled = prefs.getBool(_prefsKeyCalendarEnabled) ?? false;
    _selectedCalendarId = prefs.getInt(_prefsKeySelectedCalendarId);
  }

  /// Verifica si el permiso READ_CALENDAR está concedido.
  Future<bool> isPermissionGranted() async {
    if (!_isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('checkCalendarPermission') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Pide el permiso al usuario (muestra el diálogo nativo).
  Future<bool> requestPermission() async {
    if (!_isAndroid) return false;
    try {
      await _channel.invokeMethod<bool>('requestCalendarPermission');
      return await isPermissionGranted();
    } catch (_) {
      return false;
    }
  }

  /// Habilita o deshabilita la integración con Calendar.
  Future<bool> setEnabled(bool enabled) async {
    if (enabled && !await isPermissionGranted()) {
      final granted = await requestPermission();
      if (!granted) return false;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKeyCalendarEnabled, enabled);
    _enabled = enabled;
    return enabled;
  }

  /// Lista los calendarios disponibles en el dispositivo.
  Future<List<CalendarInfo>> listCalendars() async {
    if (!_isAndroid) return [];
    if (!await isPermissionGranted()) return [];
    try {
      final raw = await _channel.invokeMethod<List<dynamic>>('listCalendars');
      if (raw == null) return [];
      return raw.map((e) => CalendarInfo.fromMap(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// Establece el calendario por defecto (sugerir eventos de este).
  Future<void> setSelectedCalendar(int? id) async {
    final prefs = await SharedPreferences.getInstance();
    if (id == null) {
      await prefs.remove(_prefsKeySelectedCalendarId);
    } else {
      await prefs.setInt(_prefsKeySelectedCalendarId, id);
    }
    _selectedCalendarId = id;
  }

  /// v0.37: devuelve el CalendarInfo del calendario seleccionado,
  /// cacheando la lista para no pegarle al sistema cada vez.
  Future<CalendarInfo?> getSelectedCalendarInfo() async {
    if (_selectedCalendarId == null) return null;
    final cals = await listCalendars();
    try {
      return cals.firstWhere((c) => c.id == _selectedCalendarId);
    } catch (_) {
      // El calendario seleccionado ya no existe
      await setSelectedCalendar(null);
      return null;
    }
  }

  /// Lista los eventos entre dos fechas.
  /// v0.37: filtra por el calendario seleccionado (si hay uno guardado).
  Future<List<CalendarEvent>> listEvents({DateTime? from, DateTime? to}) async {
    if (!_isAndroid) return [];
    if (!await isPermissionGranted()) return [];
    from ??= DateTime.now();
    to ??= DateTime.now().add(const Duration(days: 7));
    try {
      // v0.37: pasar el calendarId seleccionado para filtrar en la query
      final raw = await _channel.invokeMethod<List<dynamic>>('listEvents', {
        'startMs': from.millisecondsSinceEpoch,
        'endMs': to.millisecondsSinceEpoch,
        if (_selectedCalendarId != null) 'calendarId': _selectedCalendarId,
      });
      if (raw == null) return [];
      var events = raw.map((e) => CalendarEvent.fromMap(e as Map)).toList();
      // Filtro defensivo en cliente por si el sistema devuelve varios
      if (_selectedCalendarId != null) {
        events = events.where((e) => e.calendarId == _selectedCalendarId).toList();
      }
      return events;
    } catch (_) {
      return [];
    }
  }

  /// Sugiere el evento más probable para "ahora" (dentro de ±30 min).
  Future<CalendarEvent?> suggestCurrentEvent() async {
    final now = DateTime.now();
    final events = await listEvents(
      from: now.subtract(const Duration(minutes: 30)),
      to: now.add(const Duration(minutes: 30)),
    );
    if (events.isEmpty) return null;
    // Ordenar por cercanía al momento actual
    events.sort((a, b) {
      final aDist = (a.start.difference(now).inMinutes).abs();
      final bDist = (b.start.difference(now).inMinutes).abs();
      return aDist.compareTo(bDist);
    });
    return events.first;
  }

  /// v0.34: lista los próximos N eventos (para mostrar en home).
  Future<List<CalendarEvent>> listUpcoming({int limit = 5, int daysAhead = 7}) async {
    if (!_isAndroid) return [];
    if (!await isPermissionGranted()) return [];
    final events = await listEvents(
      from: DateTime.now(),
      to: DateTime.now().add(Duration(days: daysAhead)),
    );
    events.sort((a, b) => a.start.compareTo(b.start));
    return events.take(limit).toList();
  }

  /// v0.34: abre el detalle de un evento en la app de Calendar del sistema.
  Future<bool> openEventDetail(int eventId) async {
    if (!_isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('openEvent', {
        'eventId': eventId,
      }) ?? false;
    } catch (_) {
      return false;
    }
  }

/// Abre la app de Calendar del sistema (para que el usuario la configure).
  Future<bool> openCalendarApp() async {
    if (!_isAndroid) return false;
    try {
      await _channel.invokeMethod<bool>('openCalendarSettings');
      return true;
    } catch (_) {
      return false;
    }
  }
}
