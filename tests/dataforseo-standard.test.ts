import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  standardRelated,
  resumeStandard,
  type StandardRuntime,
} from "../src/dataforseo-standard.js";
import { StandardStore, type RisingRequest } from "../src/dataforseo-store.js";
import { parseStandard } from "../src/trends-related.js";
import { requestFor } from "../src/trends-contract.js";
import { SourceTransportError } from "../src/source-errors.js";

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "dfs-standard-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(state, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const requests = (n: number): RisingRequest[] =>
  Array.from({ length: n }, (_, i) => ({
    call_id: `c${i}`,
    request: requestFor(`root${i}`, 7, "2026-10-17", 8),
  }));
// 保留上游响应包络，真实走 Rising 与范围校验。
function result(id: string, request: Record<string, any>) {
  return {
    status_code: 20000,
    tasks_error: 0,
    cost: 0,
    tasks: [
      {
        id,
        status_code: 20000,
        result: [
          {
            check_url: `https://trends.google.com/trends/explore?cat=${request.category_code}&q=${request.keywords[0]}&date=now%207-d`,
            items: [
              {
                type: "google_trends_queries_list",
                data: {
                  rising: [
                    { query: `child of ${request.keywords[0]}`, value: 200 },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
function fakeRuntime(
  handler?: (path: string, body?: Record<string, any>[]) => unknown,
) {
  let now = 0;
  const remote = new Map<string, Record<string, any>>();
  const api = vi.fn(
    async (
      path: string,
      body?: Record<string, any>[],
      options?: { onSend?: () => void },
    ) => {
      options?.onSend?.();
      const override = await handler?.(path, body);
      if (override) return override;
      if (body) {
        const tasks = body.map((item) => {
          const id = `id-${item.tag}`;
          remote.set(id, item);
          return {
            id,
            status_code: 20100,
            cost: 0.0027,
            data: { tag: item.tag },
          };
        });
        return {
          status_code: 20000,
          cost: tasks.length * 0.0027,
          tasks: tasks.reverse(),
        };
      }
      const id = path.split("/").at(-1)!;
      return result(id, remote.get(id)!);
    },
  );
  const runtime: StandardRuntime = {
    api,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  return { runtime, api, remote };
}

it("103 个任务按 100/3 提交，乱序返回按 tag 关联，提交全部完成后才取结果", async () => {
  const { runtime, api } = fakeRuntime();
  const batch = await standardRelated(
    state,
    requests(103),
    { wait_ms: 0 },
    runtime,
  );
  expect(
    api.mock.calls.filter(([, body]) => body).map(([, body]) => body!.length),
  ).toEqual([100, 3]);
  expect(api.mock.calls.slice(0, 2).every(([, body]) => body)).toBe(true);
  expect(batch.tasks.every((t) => t.status === "completed")).toBe(true);
  const parsed = parseStandard(batch);
  expect(parsed.candidates).toHaveLength(103);
  expect(parsed.candidates[102].appearances[0].root).toBe("root102");
  expect(parsed.cost_micros).toBeCloseTo(103 * 2700);
  expect(batch.tasks.every((t) => t.request.category_code === 8)).toBe(true);
});

it("等待超时保留部分成功；恢复只 GET，已完成结果复用且不重复计算原提交费用", async () => {
  let ready = false;
  const { runtime, api, remote } = fakeRuntime((path) => {
    if (
      !ready &&
      path.includes("/task_get/") &&
      path.endsWith([...remote.keys()][1])
    )
      return {
        status_code: 20000,
        tasks: [{ id: path.split("/").at(-1), status_code: 40602 }],
      };
  });
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 0 },
    runtime,
  );
  expect(batch.tasks.map((t) => t.status)).toEqual(["completed", "submitted"]);
  expect(parseStandard(batch).windows[1].error).toContain("timeout");
  ready = true;
  const before = api.mock.calls.length;
  const resumed = await resumeStandard(
    state,
    batch.batch_id,
    { wait_ms: 0 },
    runtime,
  );
  expect(api.mock.calls.slice(before).every(([, body]) => !body)).toBe(true);
  expect(parseStandard(resumed, false).cost_micros).toBe(0);
  expect(parseStandard(resumed, false).candidates).toHaveLength(2);
  const collected = api.mock.calls.length;
  await resumeStandard(state, batch.batch_id, {}, runtime);
  expect(api).toHaveBeenCalledTimes(collected);
});

it("未知提交和提交期间中断均不重发，恢复也不调用付费 POST", async () => {
  const { runtime, api } = fakeRuntime(() => {
    throw new SourceTransportError("timeout");
  });
  const batch = await standardRelated(
    state,
    requests(1),
    { wait_ms: 0 },
    runtime,
  );
  expect(batch.tasks[0].status).toBe("unknown");
  const store = new StandardStore(state);
  try {
    store.update(batch.tasks[0].local_id, { status: "submitting" });
  } finally {
    store.close();
  }
  const resumed = await resumeStandard(state, batch.batch_id, {}, runtime);
  expect(resumed.tasks[0].status).toBe("unknown");
  expect(api).toHaveBeenCalledTimes(1);
});

it("任务明确拒绝、缺少 tag 不影响其他任务，缺项不能按数组下标冒充关联", async () => {
  const { runtime } = fakeRuntime((_path, body) =>
    body
      ? {
          status_code: 20000,
          tasks: [
            {
              id: "rejected",
              status_code: 40501,
              cost: 0,
              data: { tag: body[0].tag },
            },
            { id: "unmatched", status_code: 20100, cost: 0.0027, data: {} },
          ],
        }
      : undefined,
  );
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 0 },
    runtime,
  );
  expect(batch.tasks.map((t) => t.status)).toEqual(["failed", "unknown"]);
  expect(parseStandard(batch).candidates).toEqual([]);
  expect(parseStandard(batch).cost_complete).toBe(false);
});

it("ready 统一轮询只取本批任务，终态错误与成功结果隔离", async () => {
  let gets = 0;
  const { runtime, api, remote } = fakeRuntime((path) => {
    if (path.endsWith("tasks_ready"))
      return {
        status_code: 20000,
        tasks: [
          {
            result: [
              { id: "foreign" },
              ...[...remote.keys()].map((id) => ({ id })),
            ],
          },
        ],
      };
    if (path.includes("task_get")) {
      gets++;
      if (gets <= 2)
        return {
          status_code: 20000,
          tasks: [{ id: path.split("/").at(-1), status_code: 40602 }],
        };
      if (gets === 3)
        return {
          status_code: 20000,
          tasks: [{ id: path.split("/").at(-1), status_code: 40501 }],
        };
    }
  });
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 100, poll_ms: 20 },
    runtime,
  );
  expect(batch.tasks.map((t) => t.status).sort()).toEqual([
    "completed",
    "failed",
  ]);
  expect(api.mock.calls.some(([path]) => path.endsWith("/foreign"))).toBe(
    false,
  );
  expect(parseStandard(batch).candidates).toHaveLength(1);
});

it("拒绝 top 冒充 Rising 及分类回显不符，不改变通过词的来源", async () => {
  const { runtime } = fakeRuntime();
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 0 },
    runtime,
  );
  const original = structuredClone(batch);
  batch.tasks[0].response!.tasks[0].result[0].items[0].data = {
    top: [{ query: "fake" }],
  };
  batch.tasks[1].response!.tasks[0].result[0].check_url =
    "https://trends.google.com/trends/explore?cat=0&q=root1&date=now%207-d";
  expect(parseStandard(batch).candidates).toEqual([]);
  expect(
    parseStandard(batch).windows.every((w: Record<string, any>) => w.error),
  ).toBe(true);
  expect(parseStandard(original).candidates).toHaveLength(2);
});

it("非法等待参数在付费提交前拒绝", async () => {
  const { runtime, api } = fakeRuntime();
  await expect(
    standardRelated(state, requests(1), { concurrency: 0 }, runtime),
  ).rejects.toThrow(/options/);
  expect(api).not.toHaveBeenCalled();
});

it("并发取回不超过五个；程序异常等待其他在途请求结束后再关闭数据库", async () => {
  let active = 0,
    peak = 0;
  const { runtime, api } = fakeRuntime(async (path) => {
    if (!path.includes("/task_get/")) return;
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
  });
  await standardRelated(state, requests(12), { wait_ms: 0 }, runtime);
  expect(peak).toBe(5);
  expect(api.mock.calls.filter(([, body]) => body)).toHaveLength(1);
  let completed = 0;
  const broken = fakeRuntime(async (path) => {
    if (!path.includes("/task_get/")) return;
    if (!completed++) throw new Error("program bug");
    await Promise.resolve();
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    standardRelated(state, requests(8), { wait_ms: 0 }, broken.runtime),
  ).rejects.toThrow("program bug");
  expect(completed).toBeGreaterThan(1);
  expect(completed).toBeLessThanOrEqual(5);
});

it("取回预算到期不再启动剩余任务，保留 submitted 供恢复", async () => {
  const fake = fakeRuntime();
  const original = fake.runtime.api;
  let clock = 0;
  fake.runtime.now = () => clock;
  fake.runtime.api = async (path, body, options) => {
    const response = await original(path, body, options);
    if (!body) {
      expect(options?.timeout_ms).toBeLessThanOrEqual(90000);
      clock += 1000;
    }
    return response;
  };
  const batch = await standardRelated(
    state,
    requests(12),
    { wait_ms: 1, concurrency: 1 },
    fake.runtime,
  );
  expect(batch.tasks.filter((t) => t.status === "completed")).toHaveLength(1);
  expect(batch.tasks.filter((t) => t.status === "submitted")).toHaveLength(11);
});

it("发送前鉴权失败不会留下未知收费任务", async () => {
  const fake = fakeRuntime();
  fake.runtime.api = async () => {
    throw new SourceTransportError("refresh failed");
  };
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 0 },
    fake.runtime,
  );
  expect(batch.tasks.map((t) => t.status)).toEqual(["failed", "failed"]);
});

it("坏 Rising 行隔离在窗口内，不丢弃其他成功结果", async () => {
  const fake = fakeRuntime();
  const batch = await standardRelated(
    state,
    requests(2),
    { wait_ms: 0 },
    fake.runtime,
  );
  batch.tasks[0].response!.tasks[0].result[0].items[0].data.rising = [null];
  const parsed = parseStandard(batch);
  expect(parsed.candidates).toHaveLength(1);
  expect(parsed.collection_status).toMatchObject({ complete: 1, failed: 1 });
});
