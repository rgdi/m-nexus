// Utilidades para hashes (SHA-256 sin dependencias externas, compatible con Dart puro).

import 'dart:typed_data';

// SHA-256 implementation - FIPS 180-4 compliant.
// All internal arithmetic uses unsigned 32-bit (stored as Dart int with masking).
class Sha256 {
  // Constantes K (primeros 32 bits de las partes fraccionarias de las raíces cúbicas de los primeros 64 primos).
  static const List<int> _k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Valores iniciales del hash (primeros 32 bits de las partes fraccionarias
  // de las raíces cuadradas de los primeros 8 primos).
  static const List<int> _initialH = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  // Rotación derecha de 32 bits. Dart's >> is arithmetic on int, so we mask.
  static int _rotr(int x, int n) => ((x >> n) | (x << (32 - n))) & 0xFFFFFFFF;

  static String hash(Uint8List bytes) {
    // v0.29: state machine — reset H to initial values on each call.
    final h = List<int>.from(_initialH);

    final len = bytes.length;
    final bitLen = len * 8;

    // Padding: append 0x80, zeros, then 64-bit big-endian length.
    final paddedLen = ((len + 9 + 63) >> 6) << 6;
    final padded = Uint8List(paddedLen);
    padded.setRange(0, len, bytes);
    padded[len] = 0x80;

    // Length (big-endian 64-bit). For files < 2^32 bytes, high 32 bits are 0.
    final paddedView = ByteData.view(padded.buffer);
    paddedView.setUint32(paddedLen - 8, (bitLen ~/ 0x100000000) & 0xFFFFFFFF);
    paddedView.setUint32(paddedLen - 4, bitLen & 0xFFFFFFFF);

    // Process each 512-bit (64-byte) chunk.
    final w = List<int>.filled(64, 0);
    for (int chunk = 0; chunk < paddedLen; chunk += 64) {
      // Copy chunk into first 16 words w[0..15] (big-endian, as unsigned 32-bit).
      for (int i = 0; i < 16; i++) {
        w[i] = paddedView.getUint32(chunk + i * 4);
      }
      // Extend the first 16 words to 64.
      for (int i = 16; i < 64; i++) {
        final s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ ((w[i - 15] >> 3) & 0xFFFFFFFF);
        final s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ ((w[i - 2] >> 10) & 0xFFFFFFFF);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF;
      }

      // Initialize working variables to current hash value.
      int a = h[0], b = h[1], c = h[2], d = h[3];
      int e = h[4], f = h[5], g = h[6], hh = h[7];

      // Main loop.
      for (int i = 0; i < 64; i++) {
        final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
        final ch = (e & f) ^ ((~e & 0xFFFFFFFF) & g);
        final t1 = (hh + s1 + ch + _k[i] + w[i]) & 0xFFFFFFFF;
        final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
        final mj = (a & b) ^ (a & c) ^ (b & c);
        final t2 = (s0 + mj) & 0xFFFFFFFF;
        hh = g; g = f; f = e;
        e = (d + t1) & 0xFFFFFFFF;
        d = c; c = b; b = a;
        a = (t1 + t2) & 0xFFFFFFFF;
      }

      // Add the compressed chunk to the current hash value.
      h[0] = (h[0] + a) & 0xFFFFFFFF;
      h[1] = (h[1] + b) & 0xFFFFFFFF;
      h[2] = (h[2] + c) & 0xFFFFFFFF;
      h[3] = (h[3] + d) & 0xFFFFFFFF;
      h[4] = (h[4] + e) & 0xFFFFFFFF;
      h[5] = (h[5] + f) & 0xFFFFFFFF;
      h[6] = (h[6] + g) & 0xFFFFFFFF;
      h[7] = (h[7] + hh) & 0xFFFFFFFF;
    }

    // Produce the final hash as a 64-character lowercase hex string.
    return h.map((x) => x.toRadixString(16).padLeft(8, '0')).join();
  }
}

String hashToHex(Uint8List bytes) => Sha256.hash(bytes);
