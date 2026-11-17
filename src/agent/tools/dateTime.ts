// src/agent/tools/dateTime.ts

import { tool } from "ai";
import { z } from "zod";

// 创建你的第一个工具：用于获取当前日期和时间
export const getDateTime = tool({
  description: "Get the current date and time",
  inputSchema: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});
