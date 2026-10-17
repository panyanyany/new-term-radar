import { currentUsage, usageLines } from "./usage.js";
import { t, type Data } from "./core.js";
// 完整费用以请求账本为准；模块声明不完整时只展示已知小计。
export function costSummary(...blocks: Data[]) {
  const ledger = currentUsage();
  return {
    ...(ledger
      ? { run_id: ledger.run_id, unpriced_calls: ledger.unpriced }
      : {}),
    cost_complete: ledger
      ? ledger.unpriced === 0
      : blocks.every((b) => b.cost_complete !== false),
    cost_micros:
      ledger?.cost_micros ??
      blocks.reduce((s, b) => s + Number(b.cost_micros ?? 0), 0),
    model_unpriced_calls: blocks.reduce(
      (n, b) => n + Number(b.model_unpriced_calls ?? 0),
      0,
    ),
  };
}
// 数据与模型费用合并展示，缺失 token 用量或价格时显式提醒。
export function costLines(...blocks: Data[]): string[] {
  const total = costSummary(...blocks);
  const lines = [
    total.cost_complete
      ? t("cost", { cost: "$" + (total.cost_micros / 1e6).toFixed(4) })
      : `费用估算不完整：已知费用小计 $${(total.cost_micros / 1e6).toFixed(4)}（费用不完整，不代表总额）`,
  ];
  const missing = total.model_unpriced_calls;
  const ledger = currentUsage();
  if (ledger?.unpriced)
    lines.push(t("cost_unpriced_requests", { n: ledger.unpriced }));
  else if (missing) lines.push(t("cost_unpriced", { n: missing }));
  if (ledger) lines.push(...usageLines(ledger));
  return lines;
}
