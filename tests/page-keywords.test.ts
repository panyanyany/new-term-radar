import { collectTerms } from "../src/report-terms.js";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chat } from "../src/aisa.js";
import {
  parsePageKeywords,
  extractPageKeywords,
} from "../src/page-keywords.js";
import { Store } from "../src/store.js";
import { createBrief, rememberTerms } from "../src/brief-report.js";
import { loadConfig } from "../src/core.js";
vi.mock("../src/aisa.js", () => ({ chat: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const title = "How To Make A Roadster Ramp Car AI Video";
const result = {
  i: 0,
  keyword: "Roadster Ramp Car AI Video",
  explanation: "用 AI 制作 Roadster 汽车坡道主题视频。",
};
it("接受模型提取的主体短语，拒绝幻觉、重复或缺失索引", () => {
  const input = [{ title, url: "https://example.com/tutorial" }];
  expect(parsePageKeywords(JSON.stringify([result]), input)[0].keyword).toBe(
    result.keyword,
  );
  expect(() =>
    parsePageKeywords(
      JSON.stringify([{ ...result, keyword: "Unrelated Product" }]),
      input,
    ),
  ).toThrow();
  expect(() => parsePageKeywords("[]", input)).toThrow();
  expect(() =>
    parsePageKeywords(JSON.stringify([result, result]), [...input, ...input]),
  ).toThrow();
  expect(
    parsePageKeywords('[{"i":0,"keyword":"","explanation":""}]', input)[0]
      .keyword,
  ).toBe("");
});
it("模型结果缓存复用，模型更换会重新提取", async () => {
  const state = mkdtempSync(join(tmpdir(), "radar-keyword-")),
    store = new Store(state);
  vi.mocked(chat).mockResolvedValue(JSON.stringify([result]));
  try {
    const input = [{ title, url: "https://example.com/tutorial" }];
    expect(
      (await extractPageKeywords(store, input, "deepseek-v4.1-flash"))[0]
        .keyword,
    ).toBe(result.keyword);
    await extractPageKeywords(store, input, "deepseek-v4.1-flash");
    expect(chat).toHaveBeenCalledTimes(1);
    await extractPageKeywords(store, input, "other");
    expect(chat).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});
it("旧标题修正保留首次发现，重跑不恢复标题或重复调用", async () => {
  const state = mkdtempSync(join(tmpdir(), "radar-keyword-old-")),
    store = new Store(state),
    cfg = loadConfig("config.example.json");
  vi.mocked(chat).mockResolvedValue(JSON.stringify([result]));
  try {
    const seen = new Date(Date.now() - 30 * 3600000);
    rememberTerms(
      store,
      [
        {
          term: title,
          context: `网页标题：${title}；来源 https://example.com/tutorial`,
        },
      ],
      seen,
    );
    const blocks = {
      sitemap: {
        pages: {
          candidates: [{ keyword: title, url: "https://example.com/tutorial" }],
        },
      },
    };
    const brief = await createBrief(cfg, store, collectTerms([], blocks, {}));
    expect(brief.error).toBeUndefined();
    expect(brief.rows).toHaveLength(1);
    expect(brief.rows[0]).toMatchObject({
      term: result.keyword,
      explanation: result.explanation,
      first_seen_at: seen.toISOString(),
    });
    rememberTerms(store, [
      {
        term: title,
        context: `网页标题：${title}；来源 https://example.com/tutorial`,
      },
    ]);
    const again = await createBrief(cfg, store, collectTerms([], blocks, {}));
    expect(again.rows).toHaveLength(1);
    expect(again.rows[0].first_seen_at).toBe(seen.toISOString());
    expect(chat).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});
