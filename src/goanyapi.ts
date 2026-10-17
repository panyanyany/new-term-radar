import { tracked } from "./usage.js";
import { jsonFetch, compact, type Data, type Point } from "./core.js";
export const key = () => process.env.GOANYAPI_API_KEY?.trim() ?? "";
// 可选增强接口，无密钥时调用方跳过；最多重试一次服务端错误。
export async function call(
  path: string,
  params: Record<string, string>,
): Promise<[Data, number]> {
  let error: unknown;
  for (let i = 0; i < 2; i++) {
    let b: Data;
    try {
      b = await tracked(
        { provider: "goanyapi", endpoint: path },
        async () => {
          const body = await jsonFetch(
            (process.env.GOANYAPI_BASE_URL ?? "https://api.goanyapi.com") +
              "/api/v1/" +
              path +
              "?" +
              new URLSearchParams(params),
            {
              headers: {
                authorization: `Bearer ${key()}`,
                accept: "application/json",
              },
            },
            90000,
          );
          return body;
        },
        (b) => ({
          success: b ? b.code === "ok" : undefined,
          cost_micros:
            typeof b?.data?.costCredits === "number" && b.data.costCredits >= 0
              ? b.data.costCredits * 1000
              : null,
          pricing_source: "GoAnyAPI response credits",
          rates: { credit_micros: 1000 },
        }),
      );
    } catch (e) {
      error = e;
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) break;
      continue;
    }
    if (b.code !== "ok")
      throw new Error(String(b.message ?? "GoAnyAPI error").slice(0, 160));
    const d = b.data ?? {};
    return [d, Number(d.costCredits ?? 0) * 1000];
  }
  throw error;
}
export async function relatedQueries(
  term: string,
  geo = "US",
): Promise<[Data, number]> {
  const [data, cost] = await call("google-trends", {
    q: term,
    date: "today 1-m",
    geo,
    data_type: "RELATED_QUERIES",
  });
  return [
    Object.fromEntries(
      ["rising", "top"].map((k) => [
        k,
        (data.relatedQueries?.[k] ?? []).map((x: Data) =>
          compact(x.query).toLowerCase(),
        ),
      ]),
    ),
    cost,
  ];
}
export async function dailySeries(
  term: string,
  geo = "US",
): Promise<[Point[], number]> {
  const [data, cost] = await call("google-trends", {
    q: term,
    date: "today 1-m",
    geo,
    data_type: "TIMESERIES",
  });
  const out: Point[] = [];
  for (const p of data.interestOverTime?.timeline_data ?? []) {
    const d = new Date(Number(p.timestamp) * 1000),
      v = Number(p.values?.[0]?.extracted_value);
    if (Number.isFinite(+d) && Number.isFinite(v))
      out.push([d.toISOString().slice(0, 10), v]);
  }
  return [out, cost];
}
