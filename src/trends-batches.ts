import { randomUUID } from "node:crypto";
import { saveSnap } from "./core.js";
import { type SecondLevelSnapshot } from "./trends-expansion.js";

// 复用现有 gzip + 临时文件原子替换；仅归档，不自动重放或恢复付费任务。
export function saveSecondLevelBatch(
  state: string,
  snapshot: SecondLevelSnapshot,
): string {
  const batch = randomUUID();
  saveSnap(state, `trends-batches/${batch}`, { ...snapshot, batch_id: batch });
  return batch;
}
