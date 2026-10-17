import { expect, it } from "vitest";
import { collectionStatus, collectionNotice } from "../src/trends-status.js";
import { briefReport } from "../src/brief-report.js";
import { risingRows } from "../src/trends-contract.js";
import { summary } from "../scripts/notify-report.js";
import { SourceDataError } from "../src/source-errors.js";
// 状态覆盖同步备选与异步任务，不用候选数量猜测采集成功。
it("窗口状态统一汇总且报告仍为三段", () => {
  const status = collectionStatus([
    { count: 0 },
    { status: "submitted", batch_id: "b" },
    { status: "unknown", batch_id: "b" },
    { status: "completed", error: "bad payload" },
  ]);
  expect(status).toEqual({
    complete: 1,
    pending: 1,
    unknown: 1,
    failed: 1,
    batch_ids: ["b"],
  });
  const report = briefReport([], new Date(), [{ collection_status: status }]);
  expect(report).toContain("上涨词采集未完整");
  expect(report.startsWith("## 1. 当天新词")).toBe(true);
  expect(summary(report, false)).toContain("上涨词采集未完整");
  expect(report.match(/^## /gm)).toHaveLength(3);
  expect(collectionNotice(collectionStatus([{ count: 0 }]))).toBe("");
});
it.each([
  null,
  {},
  [{ items: null }],
  [{ items: [null] }],
  [
    {
      items: [{ type: "google_trends_queries_list", data: { rising: [null] } }],
    },
  ],
])("异常上游结构作为数据错误隔离：%j", (result) => {
  expect(() =>
    risingRows({ status_code: 20000, tasks: [{ status_code: 20000, result }] }),
  ).toThrow(SourceDataError);
});
