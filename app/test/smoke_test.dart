import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/flashcard_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('FlashcardService class exists', () {
    expect(FlashcardService, isNotNull);
  });
}
