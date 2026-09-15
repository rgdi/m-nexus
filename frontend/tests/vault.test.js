/* ============================================================
 * vault.test.js — Unit tests for vault.js (multi-vault).
 * v2.2.0 W6 — verifies vault namespacing + storage isolation.
 * ============================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import { storage } from "../src/services/storage.js";
import {
  getVaults,
  getCurrentVault,
  setCurrentVault,
  vaultPrefix,
  vKey,
  vGet,
  vSet,
} from "../src/services/vault.js";

describe("vault.js — multi-vault system", () => {
  beforeEach(() => {
    storage.clear();
  });

  describe("getVaults", () => {
    it("returns 4 default vault ids", () => {
      const vaults = getVaults();
      expect(vaults).toEqual(["default", "school", "personal", "work"]);
    });
  });

  describe("getCurrentVault / setCurrentVault", () => {
    it("defaults to 'default' on first load", () => {
      expect(getCurrentVault()).toBe("default");
    });

    it("switches to another vault", () => {
      setCurrentVault("school");
      expect(getCurrentVault()).toBe("school");
    });
  });

  describe("vaultPrefix", () => {
    it("returns mnexus.vault.<id>", () => {
      expect(vaultPrefix("default")).toBe("mnexus.vault.default");
      expect(vaultPrefix("school")).toBe("mnexus.vault.school");
    });

    it("different vaults return different prefixes", () => {
      const a = vaultPrefix("school");
      const b = vaultPrefix("personal");
      expect(a).not.toBe(b);
    });
  });

  describe("vKey", () => {
    it("creates namespace-separated keys", () => {
      const k = vKey("notes");
      expect(k).toContain("notes");
      expect(k).toContain("default"); // current vault
    });

    it("switches namespace when vault changes", () => {
      setCurrentVault("default");
      const k1 = vKey("notes");
      setCurrentVault("school");
      const k2 = vKey("notes");
      expect(k1).not.toBe(k2);
    });
  });

  describe("vGet / vSet — vault-isolated storage", () => {
    it("stores and retrieves in current vault", () => {
      setCurrentVault("school");
      vSet("note", { id: 1, text: "Math" });
      const v = vGet("note");
      expect(v).toEqual({ id: 1, text: "Math" });
    });

    it("isolates data between vaults", () => {
      setCurrentVault("school");
      vSet("data", "school-value");

      setCurrentVault("personal");
      vSet("data", "personal-value");

      setCurrentVault("school");
      expect(vGet("data")).toBe("school-value");

      setCurrentVault("personal");
      expect(vGet("data")).toBe("personal-value");
    });

    it("returns fallback for missing keys", () => {
      expect(vGet("missing", "default-val")).toBe("default-val");
    });
  });
});
