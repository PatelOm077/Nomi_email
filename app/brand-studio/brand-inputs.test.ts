import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex } from "../components/brand-inputs";

describe("normalizeHex", () => {
  it("accepts six digits with or without #, and expands shorthand", () => {
    expect(normalizeHex("#B96F52")).toBe("#b96f52");
    expect(normalizeHex("b96f52")).toBe("#b96f52");
    expect(normalizeHex("#fff")).toBe("#ffffff");
  });

  it("rejects the partial and malformed values that used to save silently", () => {
    for (const value of ["#ffff", "#fffff", "#1d1a1", "#gggggg", "", "#1d1a18a", "red"])
      expect(normalizeHex(value)).toBeNull();
  });
});

describe("hsv round trip", () => {
  it("returns the same hex after converting to HSV and back", () => {
    for (const hex of ["#b96f52", "#1d1a18", "#fffaf3", "#d8cfc3", "#000000", "#ffffff", "#0088b0", "#d6006c"])
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});
