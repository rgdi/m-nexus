import { describe, it, expect } from "vitest";
import { isLanIp, isLoopbackIp } from "../src/utils/network.js";

describe("network.isLanIp", () => {
  it("recognizes loopback IPv4", () => {
    expect(isLanIp("127.0.0.1")).toBe(true);
    expect(isLanIp("127.0.0.42")).toBe(true);
  });

  it("recognizes loopback IPv6", () => {
    expect(isLanIp("::1")).toBe(true);
    expect(isLanIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("recognizes RFC1918 ranges", () => {
    expect(isLanIp("10.0.0.1")).toBe(true);
    expect(isLanIp("192.168.1.100")).toBe(true);
    expect(isLanIp("172.16.0.1")).toBe(true);
    expect(isLanIp("172.31.255.255")).toBe(true);
  });

  it("rejects non-LAN addresses", () => {
    expect(isLanIp("8.8.8.8")).toBe(false);
    expect(isLanIp("172.32.0.1")).toBe(false);
    expect(isLanIp("172.15.0.1")).toBe(false);
    expect(isLanIp("203.0.113.5")).toBe(false);
  });

  it("recognizes link-local", () => {
    expect(isLanIp("169.254.1.1")).toBe(true);
    expect(isLanIp("fe80::1")).toBe(true);
  });

  it("rejects empty / garbage", () => {
    expect(isLanIp("")).toBe(false);
    expect(isLanIp("not-an-ip")).toBe(false);
  });
});

describe("network.isLoopbackIp", () => {
  it("matches loopback IPv4 and IPv6", () => {
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
  });
  it("rejects LAN addresses", () => {
    expect(isLoopbackIp("192.168.1.1")).toBe(false);
    expect(isLoopbackIp("10.0.0.1")).toBe(false);
  });
});
