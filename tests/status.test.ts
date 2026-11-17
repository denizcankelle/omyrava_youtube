import { describe, expect, it } from "vitest";
import {
  PROJECT_STATUSES,
  InvalidTransitionError,
  allowedNext,
  assertTransition,
  canTransition,
} from "../src/lib/status";

describe("durum makinesi", () => {
  it("her durumun gecis tanimi var", () => {
    for (const s of PROJECT_STATUSES) expect(Array.isArray(allowedNext(s))).toBe(true);
  });
  it("gecerli akis: draft -> ... -> published", () => {
    const flow = [
      "draft",
      "queued",
      "generating",
      "reviewing",
      "rendering",
      "ready",
      "approved",
      "uploaded",
      "published",
    ] as const;
    for (let i = 0; i < flow.length - 1; i++)
      expect(canTransition(flow[i], flow[i + 1])).toBe(true);
  });
  it("onaysiz yukleme engellenir", () => {
    expect(canTransition("ready", "uploaded")).toBe(false);
    expect(canTransition("rendering", "published")).toBe(false);
  });
  it("published son durumdur", () => {
    expect(allowedNext("published")).toHaveLength(0);
  });
  it("gecersiz gecis hata firlatir", () => {
    expect(() => assertTransition("draft", "published")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("draft", "olmayan")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("draft", "queued")).not.toThrow();
  });
});
