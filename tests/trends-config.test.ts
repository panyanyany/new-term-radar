import { expect, it } from "vitest";
import { resolveTrendsConfig } from "../src/trends-config.js";
it("类目默认值与参考词兼容在配置边界统一解析", () => {
  expect(resolveTrendsConfig({ roots: ["game"] }, "reference")).toMatchObject({
    roots: ["game"],
    windows: [1, 3, 7],
    category_code: 8,
    benchmark: "reference",
    provider: "dataforseo",
    standard_wait_minutes: 45,
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
  { provider: "invalid" },
  { standard_wait_minutes: -1 },
  { standard_wait_minutes: 46 },
  { standard_wait_minutes: 1.5 },
  { benchmark: "bad,word" },
])("非法配置在请求前失败：%j", (value) =>
  expect(() => resolveTrendsConfig(value)).toThrow(),
);

it("根词数不受单次 HTTP 批量上限限制，由供应商实现拆批", () => {
  const roots = Array.from({ length: 40 }, (_, i) => `root${i}`);
  expect(resolveTrendsConfig({ roots }).roots).toHaveLength(40);
  expect(resolveTrendsConfig({ roots, provider: "aisa" }).roots).toHaveLength(
    40,
  );
});
