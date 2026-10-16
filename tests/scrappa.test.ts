import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callMany,
  userPosts,
  trendsMany,
  timeline,
  key,
} from "../src/scrappa.js";
import { xNew } from "../src/sources.js";
import { loadConfig, saveSnap, loadSnap, shift, today } from "../src/core.js";
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mocks.connect;
    callTool = mocks.callTool;
    close = mocks.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));
const fixture = JSON.parse(readFileSync("tests/fixtures/scrappa.json", "utf8"));
beforeEach(() => {
  vi.stubEnv("SCRAPPA_API_KEY", "test");
  vi.stubEnv("X_TIMELINE_PROVIDER", "scrappa");
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.callTool.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("real comparison fixture retains both scales and crops 40 days", () => {
  const rows = timeline(
    fixture.comparison,
    ["claude code", "gpts"],
    "2026-09-01",
    "2026-10-10",
  );
  expect(rows).toHaveLength(40);
  expect(rows[0]).toEqual(["2026-09-01", 61, 2]);
  expect(rows.at(-1)?.[0]).toBe("2026-10-10");
});
it.each(["weekly", "order", "missing", "baseline", "null"])(
  "rejects %s fixture fault",
  (fault) => {
    const b = structuredClone(fixture.comparison);
    let start = "2026-09-01";
    if (fault === "weekly")
      b.timeline_data = b.timeline_data.filter(
        (_: unknown, i: number) => i % 7 === 0,
      );
    if (fault === "order") b.timeline_data[0].values.reverse();
    if (fault === "missing") delete b.timeline_data[0].values;
    if (fault === "baseline") start = "2026-07-01";
    if (fault === "null") b.timeline_data[0].values[0].value = null;
    expect(() =>
      timeline(b, ["claude code", "gpts"], start, "2026-10-10"),
    ).toThrow();
  },
);
it("normalizes actual tweets, follows cursor and deduplicates ids", async () => {
  const first = structuredClone(fixture.tweets),
    second = structuredClone(fixture.tweets);
  first.cursor = "next";
  second.cursor = null;
  second.results[1].id = "older";
  second.results[1].created_at = "Wed Oct 14 00:00:00 +0000 2026";
  mocks.callTool
    .mockResolvedValueOnce({ structuredContent: first })
    .mockResolvedValueOnce({ structuredContent: second });
  const [posts, cost] = await userPosts(
    "OpenAI",
    new Date("2026-10-16T00:00:00Z"),
  );
  expect(posts).toHaveLength(3);
  expect(posts[0].likes).toBe(1869);
  expect(cost).toBe(606);
  expect(
    JSON.parse(mocks.callTool.mock.calls[1][0].arguments.params).cursor,
  ).toBe("next");
  expect(mocks.close).toHaveBeenCalled();
});
it("pagination failure preserves stored vocabulary and does not loop", async () => {
  const body = structuredClone(fixture.tweets);
  body.cursor = "same";
  mocks.callTool.mockResolvedValue({ structuredContent: body });
  await expect(
    userPosts("OpenAI", new Date("2026-10-16T00:00:00Z")),
  ).rejects.toThrow("stalled");
  expect(mocks.callTool).toHaveBeenCalledTimes(2);
  const state = mkdtempSync(join(tmpdir(), "radar-vocab-"));
  try {
    saveSnap(state, "x_vocab", { "old model": "2026-10-15" });
    const c = loadConfig("config.example.json");
    c.x_accounts = { labs: ["OpenAI"], bloggers: [] };
    mocks.callTool.mockRejectedValue(new Error("private header"));
    await expect(xNew(c, state)).rejects.toThrow("transport failed");
    expect(loadSnap(state, "x_vocab")).toEqual({ "old model": "2026-10-15" });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
it("transport errors omit headers, make one attempt and close the client", async () => {
  mocks.callTool.mockRejectedValue(new Error("secret header value"));
  let message = "";
  try {
    await callMany([["google-trends-interest", { q: "a" }]]);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).not.toContain("secret");
  expect(mocks.callTool).toHaveBeenCalledTimes(1);
  expect(mocks.close).toHaveBeenCalled();
});
it("solo crop renormalizes but comparison preserves shared scale; one session serves the batch", async () => {
  const day = today(),
    pts = [
      [-2, 100],
      [-1, 20],
      [0, 40],
    ].map(([n, value]) => ({
      timestamp: Date.parse(shift(day, n) + "T00:00:00Z") / 1000,
      value,
    }));
  mocks.callTool
    .mockResolvedValueOnce({ structuredContent: { timeline_data: pts } })
    .mockResolvedValueOnce({
      structuredContent: {
        timeline_data: pts.map((p) => ({
          ...p,
          values: [
            { query: "a", value: p.value },
            { query: "b", value: 80 },
          ],
        })),
      },
    });
  const [out, cost] = await trendsMany([
    { call_id: "solo", keywords: ["a"], start: shift(day, -1), end: day },
    { call_id: "pair", keywords: ["a", "b"], start: shift(day, -1), end: day },
  ]);
  expect(out.solo.map((p) => p[1])).toEqual([50, 100]);
  expect(out.pair.map((p) => p.slice(1))).toEqual([
    [20, 80],
    [40, 80],
  ]);
  expect(cost).toBe(606);
  expect(mocks.connect).toHaveBeenCalled();
});
