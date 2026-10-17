import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { currentUsage } from "./usage.js";
import { type Data } from "./core.js";
export interface RisingRequest {
  call_id: string;
  request: Data;
}
export interface StandardTask extends RisingRequest {
  local_id: string;
  batch_id: string;
  task_id: string | null;
  status:
    "queued" | "submitting" | "unknown" | "submitted" | "completed" | "failed";
  response: Data | null;
  cost_micros: number | null;
  error: string | null;
}
// 轻量任务归档与现有账本共用 SQLite；状态由应用控制，不新增 ENUM/CHECK。
export class StandardStore {
  private db: Database.Database;
  constructor(state: string) {
    mkdirSync(state, { recursive: true });
    this.db = new Database(join(state, "radar.db"));
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS dataforseo_trends_tasks (
      local_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, run_id TEXT,
      call_id TEXT NOT NULL, request_json TEXT NOT NULL, task_id TEXT UNIQUE,
      status TEXT NOT NULL, response_json TEXT, cost_micros REAL, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS dataforseo_trends_batch ON dataforseo_trends_tasks(batch_id);`);
  }
  // 提交前创建本地 ID，作为上游 tag；未知提交可人工按 tag 对账。
  create(requests: RisingRequest[]): string {
    const id = randomUUID(),
      now = new Date().toISOString(),
      run = currentUsage()?.run_id ?? null;
    const insert = this.db.prepare(`INSERT INTO dataforseo_trends_tasks
      (local_id,batch_id,run_id,call_id,request_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)`);
    this.db.transaction(() => {
      for (const item of requests)
        insert.run(
          randomUUID(),
          id,
          run,
          item.call_id,
          JSON.stringify(item.request),
          now,
          now,
        );
    })();
    return id;
  }
  list(batch: string): StandardTask[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM dataforseo_trends_tasks WHERE batch_id=? ORDER BY rowid",
      )
      .all(batch) as Data[];
    return rows.map((row) => ({
      local_id: row.local_id,
      batch_id: row.batch_id,
      call_id: row.call_id,
      request: JSON.parse(row.request_json),
      task_id: row.task_id,
      status: row.status,
      response: row.response_json ? JSON.parse(row.response_json) : null,
      cost_micros: row.cost_micros,
      error: row.error,
    }));
  }
  update(
    id: string,
    change: Partial<
      Pick<
        StandardTask,
        "status" | "task_id" | "response" | "cost_micros" | "error"
      >
    >,
  ) {
    const columns = Object.entries(change).map(([key, value]) => [
      key === "response" ? "response_json" : key,
      key === "response" ? JSON.stringify(value) : value,
    ]);
    this.db
      .prepare(
        `UPDATE dataforseo_trends_tasks SET ${columns.map(([key]) => `${key}=?`).join(",")},updated_at=? WHERE local_id=?`,
      )
      .run(...columns.map(([, value]) => value), new Date().toISOString(), id);
  }
  // 一次提交响应的本地更新合并为事务，减少逐任务 fsync。
  transaction(fn: () => void) {
    this.db.transaction(fn)();
  }
  close() {
    this.db.close();
  }
}
