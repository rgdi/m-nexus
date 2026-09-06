// Tests mínimos del sistema de logging (sin tocar vault/flashcard).
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/utils/safe_call.dart';
import 'package:mnexus_app/utils/error_codes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('ErrorCategory tiene códigos', () {
    expect(ErrorCategory.net.code, 'NET');
    expect(ErrorCategory.fs.code, 'FS');
    expect(ErrorCategory.life.code, 'LIFECYCLE');
  });

  test('AppError.net', () {
    final e = AppError.net('EC-NET-T', 'test', hint: 'check wifi');
    expect(e.code, 'EC-NET-T');
    expect(e.category, ErrorCategory.net);
    expect(e.hint, 'check wifi');
  });

  test('safeCall success', () {
    final r = safeCall<int>(component: 't', code: 'EC-T-1', message: 't', op: () => 5);
    expect(r.success, true);
    expect(r.value, 5);
  });

  test('safeCall fail', () {
    final r = safeCall<int>(component: 't', code: 'EC-T-2', message: 't',
      op: () => throw StateError('oops'));
    expect(r.success, false);
    expect(r.error, isA<AppError>());
  });
}
