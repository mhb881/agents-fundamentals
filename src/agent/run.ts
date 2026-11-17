import "dotenv/config"; // 加载环境变量
import { generateText, isStepCount, type ModelMessage } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";

import { tools } from "./tools";
import { SYSTEM_PROMPT } from "./system/prompt";
import { runProxy } from "../lib/runProxy";

import type { AgentCallbacks } from "../types";

const GOOGLE_MODEL_NAME = "gemini-3.5-flash-lite";
const DEEPSEEK_MODEL_NAME = "deepseek-v4-flash";

export const runAgent = async (
  userMessage: string,
  conversationHistory?: ModelMessage[],
  callbacks?: AgentCallbacks,
): Promise<any> => {
  // 提供prompt，选择模型，然后调用模型，返回文本
  // Filter and check if we need to compact the conversation history before starting
  const result = await generateText({
    model: deepSeek(DEEPSEEK_MODEL_NAME),
    prompt: userMessage,
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: isStepCount(5),
  });

  console.log("📝 文本回复:", result.text || "(无文本输出，发起了工具调用)");
  console.log("🛠️ 工具调用 (toolCalls):", result.toolCalls);
  console.log("📊 执行结果 (toolResults):", result.toolResults);
};

// 换成需要查询时间的提示词
runAgent("请问今天几号？现在几点了？");
