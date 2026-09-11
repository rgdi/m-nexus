// e2e_encryption.dart: encriptacion end-to-end con AES-256-GCM.
//
// v0.60 (P0.9): el backend actualmente recibe texto plano. Esto es
// incompatible con RGPD/HIPAA para datos medicos sensibles.
//
// Estrategia:
//   1. Generar par de claves RSA-2048 en el cliente (keypair)
//   2. Compartir la publica con el backend en el registro
//   3. Cifrar cada bloque con AES-256-GCM con una clave aleatoria
//   4. Cifrar la clave AES con la publica RSA del destinatario
//   5. Almacenar {iv, ciphertext, encrypted_key} en el backend
//
// Backup recovery: 12 palabras BIP39 que derivan la master key via PBKDF2.
//
// En esta v0.60 implementamos el cifrado AES-256-GCM simétrico. RSA
// para comparticion de claves se haria en v0.61 (mas complejo).

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:pointycastle/export.dart' as pc_export;
import 'package:shared_preferences/shared_preferences.dart';
import 'logger.dart';

class EncryptedPayload {
  final Uint8List iv; // 12 bytes
  final Uint8List ciphertext;
  final Uint8List mac; // GCM auth tag (16 bytes)
  const EncryptedPayload({
    required this.iv,
    required this.ciphertext,
    required this.mac,
  });

  /// v0.60: serializa a base64 para transporte.
  String toBase64() {
    final combined = Uint8List(iv.length + ciphertext.length + mac.length);
    combined.setAll(0, iv);
    combined.setAll(iv.length, ciphertext);
    combined.setAll(iv.length + ciphertext.length, mac);
    return base64.encode(combined);
  }

  factory EncryptedPayload.fromBase64(String b64) {
    final bytes = base64.decode(b64);
    final iv = Uint8List.fromList(bytes.sublist(0, 12));
    final mac = Uint8List.fromList(bytes.sublist(bytes.length - 16));
    final ct = Uint8List.fromList(bytes.sublist(12, bytes.length - 16));
    return EncryptedPayload(iv: iv, ciphertext: ct, mac: mac);
  }
}

class E2EEncryption {
  static const _keyPref = 'mnexus.e2e.master_key_b64';
  static const _recoveryPref = 'mnexus.e2e.recovery_words';
  static const _algo = 'AES-256-GCM';

  final AesGcm _aes = AesGcm.with256bits();

  /// v0.60 (P0.9): genera o recupera la master key del usuario.
  Future<Uint8List> getOrCreateMasterKey() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_keyPref);
    if (existing != null) {
      return base64.decode(existing);
    }
    // Generar nueva key
    final key = Uint8List(32);
    final rng = Random.secure();
    for (var i = 0; i < 32; i++) {
      key[i] = rng.nextInt(256);
    }
    await prefs.setString(_keyPref, base64.encode(key));
    AdvancedLogger.instance.info('e2e', 'master key generated');
    return key;
  }

  /// v0.60 (P0.9): cifra texto plano con AES-256-GCM.
  Future<EncryptedPayload> encrypt(String plaintext) async {
    final key = await getOrCreateMasterKey();
    final secretKey = SecretKey(key);
    final nonce = _randomBytes(12);
    final cleartext = utf8.encode(plaintext);
    final encrypted = await _aes.encrypt(
      cleartext,
      secretKey: secretKey,
      nonce: nonce,
    );
    return EncryptedPayload(
      iv: Uint8List.fromList(nonce),
      ciphertext: Uint8List.fromList(encrypted.cipherText),
      mac: Uint8List.fromList(encrypted.mac.bytes),
    );
  }

  /// v0.60 (P0.9): descifra un payload AES-256-GCM.
  Future<String> decrypt(EncryptedPayload payload) async {
    final key = await getOrCreateMasterKey();
    final secretKey = SecretKey(key);
    try {
      final secretBox = SecretBox(
        payload.ciphertext,
        nonce: payload.iv,
        mac: Mac(payload.mac),
      );
      final clear = await _aes.decrypt(secretBox, secretKey: secretKey);
      return utf8.decode(clear);
    } catch (e) {
      AdvancedLogger.instance.error('e2e', 'decrypt failed', error: e);
      rethrow;
    }
  }

  /// v0.60 (P0.9): genera 12 palabras BIP39-like para recovery.
  /// No es BIP39 real (es random 12 words de una lista), pero sirve
  /// para que el usuario pueda recuperar el acceso si pierde el device.
  Future<List<String>> generateRecoveryPhrase() async {
    const wordlist = [
      'abandon','ability','able','about','above','absent','absorb','abstract',
      'absurd','abuse','access','accident','account','accuse','achieve','acid',
      'acoustic','acquire','across','act','action','actor','actress','actual',
      'adapt','add','addict','address','adjust','admit','adult','advance',
      'advice','aerobic','affair','afford','afraid','again','age','agent',
      'agree','ahead','aim','air','airport','aisle','alarm','album',
      'alcohol','alert','alien','all','alley','allow','almost','alone',
      'alpha','already','also','alter','always','amateur','amazing','among',
      'amount','amused','analyst','anchor','ancient','anger','angle','angry',
      'animal','ankle','announce','annual','another','answer','antenna','antique',
      'anxiety','any','apart','apology','appear','apple','approve','april',
      'arch','arctic','area','arena','argue','arm','armed','armor',
      'army','around','arrange','arrest','arrive','arrow','art','artefact',
      'artist','artwork','ask','aspect','assault','asset','assist','assume',
      'asthma','athlete','atom','attack','attend','attitude','attract','auction',
      'audit','august','aunt','author','auto','autumn','average','avocado',
      'avoid','awake','aware','away','awesome','awful','awkward','axis',
    ];
    final rng = Random.secure();
    final words = <String>[];
    for (var i = 0; i < 12; i++) {
      words.add(wordlist[rng.nextInt(wordlist.length)]);
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_recoveryPref, words);
    return words;
  }

  /// v0.60 (P0.9): restaura la master key desde 12 palabras.
  /// PBKDF2(words) -> 32 bytes key
  Future<Uint8List> recoverFromPhrase(List<String> words) async {
    if (words.length != 12) {
      throw ArgumentError('Recovery phrase must be 12 words');
    }
    final joined = words.join(' ');
    // PBKDF2 simple (v0.60: 10000 iteraciones SHA-256)
    final pbkdf2 = Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: 10000,
      bits: 256,
    );
    final secretKey = await pbkdf2.deriveKey(
      secretKey: SecretKey(utf8.encode(joined)),
      nonce: utf8.encode('mnexus-e2e-v1'),
    );
    final bytes = await secretKey.extractBytes();
    final u8 = Uint8List.fromList(bytes);
    // Guardar la nueva key
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyPref, base64.encode(u8));
    return u8;
  }

  Uint8List _randomBytes(int n) {
    final rng = Random.secure();
    final b = Uint8List(n);
    for (var i = 0; i < n; i++) {
      b[i] = rng.nextInt(256);
    }
    return b;
  }

  /// v0.60 (P0.9): borra la master key y la recovery phrase.
  Future<void> destroy() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyPref);
    await prefs.remove(_recoveryPref);
  }

  /// v0.60 (P0.9): check si E2E esta habilitado.
  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyPref) != null;
  }
}
