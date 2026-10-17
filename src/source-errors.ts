// 上游数据契约错误允许局部失败；程序错误必须保留堆栈并向上传递。
export class SourceDataError extends Error {
  override name = "SourceDataError";
}
// 错误类别由接口边界确定，不通过错误文案猜测配置或传输故障。
export class SourceTransportError extends Error {
  override name = "SourceTransportError";
}
export class SourceConfigError extends Error {
  override name = "SourceConfigError";
}
export function expectedSourceError(error: unknown): boolean {
  return (
    error instanceof SourceDataError ||
    error instanceof SourceTransportError ||
    (error instanceof Error &&
      ["ZodError", "AbortError", "TimeoutError"].includes(error.name))
  );
}
// 日志走 stderr，避免污染 MCP stdout；不把预期降级记成 ERROR。
export function sourceFailure(
  stage: string,
  details: Record<string, unknown>,
  error: unknown,
) {
  const diagnostic = {
    stage,
    ...details,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    cause:
      error instanceof Error && error.cause instanceof Error
        ? error.cause.stack
        : undefined,
  };
  if (!expectedSourceError(error)) {
    console.error(JSON.stringify({ level: "error", ...diagnostic }));
    throw error;
  }
  console.warn(JSON.stringify({ level: "warn", ...diagnostic }));
  return diagnostic;
}
