import { compact, type Data } from "./core.js";
import { termKey as identity } from "./term-observations.js";

// 只收集本轮原始候选；已筛选词表通过显式参数交给报告，不读取隐藏状态。
export interface BriefTerm {
  term: string;
  context: string;
  explanation?: string;
  first_seen_at?: string;
  source?: "trends";
}
// 合并本轮各来源并按本地词键去重，不读取历史或已筛选词表。
export function collectTerms(
  lead: Data[],
  blocks: Data,
  keywords: Data,
): BriefTerm[] {
  const rows: BriefTerm[] = [
    ...(blocks.trends?.candidates ?? []).map((r: Data) => ({
      term: r.term,
      context: r.context,
      source: "trends" as const,
    })),
    ...lead.map((r) => ({
      term: r.term,
      context: r.examples?.join("; ") || r.signals?.join("; ") || "",
    })),
    ...(keywords.rows ?? []).map((r: Data) => ({
      term: r.phrase ?? r.term,
      context: compact(
        [r.evidence, r.quote, r.names?.join(", ")].filter(Boolean).join("; "),
      ),
    })),
    ...(blocks.sitemap?.pages?.candidates ?? [])
      .filter((r: Data) => r.keyword)
      .map((r: Data) => ({
        term: r.keyword,
        context:
          r.context ||
          `网页标题：${r.anchors?.find((a: string) => a.toLowerCase().includes(r.keyword.toLowerCase())) ?? r.keyword}；来源 ${r.url}`,
        explanation: r.explanation,
      })),
  ];
  const unique = new Map<string, BriefTerm>();
  for (const row of rows)
    if (row.term && !unique.has(identity(row.term)))
      unique.set(identity(row.term), row);
  return [...unique.values()];
}
