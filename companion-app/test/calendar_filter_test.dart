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
    SharedPreferences.setMockInitialValues({});
    // Clear mock handler
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('com.mnexus.installer/calendar'),
      null,
    );
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
              'calendarId': 5,
            },
          ];
        }
        return null;
      });

      // Setear el calendarId 5 vía setSelectedCalendar
      // (esto setea _selectedCalendarId directamente en memoria)
      final service = CalendarService();
      await service.setSelectedCalendar(5);

      // Llamar a listEvents
      final events = await service.listEvents();

      // Debe haber 2 eventos (los del calendarId 5)
      expect(events.length, 2);

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

      // NO se llama setSelectedCalendar
      final service = CalendarService();

      await service.listEvents();

      // Verificar que NO se pasó calendarId
      expect(receivedCalls.length, greaterThan(0),
          reason: 'Should have called the platform channel');
      final listCall = receivedCalls.firstWhere((c) => c.method == 'listEvents');
      final args = listCall.arguments as Map;
      expect(args.containsKey('calendarId'), false,
          reason: 'calendarId should not be in arguments when no calendar selected');
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

      final service = CalendarService();
      await service.setSelectedCalendar(5);

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

      final service = CalendarService();
      await service.setSelectedCalendar(5);

      final events = await service.listEvents();
      expect(events, isEmpty);
    });
  });

  group('CalendarService.setSelectedCalendar', () {
    test('persiste en SharedPreferences', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final service = CalendarService();
      await service.setSelectedCalendar(42);
      expect(service.selectedCalendarId, 42);

      // Cargar de nuevo (simular restart)
      final service2 = CalendarService();
      await service2.load();
      expect(service2.selectedCalendarId, 42);
    });

    test('puede limpiar la selección con null', () async {
      const channel = MethodChannel('com.mnexus.installer/calendar');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final service = CalendarService();
      await service.setSelectedCalendar(42);
      await service.setSelectedCalendar(null);
      expect(service.selectedCalendarId, isNull);
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

      // Setear calendarId 5 que NO está en la lista
      final service = CalendarService();
      await service.setSelectedCalendar(5);
      expect(service.selectedCalendarId, 5);

      final info = await service.getSelectedCalendarInfo();
      expect(info, isNull);
      // La selección debe haberse reseteado
      expect(service.selectedCalendarId, isNull);
    });
  });
}
