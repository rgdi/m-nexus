// Tests para el filtrado de calendario (v0.37).
//
// v0.37: listEvents() ahora filtra por el calendario seleccionado
// (tanto en el lado Dart como en el platform channel).

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/calendar_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Reset prefs Y mock handler antes de cada test
    SharedPreferences.setMockInitialValues({});
  });

  group('CalendarService.listEvents con calendarId', () {
    test('pasa calendarId al platform channel cuando está seleccionado', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      final receivedCalls = <MethodCall>[];

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        receivedCalls.add(call);
        if (call.method == 'checkCalendarPermission') return true;
        if (call.method == 'listEvents') {
          // Devolver 3 eventos de distintos calendarios
          return [
            {
              'id': 1,
              'title': 'Anatomía',
              'description': '',
              'location': '',
              'startMs': 1000,
              'endMs': 2000,
              'calendarId': 5,
            },
            {
              'id': 2,
              'title': 'Fisiología',
              'description': '',
              'location': '',
              'startMs': 3000,
              'endMs': 4000,
              'calendarId': 7,
            },
            {
              'id': 3,
              'title': 'Bioquímica',
              'description': '',
              'location': '',
              'startMs': 5000,
              'endMs': 6000,
              'calendarId': 5,
            },
          ];
        }
        return null;
      });

      // Primero seteo la prefs con el calendarId seleccionado
      SharedPreferences.setMockInitialValues({
        'mnexus.calendar.selected_id': 5,
      });

      final service = CalendarService();
      await service.load(); // carga _selectedCalendarId = 5

      final events = await service.listEvents();

      // Solo deben quedar 2 eventos (los del calendarId 5)
      expect(events.length, 2);
      expect(events.every((e) => e.calendarId == 5), isTrue);
      expect(events.map((e) => e.title), containsAll(['Anatomía', 'Bioquímica']));

      // Verificar que se pasó calendarId al platform channel
      final listCall = receivedCalls.firstWhere((c) => c.method == 'listEvents');
      final args = listCall.arguments as Map;
      expect(args['calendarId'], 5);
    });

    test('no pasa calendarId si no hay calendario seleccionado', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      final receivedCalls = <MethodCall>[];

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        receivedCalls.add(call);
        if (call.method == 'checkCalendarPermission') return true;
        if (call.method == 'listEvents') return [];
        return null;
      });

      // NO hay calendarId seleccionado
      final service = CalendarService();
      await service.load();

      await service.listEvents();

      final listCall = receivedCalls.firstWhere((c) => c.method == 'listEvents');
      final args = listCall.arguments as Map;
      expect(args.containsKey('calendarId'), false);
    });

    test('filtra en cliente por si el sistema devuelve varios calendarios', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'checkCalendarPermission') return true;
        if (call.method == 'listEvents') {
          // El platform channel devuelve TODO (no filtró)
          return [
            {
              'id': 1,
              'title': 'A',
              'description': '',
              'location': '',
              'startMs': 1000,
              'endMs': 2000,
              'calendarId': 5,
            },
            {
              'id': 2,
              'title': 'B',
              'description': '',
              'location': '',
              'startMs': 3000,
              'endMs': 4000,
              'calendarId': 7, // distinto
            },
          ];
        }
        return null;
      });

      // Setear calendarId 5 en prefs antes
      SharedPreferences.setMockInitialValues({
        'mnexus.calendar.selected_id': 5,
      });

      final service = CalendarService();
      await service.load();

      final events = await service.listEvents();

      // Filtro defensivo en cliente: solo quedan los del 5
      expect(events.length, 1);
      expect(events.first.calendarId, 5);
    });

    test('devuelve lista vacía si no hay permiso', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'checkCalendarPermission') return false;
        return null;
      });

      SharedPreferences.setMockInitialValues({
        'mnexus.calendar.selected_id': 5,
      });

      final service = CalendarService();
      await service.load();

      final events = await service.listEvents();
      expect(events, isEmpty);
    });
  });

  group('CalendarService.getSelectedCalendarInfo', () {
    test('devuelve null si no hay calendario seleccionado', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'checkCalendarPermission') return true;
        return [];
      });

      final service = CalendarService();
      await service.load();
      final info = await service.getSelectedCalendarInfo();
      expect(info, isNull);
    });

    test('resetea selección si el calendario ya no existe', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'checkCalendarPermission') return true;
        if (call.method == 'listCalendars') {
          return [
            {
              'id': 99,
              'name': 'Otro calendario',
              'account': 'user@gmail.com',
              'owner': 'user',
              'color': 0xFF0000FF,
              'visible': true,
            },
          ];
        }
        return [];
      });

      SharedPreferences.setMockInitialValues({
        'mnexus.calendar.selected_id': 5, // no está en la lista devuelta
      });

      final service = CalendarService();
      await service.load();
      final info = await service.getSelectedCalendarInfo();
      expect(info, isNull);
      // La prefs debe haberse reseteado
      expect(service.selectedCalendarId, isNull);
    });
  });
}
