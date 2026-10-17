import { AsyncLocalStorage } from "node:async_hooks";
import { type Data } from "./core.js";

const context = new AsyncLocalStorage<{
  curves: Map<string, Data>;
  searches: Map<string, Promise<unknown>>;
}>();
// 每个 CLI/MCP 运行独立缓存；不跨轮复用，避免趋势过期和并行任务串数据。
export function withResearchCache<T>(fn: () => T): T {
  return context.getStore()
    ? fn()
    : context.run({ curves: new Map(), searches: new Map() }, fn);
}
// 曲线包含原比较批次与参考词，共同尺度保留在结果内；复用不重新计费。
export function cachedCurve(key: string): Data | undefined {
  const curve = context.getStore()?.curves.get(key);
  return curve ? structuredClone(curve) : undefined;
}
// 暂时失败和比较批次压制不复用，保留显式补查机会。
export function rememberCurve(key: string, curve: Data): void {
  if (curve.status !== "pending" && curve.reason !== "dominates_comparison")
    context.getStore()?.curves.set(key, structuredClone(curve));
}
// 同时发起的相同搜索共享 Promise；失败移除，显式再次调用仍可补查。
export async function cachedSearch<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<{ value: T; reused: boolean }> {
  const cache = context.getStore()?.searches;
  if (!cache) return { value: await fn(), reused: false };
  const previous = cache.get(key);
  if (previous)
    return { value: structuredClone(await previous) as T, reused: true };
  const pending = fn();
  cache.set(key, pending);
  try {
    return { value: structuredClone(await pending), reused: false };
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
