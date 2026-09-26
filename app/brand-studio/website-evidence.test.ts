import { describe, expect, it } from "vitest";
import { observedColors } from "./website-evidence.server";

describe("Website evidence observed colors", () => {
  it("does not let near-duplicate neutrals crowd out a real accent colour", () => {
    // Modeled on anitadongre.com's actual stylesheet: four near-black shades
    // used across nav text, body copy, and borders each individually
    // out-count the site's real gold accent, which appears far less often
    // because it is used sparingly by design.
    const markup = [
      ..."#231f20".repeat(43).match(/.{7}/g)!,
      ..."#1e1e19".repeat(27).match(/.{7}/g)!,
      ..."#252525".repeat(27).match(/.{7}/g)!,
      ..."#1e1e1e".repeat(20).match(/.{7}/g)!,
      ..."#faf8f0".repeat(42).match(/.{7}/g)!,
      ..."#1e381e".repeat(33).match(/.{7}/g)!,
      ..."#b18e35".repeat(21).match(/.{7}/g)!,
    ].join(" ");
    const colors = observedColors(markup);
    expect(colors).toHaveLength(4);
    expect(colors).toContain("#faf8f0");
    expect(colors).toContain("#1e381e");
    expect(colors).toContain("#b18e35");
    expect(colors.filter((color) => ["#231f20", "#1e1e19", "#252525", "#1e1e1e"].includes(color))).toHaveLength(1);
  });

  it("keeps genuinely distinct colours separate", () => {
    const markup = "#ff0000 #ff0000 #ff0000 #0000ff #0000ff #00ff00";
    expect(observedColors(markup)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
  });

  it("returns fewer than four entries when the markup has fewer distinct colours", () => {
    expect(observedColors("#111111 #222222")).toEqual(["#111111", "#222222"]);
  });

  it("returns an empty list when no hex colours are present", () => {
    expect(observedColors("no colors here")).toEqual([]);
  });
});
