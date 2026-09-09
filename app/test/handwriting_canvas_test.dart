// Tests para HandwritingCanvas.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/widgets/handwriting_canvas.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Stroke serialization', () {
    test('toJson/fromJson roundtrip preserva puntos y color', () {
      final s = Stroke(
        points: [const Offset(10, 20), const Offset(30, 40), const Offset(50, 60)],
        color: Colors.red,
        width: 3.0,
        tool: 'pen',
      );
      final j = s.toJson();
      expect(j['tool'], 'pen');
      expect(j['color'], Colors.red.value);
      expect(j['width'], 3.0);
      expect((j['points'] as List).length, 3);

      final restored = Stroke.fromJson(j);
      expect(restored.points.length, 3);
      expect(restored.points[0], const Offset(10, 20));
      expect(restored.color.value, Colors.red.value);
      expect(restored.tool, 'pen');
    });
  });

  group('HandwritingCanvas', () {
    testWidgets('renderiza sin strokes iniciales', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 300,
            height: 300,
            child: HandwritingCanvas(),
          ),
        ),
      ));
      // Toolbar visible
      expect(find.byIcon(Icons.edit), findsOneWidget);
      expect(find.byIcon(Icons.brush), findsOneWidget);
      expect(find.byIcon(Icons.cleaning_services), findsOneWidget);
    });

    testWidgets('undo button disabled sin strokes', (tester) async {
      final key = GlobalKey<HandwritingCanvasState>();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 300,
            height: 300,
            child: HandwritingCanvas(key: key, onChanged: (s) {}),
          ),
        ),
      ));

      // Strokes vacíos
      expect(key.currentState!.strokes, isEmpty);
      expect(find.byIcon(Icons.undo), findsOneWidget);

      // Initial undo button should be disabled (empty stack).
      final undoBtn = tester.widget<IconButton>(
        find.ancestor(of: find.byIcon(Icons.undo), matching: find.byType(IconButton)).first,
      );
      expect(undoBtn.onPressed, isNull);
    });

    testWidgets('clear() resetea strokes y notifica onChanged', (tester) async {
      final key = GlobalKey<HandwritingCanvasState>();
      final received = <List<Stroke>>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 300,
            height: 300,
            child: HandwritingCanvas(
              key: key,
              initialStrokes: [
                Stroke(points: [const Offset(1, 1)], color: Colors.black, width: 3, tool: 'pen'),
              ],
              onChanged: (s) => received.add(List.of(s)),
            ),
          ),
        ),
      ));

      key.currentState!.clear();
      await tester.pump();
      expect(key.currentState!.strokes, isEmpty);
      expect(received.last, isEmpty);
    });
  });
}
