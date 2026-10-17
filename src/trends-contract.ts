import { z } from "zod";
import { DEFAULT_TRENDS_CATEGORY } from "./trends-config.js";
import { SourceDataError } from "./source-errors.js";
import { utcToday, shift, type Data } from "./core.js";
// 三天使用 UTC 日期区间，接口只支持日期精度，不宣称精确滚动 72 小时。
export function requestFor(
  root: string,
  window: number,
  day = utcToday(),
  category_code = DEFAULT_TRENDS_CATEGORY,
): Data {
  if (![1, 3, 7].includes(window)) throw new Error("unsupported Trends window");
  return {
    keywords: [root],
    category_code,
    item_types: ["google_trends_queries_list"],
    type: "web",
    language_code: "en",
    ...(window === 3
      ? { date_from: shift(day, -3), date_to: day }
      : { time_range: window === 1 ? "past_day" : "past_7_days" }),
  };
}
// 只接受显式 rising 列表，平铺或仅 top 的响应必须失败，不能冒充上涨词。
export function risingRows(data: Data): { rows: Data[]; check_url: string } {
  if (!data || data.status_code !== 20000 || data.tasks_error)
    throw new SourceDataError("Trends task failed");
  const task = data.tasks?.[0];
  if (task?.status_code !== 20000)
    throw new SourceDataError("Trends task failed");
  const parsed = z
    .array(
      z.object({
        check_url: z.string().optional(),
        items: z.array(z.object({ type: z.string(), data: z.unknown() })),
      }),
    )
    .nonempty()
    .safeParse(task.result);
  if (!parsed.success)
    throw new SourceDataError("Invalid Trends result structure", {
      cause: parsed.error,
    });
  const result = parsed.data[0];
  const item = result.items.find(
    (r) => r.type === "google_trends_queries_list",
  );
  const rising = z
    .object({
      rising: z.array(
        z
          .object({
            query: z.string().trim().min(1),
          })
          .passthrough(),
      ),
    })
    .safeParse(item?.data);
  // 错误示范：未经验证就读取 null 行的 query，会把上游错误变成程序异常。
  if (!rising.success)
    throw new SourceDataError(
      "Trends response missing or invalid explicit rising",
      { cause: rising.error },
    );
  return { rows: rising.data.rising, check_url: result.check_url! };
}

// 三天日期、分类和关键词均核对回显，避免上游忽略参数却被当成正常结果。
export function validateRange(checkUrl: string, request: Data) {
  let url: URL;
  try {
    url = new URL(checkUrl);
  } catch {
    throw new SourceDataError("Trends check_url invalid");
  }
  const expected = request.date_from
    ? `${request.date_from} ${request.date_to}`
    : request.time_range === "past_day"
      ? "now 1-d"
      : "now 7-d";
  if (
    url.searchParams.get("q") !== request.keywords[0] ||
    url.searchParams.get("date") !== expected ||
    Number(url.searchParams.get("cat") ?? 0) !== request.category_code
  )
    throw new SourceDataError("Trends echoed range mismatch");
}
