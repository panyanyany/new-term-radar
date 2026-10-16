import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  const body = await post(
    (process.env.AISA_ROUTER_BASE_URL ?? "https://tools.aisa.one") +
      "/v1/tool-router/aisa-batch-use",
    { calls },
    240000,
  );
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
  const body = await post(
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
  );
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new Error("unexpected AIsa chat answer");
  return content;
}
