import { expect, it } from "vitest";
import { resolveTrendsConfig } from "../src/trends-config.js";
it("类目默认值与参考词兼容在配置边界统一解析", () => {
  expect(resolveTrendsConfig({ roots: ["game"] }, "reference")).toMatchObject({
    roots: ["game"],
    windows: [1, 3, 7],
    category_code: 8,
    benchmark: "reference",
  });
  expect(
    resolveTrendsConfig({ benchmark: "specific" }, "legacy").benchmark,
  ).toBe("specific");
});
it.each([
  { roots: [""] },
  { windows: [2] },
  { windows: [1, 1] },
  { category_code: -1 },
  { roots: ["GAME", "game"] },
  { roots: Array.from({ length: 7 }, (_, i) => `root${i}`) },
  { benchmark: "bad,word" },
])("非法配置在请求前失败：%j", (value) =>
  expect(() => resolveTrendsConfig(value)).toThrow(),
);
