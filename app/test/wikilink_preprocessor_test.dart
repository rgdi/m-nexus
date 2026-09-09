// Tests para WikilinkPreprocessor — v0.48.5.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/screens/note/note_view.dart';

void main() {
  group('WikilinkPreprocessor.process', () {
    test('[[note]] simple → [note](note.md)', () {
      final out = WikilinkPreprocessor.process('Ver [[corazon]]');
      expect(out, 'Ver [corazon](corazon.md)');
    });

    test('múltiples wikilinks en el mismo párrafo', () {
      final out = WikilinkPreprocessor.process(
        'Relacionado: [[Anatomía/corazon]] y [[circulacion]].',
      );
      expect(out, 'Relacionado: [Anatomía/corazon](Anatomía/corazon.md) y [circulacion](circulacion.md).');
    });

    test('[[note|alias]] usa el alias como display', () {
      final out = WikilinkPreprocessor.process('Ver [[corazon|mi corazón]]');
      expect(out, 'Ver [mi corazón](corazon.md)');
    });

    test('mantiene extension .md si ya la tiene', () {
      final out = WikilinkPreprocessor.process('Ver [[Anatomía/corazon.md]]');
      expect(out, 'Ver [Anatomía/corazon.md](Anatomía/corazon.md)');
    });

    test('preserva fragmento #section', () {
      final out = WikilinkPreprocessor.process('Ver [[corazon#cavidades]]');
      expect(out, 'Ver [corazon#cavidades](corazon.md#cavidades)');
    });

    test('[[wikilink vacío]] se preserva como literal', () {
      final out = WikilinkPreprocessor.process('Test [[]] fin');
      expect(out, 'Test [[]] fin');
    });

    test('preserva texto sin wikilinks', () {
      const input = 'Esta es una nota normal sin links.';
      final out = WikilinkPreprocessor.process(input);
      expect(out, input);
    });

    test('preserva wikilink multilínea (no matchea si hay newline)', () {
      final out = WikilinkPreprocessor.process('[[no\nmatch]]');
      expect(out, '[[no\nmatch]]');
    });

    test('markdown image syntax intacta', () {
      final out = WikilinkPreprocessor.process('![alt](image.png)');
      expect(out, '![alt](image.png)');
    });

    test('mezcla de wikilinks y links markdown', () {
      final out = WikilinkPreprocessor.process(
        'Ver [[corazon]] o [mi sitio](https://ejemplo.com).',
      );
      expect(out, 'Ver [corazon](corazon.md) o [mi sitio](https://ejemplo.com).');
    });
  });
}
