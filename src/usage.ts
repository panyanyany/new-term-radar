import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Data } from "./core.js";

const context = new AsyncLocalStorage<{
  db: Database.Database;
  run: string;
  command: string;
  module: string;
}>();
const schema = `CREATE TABLE IF NOT EXISTS api_usage (
 id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, started_at TEXT NOT NULL,
 command TEXT NOT NULL, module TEXT NOT NULL, provider TEXT NOT NULL,
 endpoint TEXT NOT NULL, model TEXT, request_id TEXT, status TEXT NOT NULL,
 requests INTEGER NOT NULL DEFAULT 1, input_tokens INTEGER, output_tokens INTEGER,
 cached_tokens INTEGER, cost_micros REAL, pricing_source TEXT NOT NULL,
 rates TEXT, pricing_status TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS api_usage_time ON api_usage(started_at);
 CREATE INDEX IF NOT EXISTS api_usage_run ON api_usage(run_id);`;
// 账本复用本地数据库；按请求同步落盘，不存请求参数、正文或错误消息。
function open(state: string) {
  mkdirSync(state, { recursive: true });
  const db = new Database(join(state, "radar.db"));
  db.pragma("busy_timeout = 5000");
  db.exec(schema);
  return db;
}
export async function withUsageRun<T>(
  state: string,
  command: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (context.getStore()) return fn();
  const db = open(state);
  try {
    return await context.run(
      {
        db,
        run: randomUUID(),
        command,
        module: command === "keywords" ? "usecases" : command,
      },
      fn,
    );
  } finally {
    db.close();
  }
}
// 子模块继承运行 ID，AsyncLocalStorage 隔离并行 MCP 调用。
export function withUsageModule<T>(module: string, fn: () => T): T {
  const current = context.getStore();
  return current ? context.run({ ...current, module }, fn) : fn();
}
export type Price = {
  success?: boolean;
  cost_micros: number | null;
  pricing_source: string;
  rates?: Data;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  request_id?: string;
};
// 请求发出前写 pending，进程中断仍能看到未完成请求；费用未知使用 NULL。
export async function tracked<T>(
  meta: { provider: string; endpoint: string; model?: string },
  fn: () => Promise<T>,
  price: (value?: T) => Price,
): Promise<T> {
  const c = context.getStore();
  if (!c) return fn();
  const initial = price();
  const id = c.db
    .prepare(
      `INSERT INTO api_usage(run_id,started_at,command,module,provider,endpoint,model,status,pricing_source,pricing_status) VALUES(?,?,?,?,?,?,?,'pending',?,'unknown')`,
    )
    .run(
      c.run,
      new Date().toISOString(),
      c.command,
      c.module,
      meta.provider,
      meta.endpoint,
      meta.model ?? null,
      initial.pricing_source,
    ).lastInsertRowid;
  let result: T | undefined,
    status = "failed";
  try {
    result = await fn();
    status = "success";
    return result;
  } finally {
    const p = price(result);
    if (p.success === false) status = "failed";
    c.db
      .prepare(
        `UPDATE api_usage SET status=?,cost_micros=?,pricing_source=?,rates=?,input_tokens=?,output_tokens=?,cached_tokens=?,request_id=?,pricing_status=? WHERE id=?`,
      )
      .run(
        status,
        p.cost_micros,
        p.pricing_source,
        JSON.stringify(p.rates ?? {}),
        p.input_tokens ?? null,
        p.output_tokens ?? null,
        p.cached_tokens ?? null,
        p.request_id ?? null,
        p.cost_micros == null ? "unknown" : "priced",
        id,
      );
  }
}
// 动态分组仅允许固定列名，SQL 参数绑定日期与运行 ID。
export function usageSummary(
  state: string,
  days = 30,
  by = "provider",
  runId?: string,
): Data {
  if (!["provider", "module", "model", "endpoint", "day"].includes(by))
    throw new Error("--by: provider | module | model | endpoint | day");
  const db = open(state);
  try {
    const group =
      by === "day" ? "substr(started_at,1,10)" : `COALESCE(${by}, '—')`;
    const where = runId ? "run_id = ?" : "started_at >= ?";
    const value = runId ?? new Date(Date.now() - days * 86400000).toISOString();
    const rows = db
      .prepare(
        `SELECT ${group} AS name, count(*) AS requests, sum(status='failed') AS failed, sum(status='pending') AS pending, sum(pricing_status='unknown') AS unpriced, COALESCE(sum(cost_micros),0) AS cost_micros, COALESCE(sum(input_tokens),0) AS input_tokens, COALESCE(sum(output_tokens),0) AS output_tokens, COALESCE(sum(cached_tokens),0) AS cached_tokens FROM api_usage WHERE ${where} GROUP BY ${group} ORDER BY cost_micros DESC, name`,
      )
      .all(value) as Data[];
    const total = rows.reduce((s, r) => s + r.cost_micros, 0);
    return {
      days,
      by,
      ...(runId ? { run_id: runId } : {}),
      cost_micros: total,
      requests: rows.reduce((s, r) => s + r.requests, 0),
      unpriced: rows.reduce((s, r) => s + r.unpriced, 0),
      rows: rows.map((r) => ({
        ...r,
        percent: total ? (r.cost_micros / total) * 100 : 0,
      })),
    };
  } finally {
    db.close();
  }
}
// 当前报告复用运行内明细，失败模块也不会丢失已完成请求费用。
export function currentUsage(): Data | undefined {
  const c = context.getStore();
  // 与当前连接共存的只读聚合；连接生命周期由外层运行范围管理。
  if (!c) return;
  const rows = c.db
    .prepare(
      `SELECT provider AS name,count(*) AS requests,sum(status='failed') AS failed,sum(pricing_status='unknown') AS unpriced,COALESCE(sum(input_tokens),0) AS input_tokens,COALESCE(sum(output_tokens),0) AS output_tokens,COALESCE(sum(cached_tokens),0) AS cached_tokens,COALESCE(sum(cost_micros),0) AS cost_micros FROM api_usage WHERE run_id=? GROUP BY provider ORDER BY cost_micros DESC`,
    )
    .all(c.run) as Data[];
  return {
    run_id: c.run,
    cost_micros: rows.reduce((s, r) => s + r.cost_micros, 0),
    unpriced: rows.reduce((s, r) => s + r.unpriced, 0),
    rows,
  };
}
// 控制台与报告共用分布表；百分比只以已计价费用为分母。
export function usageLines(summary: Data): string[] {
  return [
    "",
    "| 费用来源 | 请求数 | 失败 | 未计价 | 输入/输出 token | 缓存 token | 费用 USD | 占已计价费用 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...summary.rows.map(
      (r: Data) =>
        `| ${r.name} | ${r.requests} | ${r.failed} | ${r.unpriced} | ${r.input_tokens ?? 0}/${r.output_tokens ?? 0} | ${r.cached_tokens ?? 0} | $${(r.cost_micros / 1e6).toFixed(4)} | ${(summary.cost_micros ? (r.cost_micros / summary.cost_micros) * 100 : 0).toFixed(1)}% |`,
    ),
    `已计价合计 $${(summary.cost_micros / 1e6).toFixed(4)}；未计价 ${summary.unpriced} 次（不视为免费）。`,
  ];
}
