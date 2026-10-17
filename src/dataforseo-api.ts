import { jsonFetch, type Data } from "./core.js";
import { authorization } from "./dataforseo-auth.js";
import {
  SourceConfigError,
  SourceDataError,
  SourceTransportError,
} from "./source-errors.js";
import { tracked } from "./usage.js";
export interface RequestOptions {
  timeout_ms?: number;
  remaining_ms?: () => number;
  onSend?: () => void;
}
export const TRENDS_PATH = "/v3/keywords_data/google_trends/explore";
// 每个 HTTP 请求只记一次顶层实际费用；不能把 Task GET 内的原任务费用再算一遍。
export async function dataforseoRequest(
  path: string,
  body?: Data[],
  options: RequestOptions = {},
): Promise<Data> {
  const auth = await authorization();
  const timeout = Math.min(
    options.timeout_ms ?? 90000,
    options.remaining_ms?.() ?? 90000,
  );
  if (timeout <= 0)
    throw new SourceTransportError(
      "DataForSEO collection deadline reached before send",
    );
  // 鉴权成功后才标记发送，避免把未发送的任务误报为未知。
  options.onSend?.();
  const response = await tracked(
    {
      provider: "dataforseo",
      endpoint: path.replace(/\/task_get\/.+$/, "/task_get"),
    },
    () =>
      jsonFetch(
        `https://api.dataforseo.com${path}`,
        {
          method: body ? "POST" : "GET",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
        },
        timeout,
      ),
    (value) => ({
      cost_micros:
        typeof value?.cost === "number" &&
        Number.isFinite(value.cost) &&
        value.cost >= 0
          ? value.cost * 1e6
          : null,
      pricing_source: "DataForSEO response.cost",
      success: value
        ? value.status_code === 20000 &&
          Array.isArray(value.tasks) &&
          value.tasks.every((task: Data) =>
            [20000, 20100, 40601, 40602].includes(task.status_code),
          )
        : undefined,
      request_id: body ? body.map((item) => item.tag).join(",") : undefined,
    }),
  );
  if ([40100, 40200, 40201, 40202].includes(response.status_code))
    throw new SourceConfigError(
      `DataForSEO account error ${response.status_code}`,
    );
  if (response.status_code !== 20000 || !Array.isArray(response.tasks))
    throw new SourceDataError(
      `DataForSEO response status ${response.status_code}`,
    );
  return response;
}
