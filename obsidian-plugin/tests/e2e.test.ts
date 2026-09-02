// Tests de E2E encryption (AES-GCM con WebCrypto) y E2EWrapper.

import { describe, it, expect, beforeAll } from "vitest";
import { createE2EManager } from "../src/utils/e2e";
import { E2EWrapper } from "../src/utils/e2eWrapper";

// Storage en memoria para tests
function memStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("E2E encryption", () => {
  it("generate crea una clave", async () => {
    const m = createE2EManager(memStorage());
    expect(m.hasKey()).toBe(false);
    await m.generate();
    expect(m.hasKey()).toBe(true);
  });

  it("encrypt + decrypt roundtrip", async () => {
    const m = createE2EManager(memStorage());
    await m.generate();
    const enc = await m.encrypt("Hola mundo médico 🔒");
    expect(enc.alg).toBe("AES-GCM-256");
    expect(enc.iv).toBeTruthy();
    expect(enc.ct).toBeTruthy();
    expect(enc.ct).not.toBe("Hola mundo médico 🔒");
    const dec = await m.decrypt(enc);
    expect(dec).toBe("Hola mundo médico 🔒");
  });

  it("dos cifrados del mismo texto producen ciphertexts distintos (IV aleatorio)", async () => {
    const m = createE2EManager(memStorage());
    await m.generate();
    const e1 = await m.encrypt("texto");
    const e2 = await m.encrypt("texto");
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ct).not.toBe(e2.ct);
  });

  it("decrypt con clave distinta falla", async () => {
    const m1 = createE2EManager(memStorage());
    await m1.generate();
    const enc = await m1.encrypt("secreto");
    const m2 = createE2EManager(memStorage());
    await m2.generate();
    await expect(m2.decrypt(enc)).rejects.toBeDefined();
  });

  it("exportKey + importKey transfiere la clave entre managers", async () => {
    const m1 = createE2EManager(memStorage());
    await m1.generate();
    const jwk = await m1.exportKey();
    expect(jwk).toBeTruthy();
    const m2 = createE2EManager(memStorage());
    await m2.importKey(jwk!);
    const enc = await m1.encrypt("hola");
    const dec = await m2.decrypt(enc);
    expect(dec).toBe("hola");
  });

  it("passphrase backup: export → import recupera la clave", async () => {
    const m1 = createE2EManager(memStorage());
    await m1.generate();
    const enc = await m1.encrypt("dato");
    const backup = await m1.exportEncryptedWithPassphrase("mi-clave-secreta");
    const m2 = createE2EManager(memStorage());
    await m2.importEncryptedWithPassphrase("mi-clave-secreta", backup);
    const dec = await m2.decrypt(enc);
    expect(dec).toBe("dato");
  });

  it("passphrase incorrecta falla el import", async () => {
    const m1 = createE2EManager(memStorage());
    await m1.generate();
    const backup = await m1.exportEncryptedWithPassphrase("correcta");
    const m2 = createE2EManager(memStorage());
    await expect(m2.importEncryptedWithPassphrase("incorrecta", backup)).rejects.toBeDefined();
  });

  it("clear borra la clave", async () => {
    const m = createE2EManager(memStorage());
    await m.generate();
    expect(m.hasKey()).toBe(true);
    m.clear();
    expect(m.hasKey()).toBe(false);
  });
});

describe("E2EWrapper", () => {
  it("nota sin encrypt pasa tal cual", async () => {
    const m = createE2EManager(memStorage());
    await m.generate();
    const w = new E2EWrapper(m);
    const env = await w.wrap({ path: "a.md", content: "plain", frontmatter: {} });
    expect(env.isEncrypted).toBe(false);
    expect(env.content).toBe("plain");
    const back = await w.unwrap(env);
    expect(back.content).toBe("plain");
  });

  it("nota con encrypt=true se cifra y descifra", async () => {
    const m = createE2EManager(memStorage());
    await m.generate();
    const w = new E2EWrapper(m);
    const env = await w.wrap({ path: "secret.md", content: "dato confidencial", frontmatter: { encrypt: true } });
    expect(env.isEncrypted).toBe(true);
    expect(env.content).toContain("m-nexus-e2e:v1");
    expect(env.content).not.toContain("dato confidencial");
    const back = await w.unwrap(env);
    expect(back.content).toBe("dato confidencial");
  });

  it("nota con encrypt=true pero sin clave lanza error", async () => {
    const m = createE2EManager(memStorage());
    const w = new E2EWrapper(m);
    await expect(w.wrap({ path: "x.md", content: "y", frontmatter: { encrypt: true } })).rejects.toThrow(/clave/);
  });

  it("unwrap maneja marker ausente sin crashear", async () => {
    const m = createE2EManager(memStorage());
    const w = new E2EWrapper(m);
    const back = await w.unwrap({
      path: "broken.md",
      content: "no marker",
      frontmatter: { encrypt: true },
      isEncrypted: true,
    });
    expect(back.content).toBe("no marker");
  });
});
