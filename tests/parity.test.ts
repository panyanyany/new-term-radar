import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { names } from "../src/terms.js";
import { baseName } from "../src/sources.js";
import { shape } from "../src/usecases.js";
import { rose } from "../src/review.js";
import { setLang, type Data } from "../src/core.js";
import { daily, sources, keywordTable } from "../src/report.js";
// 固定种子 Python 基准覆盖阈值、银行家舍入、无数据与两种趋势窗口。
const fixture = JSON.parse(
  readFileSync("tests/fixtures/python-parity.json", "utf8"),
);
describe("Python business parity", () => {
  for (const [i, c] of fixture.shape.entries())
    it(`curve ${i}`, () =>
      expect(shape(c.points, "2026-10-16", c.rule)).toEqual(c.expected));
  for (const [i, c] of fixture.rose.entries())
    it(`review ${i}`, () =>
      expect(rose(c.points, c.first)).toEqual(c.expected));
  for (const c of fixture.names)
    it(`names ${c.strong} ${c.text}`, () =>
      expect([...names(c.text, c.strong)].sort()).toEqual(c.expected));
  for (const c of fixture.base)
    it(c.id, () => expect(baseName(c.id)).toBe(c.expected));
  for (const c of fixture.reports as Data[])
    it(`reports ${c.cfg.lang}`, () => {
      setLang(c.cfg.lang);
      expect(keywordTable(c.cfg, c.extra.usecases)).toEqual(c.keywords);
      expect(sources(c.cfg, c.lead, c.blocks, c.extra)).toBe(c.sources);
      expect(
        daily(c.cfg, c.lead, c.blocks, c.gsc, c.review, c.summary, c.extra),
      ).toBe(c.daily);
    });
});
