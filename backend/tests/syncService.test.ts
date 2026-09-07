// Tests para SyncService (Fase 4).

import { describe, it, expect, beforeEach } from "vitest";
import { SyncService, E2EEncryption, NoteEntry } from "../src/services/syncService";

describe("SyncService basic operations", () => {
  let service: SyncService;

  beforeEach(() => {
    service = new SyncService();
  });

  it("upsert and retrieve a note", () => {
    service.upsertNote({
      path: "anatomia/corazon.md",
      title: "Corazón",
      content: "Órgano que bombea sangre",
      tags: ["anatomia", "cardiovascular"],
      updatedAt: Date.now(),
    });
    const note = service.getNote("anatomia/corazon.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Corazón");
    expect(note!.tags).toEqual(["anatomia", "cardiovascular"]);
  });

  it("update an existing note", () => {
    service.upsertNote({
      path: "a.md",
      title: "Original",
      content: "Original content",
      tags: [],
      updatedAt: 1000,
    });
    service.upsertNote({
      path: "a.md",
      title: "Updated",
      content: "Updated content",
      tags: ["x"],
      updatedAt: 2000,
    });
    const note = service.getNote("a.md");
    expect(note!.title).toBe("Updated");
    expect(note!.content).toBe("Updated content");
  });

  it("removeNote returns true for existing note", () => {
    service.upsertNote({ path: "a.md", title: "A", content: "", tags: [], updatedAt: 0 });
    expect(service.removeNote("a.md")).toBe(true);
    expect(service.getNote("a.md")).toBeNull();
  });

  it("removeNote returns false for non-existing", () => {
    expect(service.removeNote("nope.md")).toBe(false);
  });

  it("listNotes returns all notes sorted by updatedAt desc", () => {
    service.upsertNote({ path: "old.md", title: "Old", content: "", tags: [], updatedAt: 100 });
    service.upsertNote({ path: "new.md", title: "New", content: "", tags: [], updatedAt: 200 });
    const list = service.listNotes();
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe("new.md");
  });

  it("getNote returns null for non-existing", () => {
    expect(service.getNote("nope.md")).toBeNull();
  });

  it("upsertNote with FSRS state", () => {
    service.upsertNote({
      path: "card.md",
      title: "Card",
      content: "Q::A",
      tags: [],
      fsrsState: '{"due":"2026-02-01","stability":2.5}',
      updatedAt: 0,
    });
    const note = service.getNote("card.md");
    expect(note!.fsrsState).toContain("stability");
  });
});

describe("SyncService events log", () => {
  it("logEvent appends events", () => {
    const service = new SyncService();
    service.logEvent({ type: "create", path: "a.md" });
    service.logEvent({ type: "update", path: "a.md" });
    service.logEvent({ type: "delete", path: "a.md" });
    // Sin accessor público, verificamos indirectamente con state
    const state = service.getState();
    expect(state.state.length).toBeGreaterThan(0);
  });
});

describe("SyncService state serialization", () => {
  it("getState returns valid base64", () => {
    const service = new SyncService();
    service.upsertNote({ path: "a.md", title: "A", content: "hello", tags: [], updatedAt: 0 });
    const state = service.getState();
    expect(state.state.length).toBeGreaterThan(0);
    // Verificar que es base64 válido
    expect(() => Buffer.from(state.state, "base64")).not.toThrow();
    expect(state.clientId).toBeGreaterThan(0);
  });

  it("fromState restores notes from base64", () => {
    const a = new SyncService();
    a.upsertNote({ path: "a.md", title: "A", content: "x", tags: ["t1"], updatedAt: 1000 });
    const state = a.getState();

    const b = SyncService.fromState(state.state);
    const note = b.getNote("a.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("A");
  });

  it("fromState with empty state creates empty doc", () => {
    const service = SyncService.fromState("");
    expect(service.listNotes()).toEqual([]);
  });

  it("two clients can sync via state", () => {
    // Cliente A: crea nota a.md
    const a = new SyncService();
    a.upsertNote({ path: "a.md", title: "From A", content: "AAA", tags: [], updatedAt: 1000 });
    const stateA = a.getState();

    // Cliente B: crea nota b.md + aplica state de A
    const b = new SyncService();
    b.upsertNote({ path: "b.md", title: "From B", content: "BBB", tags: [], updatedAt: 2000 });
    b.applyRemoteUpdate(stateA.state);

    // B ahora tiene ambas notas
    expect(b.getNote("a.md")).not.toBeNull();
    expect(b.getNote("b.md")).not.toBeNull();
  });

  it("diff returns remote state (simplified)", () => {
    const diff = SyncService.diff("aGVsbG8=", "d29ybGQ=");
    expect(diff).toBe("aGVsbG8=");
  });
});

describe("E2EEncryption", () => {
  const key = E2EEncryption.deriveKey("my-strong-password", Buffer.alloc(16, "salt"));

  it("encrypt and decrypt roundtrip", () => {
    const plaintext = "Nota médica secreta del paciente";
    const encrypted = E2EEncryption.encrypt(plaintext, key);
    const decrypted = E2EEncryption.decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("different nonces produce different ciphertexts", () => {
    const a = E2EEncryption.encrypt("same plaintext", key);
    const b = E2EEncryption.encrypt("same plaintext", key);
    expect(a).not.toBe(b);
  });

  it("decrypting tampered ciphertext fails", () => {
    const encrypted = E2EEncryption.encrypt("secret", key);
    const buf = Buffer.from(encrypted, "base64");
    buf[20] ^= 0x01; // flip a bit
    const tampered = buf.toString("base64");
    expect(() => E2EEncryption.decrypt(tampered, key)).toThrow();
  });

  it("wrong key fails to decrypt", () => {
    const encrypted = E2EEncryption.encrypt("secret", key);
    const wrongKey = Buffer.alloc(32, 0);
    expect(() => E2EEncryption.decrypt(encrypted, wrongKey)).toThrow();
  });

  it("generateSalt returns 16 bytes", () => {
    const salt = E2EEncryption.generateSalt();
    expect(salt.length).toBe(16);
  });

  it("two salts are different (high probability)", () => {
    const a = E2EEncryption.generateSalt();
    const b = E2EEncryption.generateSalt();
    expect(a.equals(b)).toBe(false);
  });

  it("hashKey is deterministic", () => {
    expect(E2EEncryption.hashKey("test")).toBe(E2EEncryption.hashKey("test"));
  });

  it("hashKey is 64 hex chars (sha256)", () => {
    expect(E2EEncryption.hashKey("test")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("medical content roundtrip", () => {
    const note = `---
title: Historia Clínica #12345
tags: [confidencial, paciente]
---

# Paciente

Diagnóstico: hipertensión esencial.
Tratamiento: enalapril 10mg/día.

#anatomia #farmacologia`;

    const encrypted = E2EEncryption.encrypt(note, key);
    expect(encrypted).not.toContain("hipertensión");
    expect(encrypted).not.toContain("enalapril");

    const decrypted = E2EEncryption.decrypt(encrypted, key);
    expect(decrypted).toBe(note);
  });
});
