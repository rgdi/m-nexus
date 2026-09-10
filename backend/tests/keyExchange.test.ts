// keyExchange.test.ts: tests de ECDH key exchange (v0.61.1)
import { describe, it, expect } from "vitest";
import { getKeyExchangeService } from "../src/services/keyExchangeService.js";
import { randomBytes } from "node:crypto";

describe("KeyExchangeService (v0.61.1)", () => {
  it("genera par de claves con fingerprint", () => {
    const svc = getKeyExchangeService();
    const kp = svc.generateKeyPair();
    expect(kp.publicKey.length).toBeGreaterThan(20);
    expect(kp.privateKey.length).toBeGreaterThan(20);
    expect(kp.fingerprint.length).toBe(16);
  });

  it("dos pares de claves distintos", () => {
    const svc = getKeyExchangeService();
    const a = svc.generateKeyPair();
    const b = svc.generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("computeSharedSecret es simetrico", () => {
    const svc = getKeyExchangeService();
    const a = svc.generateKeyPair();
    const b = svc.generateKeyPair();
    const sAB = svc.computeSharedSecret(a.privateKey, b.publicKey);
    const sBA = svc.computeSharedSecret(b.privateKey, a.publicKey);
    expect(sAB.toString("hex")).toBe(sBA.toString("hex"));
    expect(sAB.length).toBe(32); // P-256 shared secret
  });

  it("encrypt + decrypt roundtrip", () => {
    const svc = getKeyExchangeService();
    const a = svc.generateKeyPair();
    const b = svc.generateKeyPair();
    const shared = svc.computeSharedSecret(a.privateKey, b.publicKey);
    const { message, salt } = svc.encrypt(shared, "hola mundo");
    const dec = svc.decrypt(shared, message, Buffer.from(salt, "base64"));
    expect(dec).toBe("hola mundo");
  });

  it("encrypt produce IV unico", () => {
    const svc = getKeyExchangeService();
    const a = svc.generateKeyPair();
    const b = svc.generateKeyPair();
    const shared = svc.computeSharedSecret(a.privateKey, b.publicKey);
    const r1 = svc.encrypt(shared, "msg");
    const r2 = svc.encrypt(shared, "msg");
    expect(r1.message.nonce).not.toBe(r2.message.nonce);
    expect(r1.message.ciphertext).not.toBe(r2.message.ciphertext);
  });

  it("fingerprint de publica", () => {
    const svc = getKeyExchangeService();
    const kp = svc.generateKeyPair();
    const fp1 = svc.fingerprint(kp.publicKey);
    const fp2 = svc.fingerprint(kp.publicKey);
    expect(fp1).toBe(fp2);
    expect(fp1).toBe(kp.fingerprint);
  });

  it("sign + verify con HMAC", () => {
    const svc = getKeyExchangeService();
    const kp = svc.generateKeyPair();
    const sig = svc.sign(kp.privateKey, "datos");
    expect(sig.length).toBeGreaterThan(20);
    const valid = svc.verify(kp.publicKey, "datos", sig);
    expect(valid).toBe(true);
  });

  it("AES-GCM detecta tampering", () => {
    const svc = getKeyExchangeService();
    const a = svc.generateKeyPair();
    const b = svc.generateKeyPair();
    const shared = svc.computeSharedSecret(a.privateKey, b.publicKey);
    const { message, salt } = svc.encrypt(shared, "hola");
    // Tweak ciphertext
    const tampered = { ...message, ciphertext: message.ciphertext.slice(0, -4) + "AAAA" };
    const saltBuf = Buffer.from(salt, "base64");
    expect(() => svc.decrypt(shared, tampered, saltBuf)).toThrow();
  });
});
