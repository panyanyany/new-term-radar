import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadSnap, saveSnap, type Data } from "./core.js";

const batchSchema = z
  .object({
    created_at: z.string().datetime(),
    sites: z.record(z.string(), z.unknown()),
    candidates: z.array(
      z
        .object({
          keyword: z.string(),
          url: z.string().url(),
          anchors: z.array(z.string()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
// 原始批次独立于 URL 去重快照；先归档再推进基线，后续失败也不丢输入。
export function savePageBatch(
  state: string,
  pages: Data,
  batch: string = randomUUID(),
  createdAt = new Date().toISOString(),
): string {
  saveSnap(state, `page-batches/${batch}`, { ...pages, created_at: createdAt });
  return batch;
}
// 只接受明确批次 ID，不扫描或自动回灌历史候选。
export function loadPageBatch(state: string, batch: string): Data {
  if (!/^[0-9a-f-]{36}$/i.test(batch)) throw new Error("invalid page batch ID");
  const saved = loadSnap<unknown>(state, `page-batches/${batch}`);
  if (!saved) throw new Error(`page batch not found: ${batch}`);
  return batchSchema.parse(saved);
}
