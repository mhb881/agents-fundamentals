import { tools } from ".";

export type ToolName = keyof typeof tools;

export async function executeTool(
  name: string, // 它来自模型输出，是不可信的外部输入
  args: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<string> {
  // TS 只是做静态类型检查，不会在运行时检查类型
  const tool = tools[name as ToolName];

  // 所以这里需要手动检查 tool 是否存在
  if (!tool) {
    return `Unknown tool: ${name}`;
  }

  // 检查工具是否有 execute 方法，即是否是可执行的本地工具
  const execute = tool.execute;
  if (!execute) {
    // Provider tools (like webSearch) are executed by OpenAI, not us
    return `Provider tool ${name} - executed by model provider`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await execute(args as any, {
    context, // 自定义运行时上下文
    toolCallId: "", // 本次工具调用的唯一追踪 ID
    messages: [], // 当前对话消息历史
  });

  return String(result);
}
