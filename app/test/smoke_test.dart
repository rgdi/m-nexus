// Smoke test - imports work.
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/vault_service.dart';
import 'package:mnexus_app/utils/safe_call.dart';
import 'package:mnexus_app/utils/error_codes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('smoke: imports compile + safeCall OK', () {
    expect(VaultService, isNotNull);
    expect(SafeResult, isNotNull);
    expect(AppError, isNotNull);
    expect(ErrorCategory.net.code, 'NET');

    final r = safeCall<int>(
      component: 'smoke', code: 'EC-SMOKE-001', message: 'smoke',
      op: () => 42);
    expect(r.success, isTrue);
    expect(r.value, 42);
  });
}
