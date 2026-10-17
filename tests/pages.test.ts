import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageLinks, pageDiff } from "../src/pages.js";
import { loadConfig, loadSnap } from "../src/core.js";
vi.mock("../src/page-keywords.js", () => ({
  extractPageKeywords: vi.fn(async (_store, inputs: { title: string }[]) =>
    inputs.map((input) => ({
      keyword: input.title,
      explanation: "测试工具。",
    })),
  ),
}));
const source = { url: "https://example.com/" };
afterEach(() => vi.unstubAllGlobals());
describe("网页新增候选", () => {
  it("合并全部锚文本，并归一化跟踪参数和片段", () => {
    const rows = pageLinks(
      '<a href="/ai-headshot/?utm_source=a#top"><img></a><a href="/ai-headshot">Try Now</a><a href="/ai-headshot/">AI Headshot Generator</a>',
      source,
    );
    expect(rows).toEqual([
      {
        url: "https://example.com/ai-headshot",
        keyword: "AI Headshot Generator",
        basis: "anchor",
        anchors: ["Try Now", "AI Headshot Generator"],
      },
    ]);
  });
  it("缺少有效锚文本才用 slug，随机 ID 留待确认，排除外链和分类", () => {
    const rows = pageLinks(
      '<a href="/tools/ai-video.html">Learn More</a><a href="/abcdef123456">Try Now</a><a href="https://elsewhere.com/tool">Other Tool</a><a href="/category/tools">Tools</a><a href="/photo.png">Photo</a>',
      source,
    );
    expect(rows.map((r) => [r.keyword, r.basis])).toEqual([
      ["ai video", "url"],
      ["", "unknown"],
    ]);
    expect(
      pageLinks(
        '<a href="/blog/one">One post</a><a href="/tools/two">Tool two</a><a href="/blog/page/2">Next</a>',
        { ...source, include: "^/blog/[^/]+/?$" },
      ),
    ).toHaveLength(1);
  });
  it("首次仅基线，失败保留状态，消失重现不报新，旧锚文本可更新", async () => {
    const state = mkdtempSync(join(tmpdir(), "radar-pages-"));
    const cfg = loadConfig("config.example.json");
    cfg.pages = { test: source };
    let html = '<a href="/one-tool">Try Now</a>';
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(html, { headers: { "content-type": "text/html" } }),
      ),
    );
    try {
      expect((await pageDiff(cfg, state)).sites.test.first_run).toBe(true);
      html = '<a href="/two-tool">Tool Two</a>';
      expect((await pageDiff(cfg, state)).candidates).toHaveLength(1);
      html = '<a href="/one-tool">Better Tool Title</a>';
      expect((await pageDiff(cfg, state)).candidates).toHaveLength(0);
      html = "<html>blocked</html>";
      expect((await pageDiff(cfg, state)).sites.test.error).toContain(
        "snapshot preserved",
      );
      expect(
        loadSnap<any>(state, "pages/test")["https://example.com/one-tool"]
          .keyword,
      ).toBe("Better Tool Title");
      html = '<a href="/two-tool">Tool Two</a>';
      expect((await pageDiff(cfg, state)).candidates).toHaveLength(0);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
