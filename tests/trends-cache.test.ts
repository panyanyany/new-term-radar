import { SourceTransportError } from "../src/source-errors.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { chat } from "../src/aisa.js";
import { createBrief, rememberTerms } from "../src/brief-report.js";
import { loadConfig } from "../src/core.js";
vi.mock("../src/aisa.js", () => ({ chat: vi.fn() }));
let state: string, store: Store;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "radar-cache-"));
  store = new Store(state);
  vi.clearAllMocks();
});
afterEach(() => {
  store.close();
  rmSync(state, { recursive: true, force: true });
});
const answer = (reliable = true) =>
  JSON.stringify([
    { i: 0, explanation: reliable ? "在线工具。" : "暂不能确定。", reliable },
  ]);
const blocks = (context = "evidence") => ({
  trends: { candidates: [{ term: "tool", context }] },
});
it("缓存按证据、模型、版本失效，不依赖中文文案", async () => {
  const cfg = loadConfig("config.example.json");
  vi.mocked(chat).mockResolvedValue(answer());
  await createBrief(cfg, store, [], blocks(), {});
  await createBrief(cfg, store, [], blocks(), {});
  expect(chat).toHaveBeenCalledTimes(1);
  await createBrief(cfg, store, [], blocks("new evidence"), {});
  expect(chat).toHaveBeenCalledTimes(2);
  cfg.usecases.model = "another";
  await createBrief(cfg, store, [], blocks("new evidence"), {});
  expect(chat).toHaveBeenCalledTimes(3);
  store.db.prepare("UPDATE trends_explanations SET version='old'").run();
  await createBrief(cfg, store, [], blocks("new evidence"), {});
  expect(chat).toHaveBeenCalledTimes(4);
});
it("不可靠解释每轮重试；失败不清除历史解释", async () => {
  const cfg = loadConfig("config.example.json");
  vi.mocked(chat).mockResolvedValue(answer(false));
  await createBrief(cfg, store, [], blocks(), {});
  await createBrief(cfg, store, [], blocks(), {});
  expect(chat).toHaveBeenCalledTimes(2);
  vi.mocked(chat).mockResolvedValue(answer());
  await createBrief(cfg, store, [], blocks(), {});
  vi.mocked(chat).mockRejectedValue(new SourceTransportError("HTTP 504"));
  const failed = await createBrief(cfg, store, [], blocks("changed"), {});
  expect(failed.error).toContain("504");
  expect(
    store.db
      .prepare("SELECT explanation FROM report_terms WHERE key='tool'")
      .get(),
  ).toEqual({ explanation: "在线工具。" });
  expect(failed.rows[0].explanation).toBeUndefined();
});
it("其他来源的资料不足缓存不被 Trends 规则清空", async () => {
  rememberTerms(store, [{ term: "legacy", context: "old" }]);
  store.db.prepare("UPDATE report_terms SET explanation='含义待确认。'").run();
  const cfg = loadConfig("config.example.json");
  const result = await createBrief(
    cfg,
    store,
    [{ term: "legacy", named: 1 }],
    {},
    {},
  );
  expect(result.rows[0].explanation).toBe("含义待确认。");
  expect(chat).not.toHaveBeenCalled();
});
it("旧报告的过滤词可恢复首次发现，仍不回灌进本轮词表", async () => {
  const { writeFileSync, utimesSync } = await import("node:fs");
  const { rememberDiscoveries } = await import("../src/term-observations.js");
  const file = join(state, "prior.json"),
    at = new Date(Date.now() - 48 * 3600000);
  writeFileSync(
    file,
    JSON.stringify({
      brief_terms: [],
      trends: { filtered: [{ term: "previously pending" }] },
    }),
  );
  utimesSync(file, at, at);
  rememberDiscoveries(store, [{ term: "previously pending" }]);
  const cfg = loadConfig("config.example.json");
  const result = await createBrief(
    cfg,
    store,
    [],
    {},
    {},
    join(state, "prior.md"),
  );
  expect(result.rows).toEqual([]);
  const observation = store.db
    .prepare("SELECT first_seen_at FROM term_discoveries WHERE key=?")
    .get("previously pending") as { first_seen_at: string };
  expect(
    Math.abs(Date.parse(observation.first_seen_at) - at.getTime()),
  ).toBeLessThan(2);
  expect(chat).not.toHaveBeenCalled();
});
