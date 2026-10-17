import { z } from "zod";
export const DEFAULT_TRENDS_CATEGORY = 8;
export const SECOND_LEVEL_LIMIT = 10;
export const SECOND_LEVEL_SORT = "rising-v1";
const schema = z
  .object({
    provider: z.enum(["dataforseo", "aisa"]).default("dataforseo"),
    standard_wait_minutes: z.number().int().min(0).max(45).default(45),
    roots: z.array(z.string().trim().min(1).max(100)).default([]),
    windows: z
      .array(z.union([z.literal(1), z.literal(3), z.literal(7)]))
      .min(1)
      .default([1, 3, 7]),
    category_code: z
      .number()
      .int()
      .nonnegative()
      .default(DEFAULT_TRENDS_CATEGORY),
    benchmark: z
      .string()
      .trim()
      .min(1)
      .refine((v) => !v.includes(","), "benchmark cannot contain comma")
      .default("hex picker"),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.roots.map((r) => r.toLowerCase())).size !== v.roots.length)
      ctx.addIssue({
        code: "custom",
        path: ["roots"],
        message: "duplicate roots",
      });
    if (new Set(v.windows).size !== v.windows.length)
      ctx.addIssue({
        code: "custom",
        path: ["windows"],
        message: "duplicate windows",
      });
  });
export type TrendsConfig = z.infer<typeof schema>;
// 配置加载时解析一次，参考词兼容既有 usecases 配置，不在业务函数重复取默认值。
export function resolveTrendsConfig(
  value: unknown,
  legacyBenchmark?: string,
): TrendsConfig {
  const input = typeof value === "object" && value !== null ? value : {};
  return schema.parse({ benchmark: legacyBenchmark, ...input });
}
