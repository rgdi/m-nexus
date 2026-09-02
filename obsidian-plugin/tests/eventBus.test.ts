import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../src/utils/eventBus";

interface TestEvents {
  hello: string;
  count: number;
  empty: void;
}

describe("EventEmitter", () => {
  it("on/emit básico", () => {
    const e = new EventEmitter<TestEvents>();
    const fn = vi.fn();
    e.on("hello", fn);
    e.emit("hello", "world");
    expect(fn).toHaveBeenCalledWith("world");
  });

  it("unsubscribe vía el retorno de on()", () => {
    const e = new EventEmitter<TestEvents>();
    const fn = vi.fn();
    const off = e.on("count", fn);
    e.emit("count", 1);
    off();
    e.emit("count", 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("múltiples listeners del mismo evento", () => {
    const e = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    e.on("hello", a);
    e.on("hello", b);
    e.emit("hello", "x");
    expect(a).toHaveBeenCalledWith("x");
    expect(b).toHaveBeenCalledWith("x");
  });

  it("emit sin listeners no falla", () => {
    const e = new EventEmitter<TestEvents>();
    expect(() => e.emit("hello", "x")).not.toThrow();
  });

  it("un error en un listener no afecta a los demás", () => {
    const e = new EventEmitter<TestEvents>();
    const a = vi.fn(() => {
      throw new Error("boom");
    });
    const b = vi.fn();
    e.on("hello", a);
    e.on("hello", b);
    e.emit("hello", "x");
    expect(b).toHaveBeenCalledWith("x");
  });

  it("removeAllListeners limpia", () => {
    const e = new EventEmitter<TestEvents>();
    const fn = vi.fn();
    e.on("hello", fn);
    e.removeAllListeners("hello");
    e.emit("hello", "x");
    expect(fn).not.toHaveBeenCalled();
  });
});
