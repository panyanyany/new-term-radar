import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as aio from "../src/twitter-aio.js";
import * as aisa from "../src/aisa.js";
import * as scrappa from "../src/scrappa.js";
import * as x from "../src/x.js";
import { xNew } from "../src/sources.js";
import { loadConfig, loadSnap, saveSnap, type Data } from "../src/core.js";
const now = new Date("2026-10-16T12:00:00Z");
// 最小响应用于验证真实发现的两种外壳、长文与分页契约。
function raw(id = "1", date = "2026-10-16T10:00:00Z"): Data {
  return {
    rest_id: id,
    legacy: {
      full_text: "Use Claude Code",
      favorite_count: 100,
      created_at: date,
    },
    core: { user_results: { result: { core: { screen_name: "OpenAI" } } } },
  };
}
const entry = (t: Data) => ({
  content: { itemContent: { tweet_results: { result: t } } },
});
const cursor = (value = "next") => ({
  content: { cursorType: "Bottom", value },
});
function timeline(rows: Data[], double = false) {
  const data = {
    user: {
      result: { timeline: { timeline: { instructions: [{ entries: rows }] } } },
    },
  };
  return { data: double ? { data } : data };
}
function fetchRows(...rows: Data[]) {
  const fn = vi.fn();
  rows.forEach((r) =>
    fn.mockResolvedValueOnce(new Response(JSON.stringify(r))),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("TWITTER_AIO_RAPIDAPI_KEY", "test-key");
  vi.stubEnv("X_SEARCH_PROVIDER", "twitter-aio");
  vi.stubEnv("X_TIMELINE_PROVIDER", "twitter-aio");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("prioritizes note text, unwraps visible tweet, and marks reposts", () => {
  const t = raw();
  t.note_tweet = {
    note_tweet_results: { result: { text: "Long Claude Code text" } },
  };
  t.legacy.retweeted_status_result = {};
  expect(aio.tweet({ tweet: t })).toMatchObject({
    text: "Long Claude Code text",
    retweeted: true,
    url: "https://x.com/OpenAI/status/1",
  });
});
it.each(["id", "text", "likes", "date"])("rejects malformed %s", (field) => {
  const t = raw();
  if (field === "id") delete t.rest_id;
  if (field === "text") delete t.legacy.full_text;
  if (field === "likes") t.legacy.favorite_count = null;
  if (field === "date") t.legacy.created_at = "bad";
  expect(() => aio.tweet(t)).toThrow("missing valid");
});
it("parses grouped tweets and replacement entry cursor", () => {
  expect(
    aio.entries([{ entries: [entry(raw())] }, { entry: cursor() }]),
  ).toMatchObject({ tweets: [{ id: "1" }], cursor: "next" });
  expect(() => aio.entries(undefined)).toThrow("entries");
});
it.each([false, true])(
  "covers 30h with timeline wrapper double=%s, ignoring old pinned first row",
  async (double) => {
    const fetch = fetchRows(
      {
        data: {
          user: { result: { rest_id: "42", core: { screen_name: "OpenAI" } } },
        },
      },
      timeline(
        [entry(raw("pin", "2026-01-01")), entry(raw("new")), cursor()],
        double,
      ),
      timeline([entry(raw("old", "2026-10-14"))], double),
    );
    const [posts, cost] = await aio.userPosts("OpenAI", now);
    expect(cost).toBe(1200);
    expect(posts).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[1][0])).toContain("/tweetsAndReplies");
    expect(String(fetch.mock.calls[2][0])).toContain("cursor=next");
  },
);
it("HTTP failures do not retry or disclose credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response("test-key", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  await expect(aio.request("/search/test")).rejects.toThrow("HTTP 429");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects lookup mismatch before fetching a timeline", async () => {
  const fetch = fetchRows({
    data: {
      user: { result: { rest_id: "42", core: { screen_name: "other" } } },
    },
  });
  await expect(aio.userPosts("OpenAI", now)).rejects.toThrow("mismatch");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("an incomplete timeline preserves vocabulary and never calls backup automatically", async () => {
  const state = mkdtempSync(join(tmpdir(), "aio-state-"));
  const backup = vi.spyOn(scrappa, "userPosts");
  try {
    saveSnap(state, "x_vocab", { existing: "2026-10-15" });
    fetchRows(
      {
        data: {
          user: { result: { rest_id: "42", core: { screen_name: "OpenAI" } } },
        },
      },
      timeline([entry(raw("1", new Date().toISOString())), cursor()]),
      timeline([entry(raw("1", new Date().toISOString())), cursor()]),
    );
    const cfg = loadConfig("config.example.json");
    cfg.x_accounts = { labs: ["OpenAI"], bloggers: [] };
    await expect(xNew(cfg, state)).rejects.toThrow("stalled");
    expect(loadSnap(state, "x_vocab")).toEqual({ existing: "2026-10-15" });
    expect(backup).not.toHaveBeenCalled();
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
it("timeline page budget fails instead of returning partial coverage", async () => {
  fetchRows(
    {
      data: {
        user: { result: { rest_id: "42", core: { screen_name: "OpenAI" } } },
      },
    },
    timeline([entry(raw()), cursor()]),
  );
  await expect(aio.userPosts("OpenAI", now, 1)).rejects.toThrow(
    "coverage exceeds 1",
  );
});
it("search filters noise, follows wrapped cursor, deduplicates and sorts", async () => {
  const noise = raw("noise");
  noise.legacy.full_text = "Unrelated";
  const reply = raw("reply");
  reply.legacy.in_reply_to_status_id_str = "5";
  const low = raw("low");
  low.legacy.favorite_count = 49;
  const stale = raw("stale", "2026-09-01");
  const second = raw("2");
  second.legacy.favorite_count = 200;
  const fetch = fetchRows(
    {
      entries: [
        {
          entries: [
            entry(raw()),
            entry(noise),
            entry(reply),
            entry(low),
            entry(stale),
          ],
        },
        { entry: cursor() },
      ],
    },
    { entries: [entry(raw()), entry(second)] },
  );
  const [posts, cost] = await x.search("Claude Code", "2026-10-16");
  expect(posts.map((t) => t.id)).toEqual(["2", "1"]);
  expect(cost).toBe(800);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[1][0])).toContain("cursor=next");
});
it("search stops at five pages while still returning valid evidence", async () => {
  const mock = vi.spyOn(aio, "searchPage").mockImplementation(async (_q, c) => {
    const i = c ? Number(c) : 0;
    return { tweets: [aio.tweet(raw(String(i)))!], cursor: String(i + 1) };
  });
  const [posts, cost] = await x.search("Claude Code", "2026-10-16");
  expect(posts).toHaveLength(5);
  expect(cost).toBe(2000);
  expect(mock).toHaveBeenCalledTimes(5);
});
it("search stops after twelve qualified tweets", async () => {
  const mock = vi.spyOn(aio, "searchPage").mockResolvedValue({
    tweets: Array.from({ length: 20 }, (_, i) => aio.tweet(raw(String(i)))!),
    cursor: "next",
  });
  const [posts, cost] = await x.search("Claude Code", "2026-10-16");
  expect(posts).toHaveLength(12);
  expect(cost).toBe(400);
  expect(mock).toHaveBeenCalledTimes(1);
});
it("search rejects repeated cursors and never silently falls back", async () => {
  const backup = vi.spyOn(aisa, "call");
  let i = 0;
  vi.spyOn(aio, "searchPage").mockImplementation(async () => ({
    tweets: [aio.tweet(raw(String(i++)))!],
    cursor: "same",
  }));
  await expect(x.search("Claude Code", "2026-10-16")).rejects.toThrow(
    "stalled",
  );
  expect(backup).not.toHaveBeenCalled();
});
it("explicit backup routes preserve old transports", async () => {
  vi.stubEnv("X_SEARCH_PROVIDER", "aisa");
  vi.stubEnv("X_TIMELINE_PROVIDER", "scrappa");
  const search = vi
    .spyOn(aisa, "call")
    .mockResolvedValue([
      { s: { tweets: [aio.tweet(raw())], has_next_page: false } },
      3000,
    ]);
  const timeline = vi.spyOn(scrappa, "userPosts").mockResolvedValue([[], 303]);
  expect((await x.search("Claude Code", "2026-10-16"))[1]).toBe(3000);
  expect(await x.userPosts("OpenAI", now)).toEqual([[], 303]);
  expect(search).toHaveBeenCalled();
  expect(timeline).toHaveBeenCalled();
});
it("local filter escapes regex, enforces boundaries and rejects future or unknown replies", () => {
  const t = aio.tweet(raw())!;
  expect(x.matches({ ...t, text: "OpenCodex" }, "Codex", "2026-10-02")).toBe(
    false,
  );
  expect(x.matches({ ...t, text: "Use C++" }, "C++", "2026-10-02")).toBe(true);
  expect(
    x.matches({ ...t, createdAt: "2099-01-01" }, "Claude Code", "2026-10-02"),
  ).toBe(false);
  expect(
    x.matches({ ...t, isReply: undefined }, "Claude Code", "2026-10-02"),
  ).toBe(false);
});
