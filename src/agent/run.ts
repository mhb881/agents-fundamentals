import "dotenv/config"; // 加载环境变量
import { generateText, isStepCount, streamText, type ModelMessage } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";

import { tools } from "./tools";
import { executeTool } from "./tools/executeTools";
import { SYSTEM_PROMPT } from "./system/prompt";
import { runProxy } from "../lib/runProxy";
import type { AgentCallbacks, ToolCallInfo } from "../types";
import { filterCompatibleMessages } from "./system/filterMessages";
import { registerLaminarTelemetry } from "../lib/telemetry-register";
import { Laminar } from "@lmnr-ai/lmnr";

runProxy();
await registerLaminarTelemetry();

const GOOGLE_MODEL_NAME = "gemini-3.5-flash-lite";
const DEEPSEEK_MODEL_NAME = "deepseek-v4-flash";

export const runAgent = async (
  userMessage: string,
  conversationHistory?: ModelMessage[],
  callbacks?: AgentCallbacks,
): Promise<ModelMessage[]> => {
  // Filter and check if we need to compact the conversation history before starting
  const workingHistory = filterCompatibleMessages(conversationHistory || []);

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: "user", content: userMessage },
  ];

  let fullResponse = "";

  // 提取工具的声明
  // 不传 execute 给 streamText，将执行控制权保留在下方的 executeTool 中（便于触发审批与回调）
  const modelTools = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const { execute: _execute, ...definition } = t;
      return [name, definition];
    }),
  );

  while (true) {
    const result = streamText({
      model: google(GOOGLE_MODEL_NAME),
      allowSystemInMessages: true,
      messages,
      tools: modelTools,
      telemetry: {
        isEnabled: true, // 全局注册后默认就是 true，此处可省略
        functionId: "agent-run", // 可选：自定义追踪链路中的节点名称，便于在 Laminar 中检索
      },
    });

    const toolCalls: ToolCallInfo[] = []; // 记录工具调用信息
    let currentText = ""; // 累计当前模型输出的文本
    let streamError: Error | null = null; // 记录流式输出时的错误

    // 处理流式输出
    // 记录每个 token 并触发回调
    try {
      for await (const chunk of result.stream) {
        if (chunk.type === "text-delta") {
          currentText += chunk.text;
          if (callbacks?.onToken) {
            callbacks.onToken(chunk.text);
          } else {
            process.stdout.write(chunk.text); // 无 UI 独立测试时直接在终端流式打字
          }
        }

        if (chunk.type === "tool-call") {
          const input = "input" in chunk ? chunk.input : {};

          toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: input as Record<string, unknown>,
          });
          callbacks?.onToolCallStart(chunk.toolName, input);
        }
      }
    } catch (error) {
      streamError = error as Error;
      // If we have some text, continue processing
      // Otherwise, rethrow if it's not a "no output" error
      if (
        !currentText &&
        !streamError.message.includes("No output generated")
      ) {
        throw streamError;
      }
    }

    fullResponse += currentText;

    // If stream errored with "no output" and we have no text, try to recover
    if (streamError && !currentText) {
      // Add a fallback response
      fullResponse =
        "I apologize, but I wasn't able to generate a response. Could you please try rephrasing your message?";
      if (callbacks?.onToken) {
        callbacks.onToken(fullResponse);
      } else {
        process.stdout.write(fullResponse);
      }
      break;
    }

    const finishReason = await result.finishReason;
    const responseMessages = await result.responseMessages;
    messages.push(...responseMessages);

    // 如果模型没有调用工具（或完成回答），退出循环
    if (finishReason !== "tool-calls" || toolCalls.length === 0) {
      break;
    }

    for (const tc of toolCalls) {
      const result = await executeTool(tc.toolName, tc.args, {});
      callbacks?.onToolCallEnd(tc.toolName, result);

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: "text", value: result },
          },
        ],
      });
    }
  }

  callbacks?.onComplete(fullResponse);
  console.log(messages);
  return messages;
};

// 换成需要查询时间的提示词
runAgent("写一个c++程序，实现一个简单的计算器，支持加减乘除");
// await runAgent("你好");
await Laminar.flush(); // 确保所有数据成功推送到 Laminar 云端后再退出进程
