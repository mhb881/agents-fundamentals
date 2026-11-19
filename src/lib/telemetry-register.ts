import "dotenv/config";
export async function registerLaminarTelemetry() {
  // 判断是否是标准 Node 环境（有 process + process.version）
  const isNodeRuntime =
    typeof process !== "undefined" && process.versions?.node;
  if (!isNodeRuntime) {
    console.warn("[Laminar] Not running in Node.js, skip register");
    return;
  }

  const enableTelemetry = process.env.ENABLE_LMNR_TELEMETRY === "true";
  if (!enableTelemetry) {
    console.log("[Laminar] Telemetry disabled by env");
    return;
  }

  const apiKey = process.env.LMNR_PROJECT_API_KEY;
  if (!apiKey) {
    console.warn("[Laminar] LMNR_PROJECT_API_KEY missing, skip register");
    return;
  }

  const { registerTelemetry } = await import("ai");
  const { LaminarAiSdkTelemetry } = await import("@lmnr-ai/lmnr");

  // 注册全局采集器，并配置：强制 HTTP + 禁用批处理等待（即时发送）
  registerTelemetry(
    new LaminarAiSdkTelemetry({
      laminarOptions: {
        projectApiKey: apiKey,
        forceHttp: true, // 强制走 HTTP 443，避免 gRPC 8443 端口被墙或无法代理
        disableBatch: true, // 禁用 5 秒批处理缓冲，产生 Span 后立即上报，防止脚本提前退出丢数据
      },
    }),
  );
  console.log("[Laminar] Telemetry registered successfully");
}
