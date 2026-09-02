// v0.28: Tests del SHA-256 (compatibles con Dart puro).
// Hash vectors calculados con Python hashlib (estándar NIST FIPS 180-4).

import 'package:flutter_test/flutter_test.dart';
import 'dart:typed_data';
import 'package:mnexus_installer/utils/hash.dart';

void main() {
  group('Sha256', () {
    test('hash de string vacío', () {
      final bytes = Uint8List(0);
      final result = hashToHex(bytes);
      expect(result, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    test('hash de "a"', () {
      final bytes = Uint8List.fromList([0x61]);
      final result = hashToHex(bytes);
      expect(result, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    });

    test('hash de "abc"', () {
      final bytes = Uint8List.fromList('abc'.codeUnits);
      final result = hashToHex(bytes);
      expect(result, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    test('hash de "hello"', () {
      final bytes = Uint8List.fromList('hello'.codeUnits);
      final result = hashToHex(bytes);
      expect(result, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    test('hash determinístico: mismo input → mismo output', () {
      final bytes = Uint8List.fromList('M-NEXUS'.codeUnits);
      final h1 = hashToHex(bytes);
      final h2 = hashToHex(bytes);
      expect(h1, h2);
    });

    test('hash stateless: llamada 1 no afecta llamada 2', () {
      // v0.28: BUG FIX — _h debe resetearse al inicio de cada hash()
      final h1 = hashToHex(Uint8List.fromList('hello'.codeUnits));
      final h2 = hashToHex(Uint8List.fromList('hello'.codeUnits));
      expect(h1, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
      expect(h2, h1);
    });

    test('hashes de inputs distintos son distintos', () {
      final a = hashToHex(Uint8List.fromList('a'.codeUnits));
      final b = hashToHex(Uint8List.fromList('b'.codeUnits));
      expect(a, isNot(b));
    });
  });
}
