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
    term: "browser game",
    decision: "confirmed",
    is_online_game: true,
    is_online_tool: false,
    is_offline_sports_event: false,
    reason: "可在线游玩",
    evidence_indices: [0],
  },
  {
    term: "image tool",
    decision: "confirmed",
    is_online_game: false,
    is_online_tool: true,
    is_offline_sports_event: false,
    reason: "在线编辑器",
    evidence_indices: [0],
  },
  {
    term: "sports match",
    decision: "rejected",
    is_online_game: false,
    is_online_tool: false,
    is_offline_sports_event: true,
    reason: "体育比赛",
    evidence_indices: [0],
  },
];
it("仅明确线下体育赛事被拦截，保留原词与依据", async () => {
  vi.mocked(chat).mockResolvedValue(JSON.stringify(answer));
  const result = await classifyCandidates(rows, "model");
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "browser game",
    "image tool",
  ]);
  expect(result.filtered[0].classification).toMatchObject({
    is_online_game: false,
    is_online_tool: false,
    is_offline_sports_event: true,
    status: "classified",
  });
  expect(result.candidates[0].classification.evidence_indices).toEqual([0]);
});
it("证据为空不调用AI，分类失败也保留候选", async () => {
  expect(
    (await classifyCandidates([{ term: "unknown", evidence: [] }], "model"))
      .candidates[0].classification.status,
  ).toBe("pending");
  expect(chat).not.toHaveBeenCalled();
  vi.mocked(chat).mockRejectedValue(new SourceTransportError("HTTP 504"));
  expect((await classifyCandidates(rows, "model")).candidates).toHaveLength(3);
  expect(chat).toHaveBeenCalledTimes(1);
});
it("严格解析拒绝遗漏、重复原词、字符串布尔值、越界证据和无依据肯定", () => {
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
it("资料含糊标记待确认，仍进入下一步", async () => {
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
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].classification.status).toBe("pending");
});

it("其他类型与未知赛事标记保留，明确赛事必须有证据且不能与线上游戏混淆", async () => {
  vi.mocked(chat).mockResolvedValue(
    JSON.stringify([{ ...answer[2], is_offline_sports_event: false }]),
  );
  expect(
    (await classifyCandidates(rows.slice(2), "model")).candidates,
  ).toHaveLength(1);
  for (const item of [
    { ...answer[2], evidence_indices: [] },
    { ...answer[0], is_offline_sports_event: true },
    { ...answer[2], is_offline_sports_event: "true" },
  ])
    expect(() =>
      parseKinds(JSON.stringify([item]), rows.slice(0, 1)),
    ).toThrow();
  const result = await classifyCandidates(
    [{ term: "unknown", evidence: [] }],
    "model",
  );
  expect(
    result.candidates[0].classification.is_offline_sports_event,
  ).toBeNull();
  expect(result.filtered).toEqual([]);
});

it.each(["shape", "evidence"])(
  "单条%s无效只降级该词，保留同批有效赛事拦截",
  async (failure) => {
    const invalid =
      failure === "shape"
        ? { ...answer[0], is_online_game: "true" }
        : { ...answer[0], evidence_indices: [99] };
    vi.mocked(chat).mockResolvedValue(
      JSON.stringify([answer[2], invalid, answer[1]]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await classifyCandidates(rows, "model");
      expect(result.filtered.map((r: { term: string }) => r.term)).toEqual([
        "sports match",
      ]);
      expect(result.candidates[0].classification).toMatchObject({
        status: "pending",
        is_offline_sports_event: null,
      });
      expect(result.candidates[1].classification.status).toBe("classified");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("stack");
    } finally {
      warn.mockRestore();
    }
  },
);
it("整个JSON损坏时整批待确认，不误关联赛事结果", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const invalid of ["not JSON"]) {
      vi.mocked(chat).mockResolvedValue(invalid);
      const result = await classifyCandidates(rows, "model");
      expect(result.filtered).toEqual([]);
      expect(
        result.candidates.every(
          (r: { classification: { status: string } }) =>
            r.classification.status === "pending",
        ),
      ).toBe(true);
    }
  } finally {
    warn.mockRestore();
  }
});

it("八词只返回七条时仅遗漏词待确认，乱序不影响其余分类和赛事拦截", async () => {
  const batch = Array.from({ length: 8 }, (_, i) => ({
    ...rows[0],
    term: `candidate ${i}`,
  }));
  vi.mocked(chat).mockResolvedValue(
    JSON.stringify(
      batch
        .slice(1)
        .reverse()
        .map((r) => ({
          ...(r.term === "candidate 7" ? answer[2] : answer[0]),
          term: r.term,
        })),
    ),
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await classifyCandidates(batch, "model");
    expect(result.filtered.map((r: { term: string }) => r.term)).toEqual([
      "candidate 7",
    ]);
    expect(result.candidates.map((r: { term: string }) => r.term)).toEqual(
      batch.slice(0, 7).map((r) => r.term),
    );
    expect(result.candidates[0].classification.status).toBe("pending");
    expect(
      result.candidates
        .slice(1)
        .every(
          (r: { classification: { status: string } }) =>
            r.classification.status === "classified",
        ),
    ).toBe(true);
    expect(warn.mock.calls[0][0]).toContain(
      "missing classification for term: candidate 0",
    );
    const input = JSON.parse(vi.mocked(chat).mock.calls[0][2]);
    expect(input.map((r: { term: string }) => r.term)).toEqual(
      batch.map((r) => r.term),
    );
    expect(vi.mocked(chat).mock.calls[0][1]).toContain("本批共 8 个候选词");
  } finally {
    warn.mockRestore();
  }
});

it.each(["duplicate", "unknown", "missing-term", "rewritten-term"])(
  "%s只影响对应词，不能污染同批有效分类或增加新候选",
  async (failure) => {
    const first =
      failure === "unknown"
        ? { ...answer[0], term: "unrequested term" }
        : failure === "missing-term"
          ? { ...answer[0], term: undefined }
          : failure === "rewritten-term"
            ? { ...answer[0], term: "Browser Game" }
            : answer[0];
    vi.mocked(chat).mockResolvedValue(
      JSON.stringify([
        answer[2],
        first,
        answer[1],
        ...(failure === "duplicate" ? [answer[0]] : []),
      ]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await classifyCandidates(rows, "model");
      expect(result.filtered.map((r: { term: string }) => r.term)).toEqual([
        "sports match",
      ]);
      expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
        "browser game",
        "image tool",
      ]);
      expect(result.candidates[0].classification).toMatchObject({
        term: "browser game",
        status: "pending",
      });
      expect(result.candidates[1].classification).toMatchObject({
        term: "image tool",
        status: "classified",
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  },
);
