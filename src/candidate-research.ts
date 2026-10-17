import { classifyCandidates } from "./candidate-kind.js";
import { googleSearchResult, searchTermPattern } from "./scrappa.js";
import { errorText, type Data } from "./core.js";
import { sourceFailure } from "./source-errors.js";

// 所有发现来源共用取证和分类，避免体育赛事拦截规则分叉。
export async function researchCandidates(
  rows: Data[],
  model: string,
): Promise<Data> {
  // 普通搜索没有原词证据时仅补一次精确查询；两次响应均保留便于排查。
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        try {
          const result = await googleSearchResult(row.term, "broad");
          row.evidence = [...result.evidence, ...(row.page_evidence ?? [])];
          row.search_response = {
            query: result.query,
            organic_results: result.rawResults,
          };
          const match = searchTermPattern(row.term);
          if (
            !result.evidence.some((e) => match.test(`${e.title} ${e.text}`))
          ) {
            const exact = await googleSearchResult(row.term, "exact");
            row.exact_search_response = {
              query: exact.query,
              organic_results: exact.rawResults,
            };
            // 精确结果优先；无匹配时仍保留普通结果，交给 AI 记录不确定性。
            if (exact.evidence.length)
              row.evidence = [...exact.evidence, ...(row.page_evidence ?? [])];
          }
        } catch (e) {
          sourceFailure("google_search", { term: row.term }, e);
          row.search_error = errorText(e);
          row.evidence ??= row.page_evidence ?? [];
        }
        row.context = row.evidence.length
          ? `Google 搜索资料：${JSON.stringify(row.evidence)}`
          : "Google 搜索未找到可核实资料，必须标注含义待确认，不可推测。";
      }
    }),
  );
  const classified = await classifyCandidates(rows, model);
  // 后续解释优先使用分类所引用的相关证据，完整搜索结果仍保留在原字段中。
  for (const row of classified.candidates) {
    const indices: number[] = row.classification?.evidence_indices ?? [];
    if (indices.length)
      row.context = `Google 搜索资料：${JSON.stringify(indices.map((i) => row.evidence[i]))}`;
  }
  return classified;
}
