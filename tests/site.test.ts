import { renderTrendChart } from "../src/site-chart.js";
import { expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "cheerio";
import { publishSite, renderSite } from "../src/site.js";
const date = new Date("2026-10-17T12:00:00Z");
// 公开页只接受白名单，恶意 HTML 也是文字；边界满 24 小时必须归旧词。
it("公开字段、文本转义与精确 24 小时分类", () => {
  const html = renderSite(
    {
      generated_at: date.toISOString(),
      cost_micros: "PRIVATE_COST",
      usage: "PRIVATE_USAGE",
      brief_terms: [
        {
          term: '<img src=x onerror="alert(1)">',
          explanation: "<script>alert(2)</script>",
          first_seen_at: "2026-10-17T11:00:00Z",
          context: "PRIVATE_CONTEXT",
        },
        {
          term: "old game",
          explanation: "旧词",
          first_seen_at: "2026-10-16T12:00:00Z",
        },
      ],
    },
    new Date("2030-01-01"),
  );
  const $ = load(html);
  expect($("#fresh .term-name").text()).toBe('<img src=x onerror="alert(1)">');
  expect($("#old .term-name").text()).toBe("old game");
  expect($("#fresh .discovered-cell time").text()).toBe(
    "2026-10-17T11:00:00.000Z",
  );
  expect($("#old .discovered-cell time").attr("datetime")).toBe(
    "2026-10-16T12:00:00.000Z",
  );
  expect($("tbody script, tbody img")).toHaveLength(0);
  expect(html).not.toMatch(/PRIVATE_(COST|USAGE|CONTEXT)/);
  expect($(".updated time").attr("datetime")).toBe(date.toISOString());
});
it("发布旧报告兼容文件时间，失败保留已发布页面且不复制原始数据", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-site-"));
  const report = join(dir, "report.json"),
    output = join(dir, "public");
  try {
    writeFileSync(
      report,
      JSON.stringify({ brief_terms: [], usage: { secret: "DO_NOT_PUBLISH" } }),
    );
    const target = publishSite(report, output);
    const prior = readFileSync(target, "utf8");
    expect(load(prior)(".empty:not([hidden])")).toHaveLength(2);
    expect(prior).not.toContain("DO_NOT_PUBLISH");
    expect(readdirSync(output)).toEqual(["index.html"]);
    writeFileSync(
      report,
      '{"brief_terms":[{"term":"bad-date","first_seen_at":"invalid"}]}',
    );
    expect(() => publishSite(report, output)).toThrow();
    expect(readFileSync(target, "utf8")).toBe(prior);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("表格关联本轮曲线，蓝参考和红当前共用固定尺度，保留参考词名称", () => {
  const html = renderSite(
    {
      generated_at: date.toISOString(),
      brief_terms: [
        {
          term: "New Tool",
          first_seen_at: date.toISOString(),
          explanation: "在线工具",
        },
      ],
      trends: {
        candidates: [
          {
            term: "new tool",
            trend_filter: {
              benchmark: "reference <word>",
              curve: [
                [date.getTime() - 3600000, 0, 100],
                [date.getTime(), 100, 50],
              ],
            },
            evidence: "PRIVATE_EVIDENCE",
          },
        ],
      },
    },
    date,
  );
  const $ = load(html);
  expect(
    $("#fresh thead th")
      .map((_, el) => $(el).text())
      .get(),
  ).toEqual([
    "#",
    "Google Trends · 近7天",
    "词语",
    "发现时间",
    "趋势分类",
    "AI 分类",
    "一句话解释",
  ]);
  expect($(".reference-line").attr("d")).toBe("M26.00,8.00 L208.00,30.00");
  expect($(".term-line").attr("d")).toBe("M26.00,52.00 L208.00,8.00");
  expect($(".reference-name").text()).toBe("参考词：reference <word>");
  expect($(".reference-name word")).toHaveLength(0);
  expect(html).not.toContain("PRIVATE_EVIDENCE");
  const target = new URL($(".chart-link").attr("href")!);
  expect(target.searchParams.get("q")).toBe("reference <word>,New Tool");
});
it("缺失或损坏的曲线不补零、不阻断其他词的页面", () => {
  for (const curve of [
    undefined,
    [[0, 1, 2]],
    [
      [1, 1, 2],
      [1, 2, 3],
    ],
    [
      [0, 0, 2],
      [3600000, 101, 3],
    ],
  ]) {
    const $ = load(
      renderSite(
        {
          brief_terms: [{ term: "tool", first_seen_at: date.toISOString() }],
          trends: { candidates: [{ term: "tool", trend_filter: { curve } }] },
        },
        date,
      ),
    );
    expect($(".no-curve").text()).toBe("暂无曲线");
    expect($(".trend-chart")).toHaveLength(0);
    expect($(".term-name").text()).toBe("tool");
  }
});

it("参考词均值居中且双线共用尺度，峰值不截断，全零也能显示", () => {
  const $ = load(
    renderTrendChart([
      [0, 0, 2],
      [3600000, 3, 2],
    ]),
  );
  expect($(".axis-max").text()).toBe("4");
  expect($(".reference-line").attr("d")).toBe("M26.00,30.00 L208.00,30.00");
  expect($(".term-line").attr("d")).toBe("M26.00,52.00 L208.00,19.00");
  const zero = load(
    renderTrendChart([
      [0, 0, 0],
      [3600000, 0, 0],
    ]),
  );
  expect(zero(".axis-max").text()).toBe("1");
  expect(zero(".term-line").attr("d")).toBe("M26.00,52.00 L208.00,52.00");
});

it("当前词突增时扩展共同纵轴，不截断红线或单独改变比例", () => {
  const $ = load(
    renderTrendChart([
      [0, 0, 2],
      [3600000, 40, 2],
    ]),
  );
  expect($(".axis-max").text()).toBe("42");
  expect($(".term-line").attr("d")).toBe("M26.00,52.00 L208.00,10.10");
});

// 错误示范：拒绝和待确认都不是删除行的理由，诊断信息不得发布到网站。
it("分类列展示所有判断，转义依据且不公开运行错误", () => {
  const kinds = [
    { decision: "confirmed", is_online_game: true, is_online_tool: false },
    { decision: "confirmed", is_online_game: false, is_online_tool: true },
    { decision: "confirmed", is_online_game: true, is_online_tool: true },
    { decision: "rejected", is_online_game: false, is_online_tool: false },
    { decision: "uncertain", is_online_game: false, is_online_tool: false },
  ];
  const $ = load(
    renderSite(
      {
        brief_terms: [...kinds, undefined].map((_, i) => ({
          term: `term${i}`,
          first_seen_at: date.toISOString(),
        })),
        trends: {
          candidates: kinds.map((kind, i) => ({
            term: `term${i}`,
            classification: {
              ...kind,
              reason: "<img src=x>",
              error: "PRIVATE_ERROR",
            },
          })),
        },
      },
      date,
    ),
  );
  expect(
    $(".kind-cell")
      .map((_, e) => $(e).text())
      .get(),
  ).toEqual([
    "线上游戏",
    "在线工具",
    "游戏 / 工具",
    "其他",
    "待确认",
    "未分类",
  ]);
  expect($(".kind-cell").first().attr("title")).toBe("<img src=x>");
  expect($(".kind-cell img")).toHaveLength(0);
  expect($.html()).not.toContain("PRIVATE_ERROR");
});

it("趋势分类独立展示新起量、已有热度爆发，兼容旧报告原因", () => {
  const $ = load(
    renderSite(
      {
        brief_terms: [0, 1, 2].map((i) => ({
          term: `trend${i}`,
          first_seen_at: date.toISOString(),
        })),
        trends: {
          candidates: [
            {
              term: "trend0",
              trend_filter: { reason: "low_baseline_then_rising" },
            },
            {
              term: "trend1",
              trend_filter: { trend_type: "existing_baseline_breakout" },
            },
            { term: "trend2" },
          ],
        },
      },
      date,
    ),
  );
  expect(
    $(".trend-kind-cell")
      .map((_, e) => $(e).text())
      .get(),
  ).toEqual(["低基线起量", "已有热度爆发", "未分类"]);
});

it("网页候选同样关联曲线和 AI 分类，不发布搜索正文", () => {
  const $ = load(
    renderSite(
      {
        brief_terms: [
          { term: "Guess the player", first_seen_at: date.toISOString() },
        ],
        sitemap: {
          pages: {
            candidates: [
              {
                keyword: "Guess the player",
                trend_filter: {
                  curve: [
                    [0, 1, 10],
                    [3600000, 2, 10],
                  ],
                  benchmark: "hex picker",
                },
                classification: {
                  decision: "confirmed",
                  is_online_game: true,
                  is_online_tool: false,
                  is_offline_sports_event: false,
                  reason: "猜球员游戏",
                },
                evidence: "PRIVATE_PAGE_EVIDENCE",
              },
            ],
          },
        },
      },
      date,
    ),
  );
  expect($(".trend-chart")).toHaveLength(1);
  expect($(".kind-cell").text()).toBe("线上游戏");
  expect($.html()).not.toContain("PRIVATE_PAGE_EVIDENCE");
});

it("悬停诞生路径合并根词窗口和网页来源，记录真实筛选状态且不泄露原始正文", () => {
  const candidate = {
    term: "test game",
    classification: {
      status: "pending",
      decision: "uncertain",
      is_online_game: false,
      is_online_tool: false,
      is_offline_sports_event: null,
      reason: "分类返回无效",
      diagnostic: "PRIVATE_DIAGNOSTIC",
    },
    trend_filter: {
      status: "passed",
      trend_type: "existing_baseline_breakout",
      benchmark: "reference",
    },
    search_response: { query: "test game", organic_results: "PRIVATE_RESULTS" },
    exact_search_response: { query: '"test game"' },
  };
  const $ = load(
    renderSite(
      {
        brief_terms: [{ term: "test game", first_seen_at: date.toISOString() }],
        trends: {
          candidates: [
            {
              ...candidate,
              appearances: [
                {
                  root: "game",
                  request: {
                    time_range: "past_day",
                    category_code: 8,
                    secret: "PRIVATE_KEY",
                  },
                },
                { root: "game", request: { time_range: "past_7_days" } },
              ],
            },
          ],
        },
        sitemap: {
          pages: {
            candidates: [
              {
                ...candidate,
                keyword: "test game",
                site: "test-site",
                url: "https://example.test/new-game",
                anchors: ['Game <img src=x onerror="alert(1)">'],
              },
            ],
          },
        },
        candidate_screening: { candidates: [candidate] },
      },
      date,
    ),
  );
  const steps: { kind: string; title: string; text: string }[] = JSON.parse(
    $(".term-trigger").attr("data-birth-path")!,
  );
  const tip = steps.map((s) => `${s.title}：${s.text}`).join("\n");
  expect(tip).toContain("根词「game」");
  expect(tip).toContain("近1天，类目 8");
  expect(tip).toContain("近7天");
  expect(tip).toContain("https://example.test/new-game");
  expect(tip).toContain("原始锚文本：Game <img");
  expect(tip).toContain("通过 · 已有热度爆发");
  expect(tip).toContain('精确补查："test game"');
  expect(tip).toContain("AI 分类：待确认");
  expect(tip).toContain("分类依据：分类返回无效");
  expect($(".term-trigger img")).toHaveLength(0);
  expect($.html()).not.toMatch(/PRIVATE_(DIAGNOSTIC|RESULTS|KEY)/);
  expect($("script")).toHaveLength(1);
  expect($("script[src],link[rel=stylesheet]")).toHaveLength(0);
  expect($("script").text()).toContain("allowHTML: false");
  expect($("script").text()).toContain("document.body");
  expect($(".term-trigger").attr("type")).toBe("button");
});

it("旧报告的来源和筛选缺项明确标为未记录，不编造通过路径", () => {
  const $ = load(
    renderSite(
      { brief_terms: [{ term: "legacy", first_seen_at: date.toISOString() }] },
      date,
    ),
  );
  const steps: { kind: string; title: string; text: string }[] = JSON.parse(
    $(".term-trigger").attr("data-birth-path")!,
  );
  const tip = steps.map((s) => `${s.title}：${s.text}`).join("\n");
  expect(tip).toContain("发现来源：未记录");
  expect(tip).toContain("判定未记录");
  expect(tip).toContain("Google 搜索：记录缺失");
  expect(tip).not.toContain("曲线：通过");
  expect($(".term-name").text()).toBe("legacy");
});

it("超限二级候选独立展示路径与状态，不混入新旧词且转义外部文字", () => {
  const html = renderSite(
    {
      generated_at: date.toISOString(),
      brief_terms: [],
      trends: {
        candidates: [],
        second_level: {
          deferred: [
            {
              term: "<pending>",
              appearances: [
                {
                  root: "first",
                  discovery_level: 2,
                  root_path: ["game", "first", "<pending>"],
                },
              ],
              secret: "PRIVATE_SECRET",
            },
          ],
        },
      },
    },
    date,
  );
  const $ = load(html);
  expect($("#deferred tbody tr")).toHaveLength(1);
  expect($("#deferred").text()).toContain("game → first → <pending>");
  expect($("#deferred").text()).toContain("超限未查询");
  expect($("#fresh tbody tr, #old tbody tr")).toHaveLength(0);
  expect(html).not.toContain("PRIVATE_SECRET");
  expect($("pending")).toHaveLength(0);
});

it("采集不完整显示简短状态，公开页面不泄露原始错误或费用", () => {
  const html = renderSite(
    {
      brief_terms: [],
      trends: {
        collection_status: {
          complete: 1,
          pending: 2,
          failed: 1,
          unknown: 0,
          batch_ids: ["batch"],
        },
        error: "PRIVATE_ERROR",
        cost_micros: "PRIVATE_FEE",
      },
    },
    date,
  );
  expect(html).toContain("上涨词采集未完整");
  expect(html).toContain("待取回 2");
  expect(html).not.toContain("PRIVATE_ERROR");
  expect(html).not.toContain("PRIVATE_FEE");
});
