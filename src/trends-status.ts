import { z } from "zod";
import { type Data } from "./core.js";
// 公开状态仅含计数与恢复批次号，不携带请求、错误详情或费用。
export const collectionStatusSchema = z.object({
  complete: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  batch_ids: z.array(z.string()),
});
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;
// 解析失败即使远端任务已完成，也不能算作成功采集；兼容同步 AIsa 窗口。
export function collectionStatus(windows: Data[]): CollectionStatus {
  const summary: CollectionStatus = {
    complete: 0,
    pending: 0,
    failed: 0,
    unknown: 0,
    batch_ids: [],
  };
  for (const row of windows) {
    if (["submitted", "queued"].includes(row.status)) summary.pending++;
    else if (["unknown", "submitting"].includes(row.status)) summary.unknown++;
    else if (row.error || row.status === "failed") summary.failed++;
    else summary.complete++;
    if (
      typeof row.batch_id === "string" &&
      !summary.batch_ids.includes(row.batch_id)
    )
      summary.batch_ids.push(row.batch_id);
  }
  return summary;
}
// 完整空结果不告警；部分结果仍正常展示，不冒充整轮采集成功。
export function collectionNotice(status?: CollectionStatus): string {
  if (!status || !(status.pending + status.failed + status.unknown)) return "";
  return `上涨词采集未完整：完成 ${status.complete}，待取回 ${status.pending}，失败 ${status.failed}，状态未知 ${status.unknown}。当前仅展示已取得的结果。`;
}
