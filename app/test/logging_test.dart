// Tests para el sistema de logging (imports, compilación).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/utils/error_codes.dart';
import 'package:mnexus_app/utils/safe_call.dart';
import 'package:mnexus_app/services/logger.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('AdvancedLogger.instance es singleton', () {
    final l1 = AdvancedLogger.instance;
    final l2 = AdvancedLogger.instance;
    expect(identical(l1, l2), isTrue);
  });

  test('ErrorCategory.net es NET', () {
    expect(ErrorCategory.net.code, 'NET');
    expect(ErrorCategory.net.description, isNotEmpty);
  });

  test('AppError.toString incluye [CODE]', () {
    final e = AppError.life('EC-LIFE-TEST', 'test lifecycle');
    final s = e.toString();
    expect(s, contains('EC-LIFE-TEST'));
  });

  test('safeCall devuelve SafeResult.fail con AppError', () {
    final r = safeCall<int>(
      component: 'test',
      code: 'EC-TEST-1',
      message: 'test',
      op: () => throw StateError('xxx'),
    );
    expect(r.success, false);
    expect(r.error, isA<AppError>());
  });

  test('Logger no throwea con context null', () {
    AdvancedLogger.instance.info('test', 'no context', context: null);
  });
}
