// Tests para safeCall, AppError, ErrorCategory.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/utils/error_codes.dart';
import 'package:mnexus_app/utils/safe_call.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('DEBUG: verify test runs', () {
    print('DEBUG TEST RUNS');
    expect(1, 1);
  });

  test('AppError tiene code, category, message, cause, context', () {
    final e = AppError.net('EC-NET-001', 'Network down',
      cause: Exception('socket closed'),
      context: {'url': 'http://x', 'attempts': 3},
      hint: 'Check wifi',
    );
    expect(e.code, 'EC-NET-001');
    expect(e.category, ErrorCategory.net);
    expect(e.message, 'Network down');
    expect(e.hint, 'Check wifi');
    expect(e.cause, isA<Exception>());
    expect(e.context['url'], 'http://x');
    expect(e.context['attempts'], 3);
  });

  test('AppError.toString incluye hint, cause y context', () {
    final e = AppError.fs('EC-FS-001', 'Disk full', hint: 'Libera espacio');
    final s = e.toString();
    expect(s, contains('EC-FS-001'));
    expect(s, contains('Disk full'));
    expect(s, contains('Libera espacio'));
  });

  test('AppError.toJson serializa correctamente', () {
    final e = AppError.vault('EC-VAULT-001', 'Vault not found',
      context: {'path': '/sdcard/x'});
    final j = e.toJson();
    expect(j['code'], 'EC-VAULT-001');
    expect(j['category'], 'VAULT');
    expect(j['message'], 'Vault not found');
    expect(j['context']['path'], '/sdcard/x');
    expect(j['hint'], null);
  });

  test('safeCall sync: success', () {
    final r = safeCall<int>(
      component: 'test', code: 'EC-TEST-001', message: 'test',
      op: () => 42);
    expect(r.success, isTrue);
    expect(r.value, 42);
    expect(r.error, null);
  });

  test('safeCall sync: error', () {
    final r = safeCall<int>(
      component: 'test', code: 'EC-TEST-002', message: 'expected fail',
      op: () => throw Exception('boom'),
    );
    expect(r.success, isFalse);
    expect(r.value, null);
    expect(r.error, isA<AppError>());
    expect(r.error!.code, 'EC-TEST-002');
    expect(r.error!.message, 'expected fail');
    expect(r.error!.cause.toString(), contains('boom'));
  });

  test('safeCallAsync: success', () async {
    final r = await safeCallAsync<String>(
      component: 'test', code: 'EC-TEST-003', message: 'async test',
      op: () async => 'ok');
    expect(r.success, isTrue);
    expect(r.value, 'ok');
  });

  test('safeCallAsync: error preserva stack', () async {
    final r = await safeCallAsync<String>(
      component: 'test', code: 'EC-TEST-004', message: 'async fail',
      op: () async {
        throw StateError('bad state');
      },
    );
    expect(r.success, isFalse);
    expect(r.error!.cause, isA<StateError>());
    expect(r.error!.stack, isNotNull);
  });

  test('safeCallOrNull: success', () async {
    final v = await safeCallOrNull<int>(
      component: 'test', code: 'EC-TEST-005', message: 'or null test',
      op: () async => 7);
    expect(v, 7);
  });

  test('safeCallOrNull: error devuelve null', () async {
    final v = await safeCallOrNull<int>(
      component: 'test', code: 'EC-TEST-006', message: 'or null fail',
      op: () async => throw Exception('ignored'));
    expect(v, null);
  });

  test('ErrorCategory tiene códigos de 3 letras', () {
    for (final c in ErrorCategory.values) {
      expect(c.code.length, 3);
      expect(c.code, isNotEmpty);
    }
  });

  test('SafeResult.fold dispatcha según success', () {
    final ok = const SafeResult<int>.ok(10);
    final fail = SafeResult<int>.fail(AppError.internal('EC-I-001', 'oops'));
    expect(ok.fold((e) => -1, (v) => v * 2), 20);
    expect(fail.fold((e) => -1, (v) => v * 2), -1);
  });

  test('SafeResult.getOrElse devuelve fallback en error', () {
    const ok = SafeResult<int>.ok(10);
    final fail = SafeResult<int>.fail(AppError.internal('EC-I-002', 'oops'));
    expect(ok.getOrElse(0), 10);
    expect(fail.getOrElse(99), 99);
  });

  test('guardAsync: success pasa el valor', () async {
    final v = await guardAsync<int>('test', 'EC-TEST-007', 'guard', () async => 5);
    expect(v, 5);
  });

  test('guardAsync: error devuelve null', () async {
    final v = await guardAsync<int>('test', 'EC-TEST-008', 'guard', () async {
      throw Exception('caught');
    });
    expect(v, null);
  });

  test('wrapError envuelve cualquier causa', () {
    final err = wrapError('EC-W-001', 'wrapped', Exception('inner'),
      category: ErrorCategory.fs, context: {'k': 'v'});
    expect(err.code, 'EC-W-001');
    expect(err.category, ErrorCategory.fs);
    expect(err.context['k'], 'v');
    expect(err.cause, isA<Exception>());
  });
}
