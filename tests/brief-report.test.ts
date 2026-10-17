import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  rememberTerms,
  briefReport,
  collectTerms,
  explainTerms,
  createBrief,
} from "../src/brief-report.js";
import { summary, withoutCosts } from "../scripts/notify-report.js";
const dir = mkdtempSync(join(tmpdir(), "radar-brief-"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("精确 24 小时分类，重跑不会重置首次发现，大小写去重", () => {
  const store = new Store(dir);
  try {
    rememberTerms(
      store,
      [{ term: "Tool A", context: "editor" }],
      new Date("2026-10-16T10:00:00Z"),
    );
    const rows = rememberTerms(
      store,
      [
        { term: "tool a", context: "editor" },
        { term: "Tool B", context: "video" },
      ],
      new Date("2026-10-17T10:00:00Z"),
    );
    expect(rows).toHaveLength(2);
    const md = briefReport(rows, new Date("2026-10-17T10:00:00Z"));
    const [fresh, old] = md.split("## 2. 旧词");
    expect(fresh).toContain("Tool B:");
    expect(fresh).not.toContain("tool a:");
    expect(old).toContain("tool a:");
    expect(rows.find((r) => r.term === "tool a")?.first_seen_at).toBe(
      "2026-10-16T10:00:00.000Z",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("整段隐藏群聊费用，私聊仍保留费用及词义", () => {
  const md = briefReport([
    {
      term: "Test",
      context: "",
      explanation: "一种工具。",
      first_seen_at: new Date().toISOString(),
    },
  ]);
  expect(summary(md, false)).toContain("Test: 一种工具。");
  expect(withoutCosts(md)).not.toContain("## 3.");
  expect(summary(md, true)).toContain("## 3. 花费");
});
it("合并线索、研究词与网页候选且去重", () => {
  expect(
    collectTerms(
      [{ term: "ABC", examples: ["editor"] }],
      {
        sitemap: {
          pages: {
            candidates: [
              { keyword: "abc", url: "https://a.test" },
              { keyword: "New", url: "https://b.test" },
            ],
          },
        },
      },
      { rows: [{ phrase: "Other", names: ["ABC"] }] },
    ).map((r) => r.term),
  ).toEqual(["ABC", "Other", "New"]);
});
it("解释失败时不编造含义", async () => {
  const state = mkdtempSync(join(tmpdir(), "radar-explain-")),
    store = new Store(state);
  try {
    const rows = rememberTerms(store, [{ term: "Unknown", context: "" }]);
    vi.stubEnv("AISA_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await explainTerms(rows, "deepseek-v4.1-flash", store)).toBeTruthy();
    expect(briefReport(rows)).toContain("目前资料不足");
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});

it("本轮候选是唯一报告来源，旧报告回灌和历史词不补入，历史只判断新旧", async () => {
  const state = mkdtempSync(join(tmpdir(), "radar-current-only-")),
    store = new Store(state);
  const cfg = (await import("../src/core.js")).loadConfig(
    "config.example.json",
  );
  try {
    rememberTerms(
      store,
      [
        { term: "connectors app.openkrill", context: "旧 sitemap" },
        { term: "returning", context: "历史词" },
      ],
      new Date(Date.now() - 48 * 3600000),
    );
    rememberTerms(store, [{ term: "fresh", context: "新发现" }]);
    store.db.prepare("UPDATE report_terms SET explanation='一种工具。'").run();
    writeFileSync(
      join(state, "previous.json"),
      JSON.stringify({
        brief_terms: [
          { term: "connectors app.openkrill", context: "旧 sitemap" },
        ],
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("no network expected")),
    );
    const brief = await createBrief(
      cfg,
      store,
      collectTerms(
        [
          { term: "fresh", named: 1 },
          { term: "returning", named: 1 },
        ],
        {},
        {},
      ),
      join(state, "previous.md"),
    );
    expect(brief.error).toBeUndefined();
    expect(brief.rows.map((r: any) => r.term)).toEqual(["fresh", "returning"]);
    const md = briefReport(brief.rows);
    expect(md.split("## 2. 旧词")[0]).toContain("fresh:");
    expect(md.split("## 2. 旧词")[1]).toContain("returning:");
    expect(md).not.toContain("openkrill");
    expect(
      (await createBrief(cfg, store, collectTerms([], {}, {}))).rows,
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});
it("资料不足的历史解释不会阻止使用本轮新证据重新解释", async () => {
  const state = mkdtempSync(join(tmpdir(), "radar-reexplain-")),
    store = new Store(state);
  try {
    rememberTerms(store, [{ term: "new tool", context: "旧证据" }]);
    store.db
      .prepare(
        "UPDATE report_terms SET explanation='暂无可靠资料，含义待确认。'",
      )
      .run();
    vi.stubEnv("AISA_API_KEY", "test");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    i: 0,
                    explanation: "可在线编辑图片的工具。",
                    reliable: true,
                  },
                ]),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const cfg = (await import("../src/core.js")).loadConfig(
      "config.example.json",
    );
    const result = await createBrief(
      cfg,
      store,
      collectTerms(
        [],
        {
          trends: {
            candidates: [
              { term: "new tool", context: "Google 搜索资料：在线图片编辑器" },
            ],
          },
        },
        {},
      ),
    );
    expect(result.rows[0].explanation).toBe("可在线编辑图片的工具。");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});
