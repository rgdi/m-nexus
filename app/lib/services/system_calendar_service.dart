// system_calendar_service.dart — bridge al calendar del sistema Android.
//
// v0.62.13: autosync con calendar. Lee eventos del Content Provider de
// Android (no del backend de M-NEXUS) y los expone al Plan screen como
// fuente complementaria a `ExamsService`. No escribe nada — solo lee.
//
// Filtra eventos con keywords académicos (examen/parcial/final/quiz/test)
// para destacar los relevantes, pero también devuelve los demás si el
// usuario quiere ver toda su agenda.

import 'package:flutter/services.dart';
import '../../services/logger.dart';

class SystemCalendarEvent {
  final int id;
  final String title;
  final String description;
  final DateTime dtStart;
  final DateTime? dtEnd;
  final String location;
  final int calendarId;
  final bool isAcademic;

  const SystemCalendarEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.dtStart,
    this.dtEnd,
    required this.location,
    required this.calendarId,
    required this.isAcademic,
  });

  factory SystemCalendarEvent.fromMap(Map<dynamic, dynamic> m) {
    final title = (m['title'] ?? '').toString();
    final lower = title.toLowerCase();
    const keywords = [
      'examen', 'parcial', 'final', 'quiz', 'test', 'evaluación',
      'evaluacion', 'prueba', 'control', 'expo', 'presentación',
      'presentacion', 'taller', 'laboratorio', 'lab', 'seminar',
    ];
    final isAcademic = keywords.any(lower.contains);
    return SystemCalendarEvent(
      id: (m['id'] as num?)?.toInt() ?? 0,
      title: title,
      description: (m['description'] ?? '').toString(),
      dtStart: DateTime.fromMillisecondsSinceEpoch(
        (m['dtStart'] as num?)?.toInt() ?? 0,
      ),
      dtEnd: m['dtEnd'] != null
          ? DateTime.fromMillisecondsSinceEpoch((m['dtEnd'] as num).toInt())
          : null,
      location: (m['location'] ?? '').toString(),
      calendarId: (m['calendarId'] as num?)?.toInt() ?? 0,
      isAcademic: isAcademic,
    );
  }
}

class SystemCalendarService {
  static const _channel = MethodChannel('com.mnexus.app/calendar');

  Future<bool> hasPermission() async {
    try {
      final ok = await _channel.invokeMethod<bool>('checkCalendarPermission');
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> requestPermission() async {
    try {
      await _channel.invokeMethod('requestCalendarPermission');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<List<SystemCalendarEvent>> listEvents({
    DateTime? from,
    DateTime? to,
  }) async {
    final log = AdvancedLogger.instance;
    try {
      final fromMs = (from ?? DateTime.now()).millisecondsSinceEpoch;
      final toMs = (to ?? DateTime.now().add(const Duration(days: 30)))
          .millisecondsSinceEpoch;
      final raw = await _channel.invokeMethod<List<dynamic>>(
        'listSystemEvents',
        {'startMs': fromMs, 'endMs': toMs},
      );
      if (raw == null) return [];
      final events = raw
          .whereType<Map>()
          .map((m) => SystemCalendarEvent.fromMap(m))
          .toList();
      log.debug('system_calendar', 'events loaded', context: {'count': events.length});
      return events;
    } catch (e) {
      log.warn('system_calendar', 'listEvents failed', error: e.toString());
      return [];
    }
  }
}
