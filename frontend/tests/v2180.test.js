// v2180.test.js — v2.18.0 Capacitor Android wrapper
//
// - frontend/src/services/api.js detects window.Capacitor → uses 10.0.2.2:4100
// - frontend/src/screens/login.js uses the same detection
// - capacitor.config.json exists with the right webDir + appId
// - android/ folder structure is valid (AndroidManifest.xml, gradle files)
// - network_security_config.xml permits cleartext for dev

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.18.0 — Capacitor config", () => {
  it("capacitor.config.json exists at repo root", () => {
    const cfg = JSON.parse(readFileSync(SRC("capacitor.config.json"), "utf-8"));
    expect(cfg.appId).toBe("com.mnexus.app");
    expect(cfg.appName).toBe("M-NEXUS");
    expect(cfg.webDir).toBe("frontend-bundle");
  });

  it("capacitor.config.json declares splash + status bar plugins", () => {
    const cfg = JSON.parse(readFileSync(SRC("capacitor.config.json"), "utf-8"));
    expect(cfg.plugins).toHaveProperty("SplashScreen");
    expect(cfg.plugins).toHaveProperty("StatusBar");
  });

  it("androidScheme is https (matches Capacitor 8 defaults)", () => {
    const cfg = JSON.parse(readFileSync(SRC("capacitor.config.json"), "utf-8"));
    expect(cfg.server.androidScheme).toBe("https");
  });
});

describe("v2.18.0 — android/ wrapper structure", () => {
  it("android/ directory exists with required gradle files", () => {
    for (const f of [
      "android/build.gradle",
      "android/settings.gradle",
      "android/gradle.properties",
      "android/gradlew",
      "android/variables.gradle",
    ]) {
      expect(existsSync(SRC(f)), `missing ${f}`).toBe(true);
    }
  });

  it("AndroidManifest declares INTERNET + usesCleartextTraffic", () => {
    const m = readFileSync(SRC("android/app/src/main/AndroidManifest.xml"), "utf-8");
    expect(m).toMatch(/<uses-permission android:name="android.permission.INTERNET"/);
    expect(m).toMatch(/android:usesCleartextTraffic="true"/);
    expect(m).toMatch(/networkSecurityConfig="@xml\/network_security_config"/);
  });

  it("network_security_config allows cleartext for emulator/loopback", () => {
    const cfg = readFileSync(SRC("android/app/src/main/res/xml/network_security_config.xml"), "utf-8");
    expect(cfg).toMatch(/<domain[^>]*>10\.0\.2\.2</);
    expect(cfg).toMatch(/<domain[^>]*>localhost</);
    expect(cfg).toMatch(/<domain[^>]*>127\.0\.0\.1</);
  });

  it("strings.xml declares the app name", () => {
    const s = readFileSync(SRC("android/app/src/main/res/values/strings.xml"), "utf-8");
    expect(s).toMatch(/<string name="app_name">M-NEXUS<\/string>/);
    expect(s).toMatch(/<string name="package_name">com\.mnexus\.app<\/string>/);
  });
});

describe("v2.18.0 — frontend backend URL detection", () => {
  it("api.js imports detectApiBase from shared module", () => {
    const src = readFileSync(SRC("frontend/src/services/api.js"), "utf-8");
    expect(src).toMatch(/from "\.\/api_base\.js"/);
    expect(src).toMatch(/detectApiBase/);
    // 10.0.2.2 detection now lives in services/api_base.js, not api.js.
    const base = readFileSync(SRC("frontend/src/services/api_base.js"), "utf-8");
    expect(base).toMatch(/10\.0\.2\.2/);
  });

  it("login.js imports detectApiBase from shared module", () => {
    const src = readFileSync(SRC("frontend/src/screens/login.js"), "utf-8");
    expect(src).toMatch(/from "\.\.\/services\/api_base\.js"/);
    expect(src).toMatch(/detectApiBase/);
  });
});

describe("v2.18.0 — build script + CI", () => {
  it("scripts/build_android.sh exists and is executable", () => {
    expect(existsSync(SRC("scripts/build_android.sh"))).toBe(true);
    const s = readFileSync(SRC("scripts/build_android.sh"), "utf-8");
    expect(s).toMatch(/build_webview/);
    expect(s).toMatch(/cap sync/);
    expect(s).toMatch(/assembleDebug/);
    expect(s).toMatch(/ANDROID_HOME/);
  });

  it("ci.yml has a build-android job", () => {
    const yml = readFileSync(SRC(".github/workflows/ci.yml"), "utf-8");
    expect(yml).toMatch(/build-android:/);
    expect(yml).toMatch(/setup-android@v3/);
    expect(yml).toMatch(/api-level: '36'/);
    expect(yml).toMatch(/assembleDebug/);
    expect(yml).toMatch(/upload-artifact@v4/);
  });
});
