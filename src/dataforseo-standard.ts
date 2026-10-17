import { setTimeout as delay } from "node:timers/promises";
import { dataforseoRequest, TRENDS_PATH } from "./dataforseo-api.js";
import {
  StandardStore,
  type RisingRequest,
  type StandardTask,
} from "./dataforseo-store.js";
import { type Data, errorText } from "./core.js";
import {
  expectedSourceError,
  sourceFailure,
  SourceDataError,
} from "./source-errors.js";

export interface StandardOptions {
  wait_ms?: number;
  poll_ms?: number;
  concurrency?: number;
}
// 注入时钟与 HTTP 边界，测试无需等待或请求收费接口。
export interface StandardRuntime {
  api: typeof dataforseoRequest;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
}
const runtime: StandardRuntime = {
  api: dataforseoRequest,
  now: Date.now,
  sleep: delay,
};
const pending = (task: StandardTask) => task.status === "submitted";

// 请求顺序允许上游乱序；只按提交前生成的 tag 匹配，绝不按数组位置猜测。
async function submit(
  store: StandardStore,
  batch: string,
  api: StandardRuntime["api"],
) {
  const queued = store.list(batch);
  for (let i = 0; i < queued.length; i += 100) {
    const chunk = queued.slice(i, i + 100);
    let sent = false;
    let response: Data;
    try {
      response = await api(
        `${TRENDS_PATH}/task_post`,
        chunk.map((row) => ({ ...row.request, tag: row.local_id })),
        {
          onSend: () => {
            sent = true;
            store.transaction(() => {
              for (const row of chunk)
                store.update(row.local_id, { status: "submitting" });
            });
          },
        },
      );
    } catch (e) {
      // 错误示范：POST 超时后重发同一批，可能创建两份收费任务。
      store.transaction(() => {
        for (const row of chunk)
          store.update(row.local_id, {
            status: sent ? "unknown" : "failed",
            error: errorText(e),
          });
      });
      sourceFailure("dataforseo_submit", { batch_id: batch }, e);
      continue;
    }
    const tasks: Data[] = response.tasks;
    store.transaction(() => {
      for (const row of chunk) {
        const matches = tasks.filter((task) => task.data?.tag === row.local_id);
        const task = matches.length === 1 ? matches[0] : undefined;
        if (!task) {
          store.update(row.local_id, {
            status: "unknown",
            error: "Missing or duplicate submission tag",
            response,
          });
          continue;
        }
        const created =
          task.status_code === 20100 &&
          typeof task.id === "string" &&
          task.id.length > 0;
        store.update(row.local_id, {
          status: created
            ? "submitted"
            : task.status_code === 20100
              ? "unknown"
              : "failed",
          task_id: typeof task.id === "string" && task.id ? task.id : null,
          cost_micros:
            typeof task.cost === "number" &&
            Number.isFinite(task.cost) &&
            task.cost >= 0
              ? task.cost * 1e6
              : null,
          error: created ? null : `Submission status ${task.status_code}`,
          response: { ...response, tasks: [task] },
        });
      }
    });
  }
}

// 按固定 worker 数取回，避免一次 Promise.all 放大并发；只操作本批已知任务 ID。
async function collect(
  store: StandardStore,
  tasks: StandardTask[],
  api: StandardRuntime["api"],
  concurrency: number,
  rt: StandardRuntime,
  deadline: number,
) {
  const queue = [...tasks];
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (queue.length && rt.now() < deadline) {
        const row = queue.shift()!;
        try {
          const response = await api(
            `${TRENDS_PATH}/task_get/${encodeURIComponent(row.task_id!)}`,
            undefined,
            { timeout_ms: 90000, remaining_ms: () => deadline - rt.now() },
          );
          const task = response.tasks?.[0];
          if (!task || task.id !== row.task_id)
            throw new SourceDataError("DataForSEO returned mismatched task ID");
          if ([20100, 40601, 40602].includes(task.status_code)) continue;
          if (task.status_code !== 20000) {
            store.update(row.local_id, {
              status: "failed",
              error: `Task status ${task.status_code}`,
              response,
            });
            continue;
          }
          // 成功结果先归档，再进入 Rising 解析；恢复后不重复收费、不丢原始证据。
          store.update(row.local_id, {
            status: "completed",
            response,
            error: null,
          });
        } catch (e) {
          store.update(row.local_id, { error: errorText(e) });
          if (!expectedSourceError(e)) queue.length = 0;
          sourceFailure(
            "dataforseo_collect",
            { batch_id: row.batch_id, task_id: row.task_id },
            e,
          );
        }
      }
    }),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

// 在提交付费任务前验证运行参数，错误配置不能先扣费再报错。
function validateOptions(options: StandardOptions) {
  const wait = options.wait_ms ?? 45 * 60000;
  const interval = options.poll_ms ?? 30000;
  const concurrency = options.concurrency ?? 5;
  if (
    !Number.isInteger(wait) ||
    wait < 0 ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 10
  )
    throw new Error("Invalid DataForSEO polling options");
}

// 提交和恢复共用等待流程；恢复只 GET，绝不再次 POST，包括 submitting/unknown 状态。
async function waitForBatch(
  store: StandardStore,
  batch: string,
  options: StandardOptions,
  rt: StandardRuntime,
) {
  const wait = options.wait_ms ?? 45 * 60000;
  const interval = options.poll_ms ?? 30000;
  const concurrency = options.concurrency ?? 5;
  const deadline = rt.now() + wait;
  // wait=0 逐个探测一次；正等待预算到期后不再启动新请求。
  const collectionDeadline = wait === 0 ? Infinity : deadline;
  let probeAt = rt.now();
  while (
    store.list(batch).some(pending) &&
    (wait === 0 || rt.now() < deadline)
  ) {
    const unfinished = store.list(batch).filter(pending);
    // 启动及每五分钟直接探测已知任务，覆盖其他客户端已取走 ready 条目及终态错误。
    if (rt.now() >= probeAt || rt.now() >= deadline) {
      await collect(
        store,
        unfinished,
        rt.api,
        concurrency,
        rt,
        collectionDeadline,
      );
      probeAt = rt.now() + 5 * 60000;
    } else {
      try {
        const response = await rt.api(`${TRENDS_PATH}/tasks_ready`, undefined, {
          timeout_ms: 90000,
          remaining_ms: () => deadline - rt.now(),
        });
        const ready = new Set(
          response.tasks
            .flatMap((task: Data) => task.result ?? [])
            .map((task: Data) => task.id),
        );
        await collect(
          store,
          unfinished.filter((task) => ready.has(task.task_id)),
          rt.api,
          concurrency,
          rt,
          collectionDeadline,
        );
      } catch (e) {
        sourceFailure("dataforseo_ready", { batch_id: batch }, e);
      }
    }
    const left = store.list(batch).filter(pending);
    if (!left.length || rt.now() >= deadline) break;
    console.warn(
      JSON.stringify({
        level: "info",
        stage: "dataforseo_wait",
        batch_id: batch,
        pending: left.length,
        remaining_seconds: Math.ceil((deadline - rt.now()) / 1000),
      }),
    );
    await rt.sleep(Math.min(interval, Math.max(0, deadline - rt.now())));
  }
  const tasks = store.list(batch);
  // submitting 表示上次在 POST 期间中断，不能认定没有付费任务。
  for (const row of tasks)
    if (row.status === "submitting") {
      store.update(row.local_id, {
        status: "unknown",
        error: "Interrupted during submission; reconcile by tag before retry",
      });
    }
  return { batch_id: batch, tasks: store.list(batch) };
}

export async function standardRelated(
  state: string,
  requests: RisingRequest[],
  options: StandardOptions = {},
  rt = runtime,
) {
  validateOptions(options);
  const store = new StandardStore(state);
  try {
    const batch = store.create(requests);
    console.warn(
      JSON.stringify({
        level: "info",
        stage: "dataforseo_submit",
        batch_id: batch,
        tasks: requests.length,
      }),
    );
    await submit(store, batch, rt.api);
    return await waitForBatch(store, batch, options, rt);
  } finally {
    store.close();
  }
}
export async function resumeStandard(
  state: string,
  batch: string,
  options: StandardOptions = {},
  rt = runtime,
) {
  validateOptions(options);
  const store = new StandardStore(state);
  try {
    if (!store.list(batch).length)
      throw new Error("DataForSEO batch not found");
    return await waitForBatch(store, batch, options, rt);
  } finally {
    store.close();
  }
}
