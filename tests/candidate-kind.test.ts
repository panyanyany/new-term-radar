import { SourceTransportError } from "../src/source-errors.js";
import { beforeEach, expect, it, vi } from "vitest";
import { classifyCandidates, parseKinds } from "../src/candidate-kind.js";
import { chat } from "../src/aisa.js";
vi.mock("../src/aisa.js", () => ({ chat: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const rows = [
  {
    term: "browser game",
    evidence: [
      {
        title: "Play online",
        text: "A browser puzzle",
        url: "https://game.test",
      },
    ],
  },
  {
    term: "image tool",
    evidence: [
      { title: "Edit online", text: "Online editor", url: "https://tool.test" },
    ],
  },
  {
    term: "sports match",
    evidence: [
      { title: "Baseball", text: "Sports news", url: "https://news.test" },
    ],
  },
];
const answer = [
  {
    i: 0,
    decision: "confirmed",
    is_online_game: true,
    is_online_tool: false,
    reason: "可在线游玩",
    evidence_indices: [0],
  },
  {
    i: 1,
    decision: "confirmed",
    is_online_game: false,
    is_online_tool: true,
    reason: "在线编辑器",
    evidence_indices: [0],
  },
  {
    i: 2,
    decision: "rejected",
    is_online_game: false,
    is_online_tool: false,
    reason: "体育比赛",
    evidence_indices: [0],
  },
];
it("至少一类符合才放行，保留原词与判断依据", async () => {
  vi.mocked(chat).mockResolvedValue(JSON.stringify(answer));
  const result = await classifyCandidates(rows, "model");
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "browser game",
    "image tool",
  ]);
  expect(result.filtered[0].classification).toMatchObject({
    is_online_game: false,
    is_online_tool: false,
    status: "excluded",
  });
  expect(result.candidates[0].classification.evidence_indices).toEqual([0]);
});
it("证据为空不调用AI，失败不放行", async () => {
  expect(
    (await classifyCandidates([{ term: "unknown", evidence: [] }], "model"))
      .filtered[0].classification.status,
  ).toBe("pending");
  expect(chat).not.toHaveBeenCalled();
  vi.mocked(chat).mockRejectedValue(new SourceTransportError("HTTP 504"));
  expect((await classifyCandidates(rows, "model")).candidates).toEqual([]);
  expect(chat).toHaveBeenCalledTimes(1);
});
it("拒绝遗漏、重复索引、字符串布尔值、越界证据和无依据肯定", () => {
  for (const data of [
    answer.slice(1),
    [answer[0], answer[0], answer[2]],
    answer.map((r, i) => (i ? r : { ...r, is_online_game: "true" })),
    answer.map((r, i) => (i ? r : { ...r, evidence_indices: [2] })),
    answer.map((r, i) => (i ? r : { ...r, evidence_indices: [] })),
    answer.map((r, i) => (i ? r : { ...r, decision: "uncertain" })),
  ])
    expect(() => parseKinds(JSON.stringify(data), rows)).toThrow();
});
it("资料含糊必须待确认，不进入下一步", async () => {
  vi.mocked(chat).mockResolvedValue(
    JSON.stringify([
      {
        ...answer[0],
        decision: "uncertain",
        is_online_game: false,
        evidence_indices: [],
        reason: "只找到相近拼写，无法确认",
      },
    ]),
  );
  const result = await classifyCandidates(rows.slice(0, 1), "model");
  expect(result.candidates).toEqual([]);
  expect(result.filtered[0].classification.status).toBe("pending");
});
