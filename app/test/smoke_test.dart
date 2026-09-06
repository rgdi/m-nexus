// Smoke test - imports work.
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/vault_service.dart';
import 'package:mnexus_app/services/flashcard_service.dart';
import 'package:mnexus_app/utils/safe_call.dart';
import 'package:mnexus_app/utils/error_codes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('imports compile', () {
    expect(VaultService, isNotNull);
    expect(FlashcardService, isNotNull);
    expect(SafeResult, isNotNull);
    expect(AppError, isNotNull);
    expect(ErrorCategory.net.code, 'NET');
  });
}
