import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorization } from "../src/dataforseo-auth.js";
import { dataforseoRequest, TRENDS_PATH } from "../src/dataforseo-api.js";
import { withUsageRun, usageSummary } from "../src/usage.js";
const paths = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => paths.home,
}));
let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "dfs-api-"));
  paths.home = state;
  vi.stubEnv("DATAFORSEO_LOGIN", "");
  vi.stubEnv("DATAFORSEO_PASSWORD", "");
  vi.stubEnv("CODEX_HOME", join(state, "codex"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(state, { recursive: true, force: true });
});
// 使用虚构凭据验证私密文件边界，测试不读取或刷新生产授权。
function credentials(expiry: number) {
  mkdirSync(join(state, "codex"));
  const path = join(state, "codex/.credentials.json");
  writeFileSync(
    path,
    JSON.stringify({
      dfs: {
        server_name: "dataforseo",
        server_url: "https://mcp.dataforseo.com/mcp",
        access_token: "old-token",
        refresh_token: "refresh-token",
        client_id: "client",
        expires_at: expiry,
      },
      other: { access_token: "other-secret" },
    }),
  );
  return path;
}
it("环境凭据优先且必须完整，错误配置不会偷偷拼接其他来源", async () => {
  credentials(Date.now() + 3600000);
  vi.stubEnv("DATAFORSEO_LOGIN", "login");
  await expect(authorization()).rejects.toThrow(/both/);
  vi.stubEnv("DATAFORSEO_PASSWORD", "password");
  expect(await authorization()).toBe(
    `Basic ${Buffer.from("login:password").toString("base64")}`,
  );
});
it("OAuth 未过期直接复用；仅过期时刷新，并保留其他 MCP 新增的凭据", async () => {
  const path = credentials(Date.now() + 3600000);
  const fetcher = vi.fn(async (_url, init: RequestInit) => {
    const current = JSON.parse(readFileSync(path, "utf8"));
    current.another = { access_token: "new-other" };
    writeFileSync(path, JSON.stringify(current));
    expect(String(init.body)).toContain("grant_type=refresh_token");
    return new Response(
      JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await authorization()).toBe("Bearer old-token");
  expect(fetcher).not.toHaveBeenCalled();
  const current = JSON.parse(readFileSync(path, "utf8"));
  current.dfs.expires_at = 0;
  writeFileSync(path, JSON.stringify(current));
  expect(await Promise.all([authorization(), authorization()])).toEqual([
    "Bearer new-token",
    "Bearer new-token",
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
    other: { access_token: "other-secret" },
    another: { access_token: "new-other" },
    dfs: { refresh_token: "new-refresh" },
  });
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
it("刷新失败明确报错且不覆盖原凭据，不向 API 自动降级", async () => {
  const path = credentials(0);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  await expect(authorization()).rejects.toThrow(/log in again/);
  expect(JSON.parse(readFileSync(path, "utf8")).dfs.access_token).toBe(
    "old-token",
  );
});
it("按顶层实际费用入账；排队状态不计为请求失败，GET 原任务费用不重复累计", async () => {
  vi.stubEnv("DATAFORSEO_LOGIN", "test");
  vi.stubEnv("DATAFORSEO_PASSWORD", "test");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status_code: 20000,
          cost: 0.0054,
          tasks: [
            { status_code: 20100, cost: 0.0027 },
            { status_code: 20100, cost: 0.0027 },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks_error: 1,
          cost: 0,
          tasks: [{ status_code: 40602, cost: 0.0027 }],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status_code: 20000,
          cost: 0,
          tasks: [{ status_code: 20000, cost: 0.0027 }],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  await withUsageRun(state, "test", async () => {
    await dataforseoRequest(`${TRENDS_PATH}/task_post`, [{ tag: "local-id" }]);
    await dataforseoRequest(`${TRENDS_PATH}/task_get/task-id`);
    await dataforseoRequest(`${TRENDS_PATH}/task_get/task-id`);
  });
  const summary = usageSummary(state);
  expect(summary.cost_micros).toBe(5400);
  expect(summary.requests).toBe(3);
  expect(summary.rows[0].failed).toBe(0);
  expect(JSON.stringify(summary)).not.toContain("Basic");
});

it("刷新网络异常保留原始 cause，且发送回调不触发", async () => {
  credentials(0);
  const cause = new Error("network unavailable");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
  const onSend = vi.fn();
  await expect(
    dataforseoRequest(TRENDS_PATH + "/task_post", [], { onSend }),
  ).rejects.toMatchObject({ cause });
  expect(onSend).not.toHaveBeenCalled();
});

it("鉴权后重查预算，过期不发送 HTTP", async () => {
  credentials(Date.now() + 3600000);
  const fetcher = vi.fn();
  const onSend = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    dataforseoRequest(TRENDS_PATH + "/tasks_ready", undefined, {
      remaining_ms: () => 0,
      onSend,
    }),
  ).rejects.toThrow("deadline reached before send");
  expect(fetcher).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
});
