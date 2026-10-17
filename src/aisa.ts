import { SourceDataError } from "./source-errors.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tracked } from "./usage.js";
import { recordModelUsage, modelPrice } from "./model-costs.js";
import { jsonFetch, type Data } from "./core.js";
// 密钥仅从环境或既有 AIsa 凭据读取，收费请求不重试。
export function key(): string {
  if (process.env.AISA_API_KEY?.trim()) return process.env.AISA_API_KEY.trim();
  const home = join(homedir(), ".aisa");
  try {
    if (existsSync(join(home, "key")))
      return readFileSync(join(home, "key"), "utf8").trim();
    const token = JSON.parse(
      readFileSync(join(home, "tokens.json"), "utf8"),
    ).accessToken;
    if (token) return token;
  } catch {}
  throw new Error(
    "no AIsa key: set AISA_API_KEY, or log in with the AIsa CLI (`aisa login`)",
  );
}
async function post(url: string, body: Data, timeout: number) {
  return jsonFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key()}`,
        "x-aisa-source": "new-term-radar",
      },
      body: JSON.stringify(body),
    },
    timeout,
  );
}
export async function call(
  calls: Data[],
): Promise<[Record<string, Data>, number]> {
  if (!calls.length) return [{}, 0];
  if (calls.length > 20) throw new Error("AIsa batch cap is 20");
  // 批量 HTTP 只计各工具执行；先建立所有 pending，再发出一次批量请求。
  let start!: () => void;
  const ready = new Promise<void>((resolve) => {
    start = resolve;
  });
  const response = ready.then(() =>
    post(
      (process.env.AISA_ROUTER_BASE_URL ?? "https://tools.aisa.one") +
        "/v1/tool-router/aisa-batch-use",
      { calls },
      240000,
    ),
  );
  const entries = calls.map((c) =>
    tracked(
      { provider: "aisa", endpoint: String(c.tool) },
      async () => {
        const body = await response;
        const r = body.results?.find((r: Data) => r.call_id === c.call_id);
        return r ?? { successful: false };
      },
      (r) => ({
        cost_micros:
          typeof r?.customer_cost_micros_usd === "number" &&
          r.customer_cost_micros_usd >= 0
            ? r.customer_cost_micros_usd
            : null,
        success: r?.successful,
        pricing_source: "AIsa response",
        request_id: r?.request_id,
      }),
    ),
  );
  start();
  const settled = await Promise.allSettled(entries);
  const body = await response;
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  if (body.error)
    throw new Error(
      String(body.error.message ?? "AIsa router error").slice(0, 200),
    );
  const out: Record<string, Data> = {};
  let cost = 0;
  for (const r of body.results ?? []) {
    cost += Number(r.customer_cost_micros_usd ?? 0);
    if (r.successful) out[r.call_id] = r.data ?? {};
  }
  return [out, cost];
}
export async function callAll(
  calls: Data[],
): Promise<[Record<string, Data>, number]> {
  const out: Record<string, Data> = {};
  let cost = 0;
  for (let i = 0; i < calls.length; i += 5) {
    const [data, c] = await call(calls.slice(i, i + 5));
    Object.assign(out, data);
    cost += c;
  }
  return [out, cost];
}
export async function chat(
  model: string,
  system: string,
  user: string,
  max_tokens = 1500,
): Promise<string> {
  const body = await tracked(
    { provider: "aisa", endpoint: "chat/completions", model },
    () =>
      post(
        (process.env.AISA_API_BASE_URL ?? "https://api.aisa.one") +
          "/v1/chat/completions",
        {
          model,
          temperature: 0,
          max_tokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        90000,
      ),
    (body) => ({
      ...modelPrice(model, body?.usage),
      request_id: body?.id,
      success: body
        ? typeof body.choices?.[0]?.message?.content === "string"
        : undefined,
    }),
  ).catch((e) => {
    // 请求失败且无 usage 时保留未计价提示，不假定本次模型免费。
    recordModelUsage(model);
    throw e;
  });
  recordModelUsage(model, body?.usage);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new SourceDataError("unexpected AIsa chat answer");
  return content;
}
