import { AsyncLocalStorage } from "node:async_hooks";
import { type Price } from "./usage.js";
import { type Data } from "./core.js";
// 单位为美元/百万 token；既有模型采用 OpenRouter 快照，DeepSeek 使用用户提供单价。
// https://openrouter.ai/api/v1/models；只用于估算，不改变实际 AIsa 调用渠道。
const PRICES: Record<
  string,
  { input: number; output: number; cached: number }
> = {
  // 未提供缓存优惠单价，缓存输入也按普通输入估算。
  "deepseek-v4.1-flash": { input: 0.283, output: 1.131, cached: 0.283 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "claude-sonnet-4.6": { input: 3, output: 15, cached: 0.3 },
};
type Usage = { cost_micros: number; unpriced_calls: number };
const scope = new AsyncLocalStorage<Usage>();
// 缺失 usage 或模型价格时标记未计价，不猜 token 数或将其宣称为免费。
export function modelPrice(model: string, usage?: Data): Price {
  const normalized = model
    .replace(/^(openai|anthropic|deepseek)\//, "")
    .replace(/^claude-sonnet-4-6$/, "claude-sonnet-4.6");
  const rate = PRICES[normalized];
  const input = usage?.prompt_tokens,
    output = usage?.completion_tokens,
    cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const valid =
    [input, output, cached].every(
      (v) => typeof v === "number" && Number.isInteger(v) && v >= 0,
    ) && cached <= input;
  return {
    cost_micros:
      rate && valid
        ? (input - cached) * rate.input +
          cached * rate.cached +
          output * rate.output
        : null,
    pricing_source:
      normalized === "deepseek-v4.1-flash"
        ? "User supplied 2026-10-16; cached input at regular rate"
        : "OpenRouter snapshot 2026-10-16",
    rates: rate,
    ...(valid
      ? { input_tokens: input, output_tokens: output, cached_tokens: cached }
      : {}),
  };
}
// 既有模块合计继续复用同一计价函数，不向账本再次写入。
export function recordModelUsage(model: string, usage?: Data) {
  const current = scope.getStore();
  if (!current) return;
  const p = modelPrice(model, usage);
  if (p.cost_micros == null) current.unpriced_calls++;
  else current.cost_micros += p.cost_micros;
}
// 每次分析独立累计，兼容 MCP 并行请求；请求明细由 usage.ts 独立记录。
export async function withModelCosts(fn: () => Promise<Data>): Promise<Data> {
  const usage: Usage = { cost_micros: 0, unpriced_calls: 0 };
  return scope.run(usage, async () => {
    try {
      const result = await fn();
      return {
        ...result,
        cost_micros: (result.cost_micros ?? 0) + usage.cost_micros,
        model_cost_micros: usage.cost_micros,
        model_unpriced_calls: usage.unpriced_calls,
      };
    } catch (e) {
      // 已完成模型调用的估算在后续步骤失败时仍可随错误带回。
      if (e instanceof Error)
        Object.assign(e, {
          cost_micros:
            ((e as Error & { cost_micros?: number }).cost_micros ?? 0) +
            usage.cost_micros,
          model_unpriced_calls: usage.unpriced_calls,
        });
      throw e;
    }
  });
}
