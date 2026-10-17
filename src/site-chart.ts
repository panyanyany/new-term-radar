import { z } from "zod";

// 曲线元组保留共同尺度：[毫秒时间戳，当前词热度，参考词热度]，禁止分别归一化。
const seriesSchema = z
  .array(
    z.tuple([
      z.number().nonnegative().max(8640000000000000),
      z.number().min(0).max(100),
      z.number().min(0).max(100),
    ]),
  )
  .min(2);

// SVG 只插入校验后的数字与派生日期；缺数据时明确留空，不补造零值。
export function renderTrendChart(input: unknown): string {
  const parsed = seriesSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.some((p, i, rows) => i > 0 && p[0] <= rows[i - 1][0])
  )
    return '<span class="no-curve">暂无曲线</span>';
  const rows = parsed.data;
  const start = rows[0][0],
    end = rows.at(-1)![0];
  // 参考词均值优先落在纵轴中间；任何一条线的峰值都必须完整保留。
  // 错误示范：两线分别缩放会扭曲比例，固定上限 100 又会压平低热度。
  const referenceMean =
    rows.reduce((sum, point) => sum + point[2], 0) / rows.length;
  const peak = Math.max(...rows.flatMap((point) => [point[1], point[2]]));
  const upper = Math.min(
    100,
    Math.ceil(Math.max(1, referenceMean * 2, peak * 1.05) * 10) / 10,
  );
  const middle = Number((upper / 2).toFixed(2));
  const path = (column: 1 | 2) =>
    rows
      .map((point, i) => {
        const x = 26 + ((point[0] - start) / (end - start)) * 182;
        const y = 8 + ((upper - point[column]) / upper) * 44;
        return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  const date = (at: number) => new Date(at).toISOString().slice(5, 10);
  return `<svg class="trend-chart" viewBox="0 0 218 72" role="img" aria-label="七天相对热度，0 至 ${upper}">
  <title>${date(start)} 至 ${date(end)} · 0–${upper}</title>
  <path class="chart-grid" d="M26,8H208 M26,30H208 M26,52H208"/>
  <text x="20" y="33" text-anchor="end">${middle}</text>
  <text class="axis-max" x="20" y="11" text-anchor="end">${upper}</text><text x="20" y="55" text-anchor="end">0</text>
  <path class="reference-line" d="${path(2)}"/><path class="term-line" d="${path(1)}"/>
  <text x="26" y="67">${date(start)}</text><text x="208" y="67" text-anchor="end">${date(end)}</text></svg>`;
}
