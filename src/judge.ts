import { withModelCosts } from "./model-costs.js";
import { chat } from "./aisa.js";
import { errorText, type Data } from "./core.js";
import prompts from "./prompts.json" with { type: "json" };
// 模型输出只接受合法索引与有限的 0–1 分数；失败时保留未评分线索。
export function parse(answer: string, n: number): Record<number, number> {
  try {
    const items = JSON.parse(answer.match(/\[.*\]/s)?.[0] ?? "[]"),
      out: Record<number, number> = {};
    if (!Array.isArray(items)) return out;
    for (const it of items) {
      if (!it || it.i == null || it.score == null) continue;
      const i = Math.trunc(Number(it.i)),
        s = Number(it.score);
      if (
        Number.isInteger(i) &&
        i >= 0 &&
        i < n &&
        Number.isFinite(s) &&
        s >= 0 &&
        s <= 1
      )
        out[i] = s;
    }
    return out;
  } catch {
    return {};
  }
}
// 评分与研究分别计价，汇总报告不会重复累计。
export async function score(rows: Data[], model: string): Promise<Data> {
  return withModelCosts(() => scoreRows(rows, model));
}
async function scoreRows(rows: Data[], model: string): Promise<Data> {
  if (!model) return { judged: 0, skipped: true };
  let judged = 0;
  for (let start = 0; start < rows.length; start += 25) {
    const chunk = rows.slice(start, start + 25);
    try {
      const scores = parse(
        await chat(
          model,
          prompts.judge,
          JSON.stringify(
            chunk.map((r, i) => ({
              i,
              term: r.term,
              examples: (r.examples ?? [])
                .slice(0, 3)
                .map((e: string) => e.slice(0, 160)),
            })),
          ),
        ),
        chunk.length,
      );
      for (const [i, s] of Object.entries(scores)) chunk[Number(i)].named = s;
      judged += Object.keys(scores).length;
    } catch (e) {
      return { judged, error: errorText(e) };
    }
  }
  return { judged };
}
