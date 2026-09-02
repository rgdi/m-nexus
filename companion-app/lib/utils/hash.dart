// Utilidades para hashes (SHA-256 sin dependencias externas, compatible con Dart puro).

import 'dart:typed_data';

// SHA-256 implementation - simplified for the installer use case
// Based on the SHA-256 specification (FIPS 180-4)
class Sha256 {
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

  // v0.28: BUG FIX — _h debe ser mutable (se modifica por cada chunk).
  // Antes era const lo que causaba "Unsupported operation" en runtime.
  static final List<int> _h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  static int _rotr(int x, int n) => ((x >> n) | (x << (32 - n))) & 0xFFFFFFFF;

  static String hash(Uint8List bytes) {
    // v0.28: resetear _h a los valores iniciales (state machine).
    _h[0] = 0x6a09e667; _h[1] = 0xbb67ae85;
    _h[2] = 0x3c6ef372; _h[3] = 0xa54ff53a;
    _h[4] = 0x510e527f; _h[5] = 0x9b05688c;
    _h[6] = 0x1f83d9ab; _h[7] = 0x5be0cd19;

    final len = bytes.length;
    final bitLen = len * 8;

    // Padding
    final paddedLen = ((len + 9 + 63) >> 6) << 6;
    final padded = Uint8List(paddedLen);
    padded.setRange(0, len, bytes);
    padded[len] = 0x80;

    // Length (big-endian 64-bit, but we only support up to 2^32-1 bytes)
    final paddedView = ByteData.view(padded.buffer);
    paddedView.setUint32(paddedLen - 8, (bitLen ~/ 0x100000000) & 0xFFFFFFFF);
    paddedView.setUint32(paddedLen - 4, bitLen & 0xFFFFFFFF);

    final w = Int32List(64);
    for (int chunk = 0; chunk < paddedLen; chunk += 64) {
      for (int i = 0; i < 16; i++) {
        w[i] = paddedView.getUint32(chunk + i * 4);
      }
      for (int i = 16; i < 64; i++) {
        final s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        final s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF;
      }
      int a = _h[0], b = _h[1], c = _h[2], d = _h[3];
      int e = _h[4], f = _h[5], g = _h[6], hh = _h[7];
      for (int i = 0; i < 64; i++) {
        final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
        final ch = (e & f) ^ ((~e & 0xFFFFFFFF) & g);
        final t1 = (hh + s1 + ch + _k[i] + w[i]) & 0xFFFFFFFF;
        final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
        final mj = (a & b) ^ (a & c) ^ (b & c);
        final t2 = (s0 + mj) & 0xFFFFFFFF;
        hh = g; g = f; f = e; e = (d + t1) & 0xFFFFFFFF;
        d = c; c = b; b = a; a = (t1 + t2) & 0xFFFFFFFF;
      }
      _h[0] = (_h[0] + a) & 0xFFFFFFFF;
      _h[1] = (_h[1] + b) & 0xFFFFFFFF;
      _h[2] = (_h[2] + c) & 0xFFFFFFFF;
      _h[3] = (_h[3] + d) & 0xFFFFFFFF;
      _h[4] = (_h[4] + e) & 0xFFFFFFFF;
      _h[5] = (_h[5] + f) & 0xFFFFFFFF;
      _h[6] = (_h[6] + g) & 0xFFFFFFFF;
      _h[7] = (_h[7] + hh) & 0xFFFFFFFF;
    }

    return _h.map((x) => x.toRadixString(16).padLeft(8, '0')).join();
  }
}

String hashToHex(Uint8List bytes) => Sha256.hash(bytes);
