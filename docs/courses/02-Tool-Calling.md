# 工具调用（Tool Calling）概述

本节课程将介绍工具调用（Tool Calling）——**一种让大语言模型（LLM）能够与外部世界交互的机制**。我们将创建第一个工具，并将其接入智能体。

## 什么是工具调用？

**工具调用（Tool Calling，也称为函数调用 / Function Calling）是一项允许 LLM 请求执行函数的能力**。模型不再局限于单纯生成文本，而是能够：

- 识别任务何时需要借助外部能力
- 选择合适的工具
- 为该工具生成正确的参数（arguments）
- 接收执行结果，并将其整合进最终回复中

**函数调用就是工具调用**——两者本质上是同一回事。“Function calling”是早期由 OpenAI 提出的概念，而如今“tool calling”更为通用，**因为它更准确地描述了实际发生的过程**：模型正在**借助工具来完成任务**。

## 工具调用的工作原理

1. **由你定义工具**：每个工具都包含名称、描述（description）以及参数结构定义（parameter schema）。
2. **随提示词（prompt）一并发送工具定义**：模型能够看到当前有哪些工具可用。
3. **由模型做出决策**：模型根据用户请求进行判断，选择直接回复，或者发起调用某个工具的请求。
4. **由你执行工具**：如果模型请求调用工具，就由你的代码来实际运行该函数，并**将结果返回给模型**。
5. **模型继续处理**：模型接收到执行结果后，可以选择直接生成回复，或者继续调用其他工具。

**模型本身永远不会直接执行工具**。它只会**生成一条结构化请求**，相当于声明：“**我想用参数 Y 调用工具 X。**”真正负责运行这段代码的，是你自己的程序。

## 为什么工具对智能体至关重要？

没有工具时，LLM 只能：

- 依赖训练数据中的既有知识作答
- 生成文本
- 基于提示词中已有的信息进行推理

有了工具后，LLM 就可以：

- 读写文件
- 搜索网页
- 执行代码
- 查询数据库
- 调用 API
- **与你开放给它的任何系统进行交互**

**正是工具，将 LLM 从一个聊天机器人（chatbot）蜕变为真正的智能体**。

## 工具的内部结构（Anatomy of a Tool）

每个工具都由三个部分组成：

```typescript
{
  description: "What this tool does - helps the model decide when to use it",
  inputSchema: z.object({ /* parameters the tool accepts */ }),
  execute: async (args) => { /* the actual implementation */ }
}
```

- `description`：用于帮助模型理解何时该使用此工具，**这一点至关重要，描述务必具体清晰**。
- `inputSchema`：用于定义输入参数的 Zod schema。**模型会依据它来生成合法的参数**。
- `execute`：工具被调用时实际执行的函数，它会返回供模型后续使用的结果。

## 代码

### `src/agent/tools/dateTime.ts`

创建你的第一个工具——获取当前日期和时间：

```typescript
import { tool } from "ai";
import { z } from "zod";

export const getDateTime = tool({
  description: "Get the current date and time",
  inputSchema: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});
```

### `src/agent/tools/index.ts`

从统一的入口文件中导出所有工具：

```typescript
import { getDateTime } from "./dateTime.ts";

// All tools combined for the agent
export const tools = {
  getDateTime,
};
```

### `src/agent/executeTool.ts`

创建一个按名称执行工具的辅助函数（helper）：

```typescript
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
```

`executeTool` 是手动控制 **Agent 循环（Agent Loop）** 时的**工具调度器（Tool Dispatcher）**。

在上一节的 `run.ts` 中，如果只传 `tools` 给 `generateText` 而不配置自动多步执行，模型在决定调用工具后只会停下来，并吐出一条类似“请帮我用参数 `{}` 调用 `getDateTime`”的结构化请求。

`executeTool` 的职责就是接住这条请求：**根据字符串名称找到对应的本地工具函数、做安全校验、传入参数与运行期上下文执行它，最后把结果统一转成字符串喂回给模型**。

这个函数的返回类型是 `Promise<string>` 而不是抛异常，说明它是**面向模型/上层循环**设计的：工具不存在、不可执行都以"文本结果"的形式返回，让调用方继续跑，而不是中断整个流程。

#### 1. ai-sdk-v7新增的 `context` 参数是什么？有什么用？

> 早期版本叫 `experimental_context`，新版本已转正为标准的 `context`

在 Vercel AI SDK 的演进中，`tool.execute(args, options)` 的第二个参数 `options`（`ToolExecutionOptions`）引入了 `context` 字段。

**（1）它解决的核心架构问题：隔离“模型参数”与“应用依赖”**

工具通常在独立文件（如 `src/agent/tools/dateTime.ts`）中静态定义，但真实业务中的工具往往需要访问**请求级别的运行时状态**——比如当前登录的 `userId`、数据库连接实例、鉴权 Token 或当前工作目录。

**如果不使用 `context`**：你只能把 `userId` 写进 `inputSchema` 里让模型传，或者依赖全局变量。前者会污染工具的 Schema（模型不该也不可能凭空猜出用户的内部 ID），后者在并发请求下极不安全。

**有了 `context` 之后**：你可以在调用 `generateText({ model, tools, context: { userId: "u_123", db } })` 时把运行时依赖注入进去，SDK 会自动把它透传给工具的 `execute` 函数：

```ts
export const getUserProfile = tool({
  description: "获取当前用户资料",
  inputSchema: z.object({}), // 对模型完全隐藏内部依赖
  execute: async (_args, { context }) => {
    // 直接从执行选项中拿到运行时注入的依赖
    return await context.db.users.find(context.userId);
  },
});
```

**（2）为什么你的代码里必须写 `context: {}`？**

因为你现在是**绕过 `generateText` 的内置调度，直接手动调用 `tool.execute(...)`**。

在 v7 的类型定义中，`options` 对象把 `context` 设为了必填字段，TypeScript 编译器会强制要求你提供它。

目前你的 `getDateTime` 工具用不到外部依赖，所以传入一个空对象 `context: {}` 作为占位符来满足类型检查即可。

---

### `src/agent/run.ts`

将工具添加到 `generateText` 调用中：

```typescript
import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { tools } from "./tools/index.ts";
import { SYSTEM_PROMPT } from "./system/prompt.ts";
import type { AgentCallbacks } from "../types.ts";

const MODEL_NAME = "gpt-5-mini";

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<any> {
  // Filter and check if we need to compact the conversation history before starting
  const { text } = await generateText({
    model: openai(MODEL_NAME),
    prompt: userMessage,
    system: SYSTEM_PROMPT,
    tools,
  });

  console.log(text);
}
```

---

## 核心要点

- **工具是声明式的（declarative）**：你只需描述工具的功能，由模型自主决定何时调用它们。
- **优质的描述至关重要**：模型依赖你编写的描述来准确选择对应的工具。
- **Schema 校验**：通过 Zod schema 确保模型生成的调用参数合法有效。
- **执行权掌握在你手中**：模型负责发起请求，你负责实际执行——这构成了一道重要的安全边界（security boundary）。

---

## 如何测试程序

要测试你刚写好的 `getDateTime` 工具，需要注意两个关键细节，然后运行测试。

首先，提问内容必须有“时间/日期”诉求。当前 [src/agent/run.ts](file:///d:/WorkSpace/大师课/ai-courses/作者-Scott-Moss/agents-v2/src/agent/run.ts#L32) 底部写的是：

```typescript
runAgent("你好，你在吗？");
```
因为这句打招呼不需要时间信息，模型会直接用纯文本回复，**不会触发工具调用**。要测试工具，提问需要改成比如：`"请问今天几号？现在几点？"`。

然后，在当前的单步调用中，需打印 `toolCalls` 和 `toolResults`。

在当前阶段，`run.ts` 只是一次单步的 `generateText`：
- 当模型决定调用工具时，它的首要动作是生成 **`toolCalls`（工具调用请求）**。
- AI SDK 检测到工具中配置了 `execute`，会自动执行它并将结果存入 **`toolResults`**。
- **但此时模型的 `text` 字段会是空的**（因为尚未进入后续课程的“多步 Agent 循环”，模型还没有拿到结果来组织最终语言）。
- 如果只打印 `console.log(text)`，终端会显示为空白。因此我们需要把 `toolCalls` 和 `toolResults` 打印出来观察。

将 [src/agent/run.ts](file:///d:/WorkSpace/大师课/ai-courses/作者-Scott-Moss/agents-v2/src/agent/run.ts) 修改为如下内容：

```typescript
export const runAgent = async (
  userMessage: string,
  conversationHistory?: ModelMessage[],
  callbacks?: AgentCallbacks,
): Promise<any> => {
  const result = await generateText({
    model: deepSeek(DEEPSEEK_MODEL_NAME),
    prompt: userMessage,
    instructions: SYSTEM_PROMPT,
    tools,
  });

  console.log("📝 文本回复:", result.text || "(无文本输出，发起了工具调用)");
  console.log("🛠️ 工具调用 (toolCalls):", result.toolCalls);
  console.log("📊 执行结果 (toolResults):", result.toolResults);
};

// 换成需要查询时间的提示词
runAgent("请问今天几号？现在几点了？");
```

在项目根目录下执行：

```bash
pnpm exec tsx src/agent/run.ts
```

如果工具配置成功，控制台会输出类似下面的内容：

```text
📝 文本回复: (无文本输出，发起了工具调用)
🛠️ 工具调用 (toolCalls): [
  {
    type: 'tool-call',
    toolCallId: 'call_xxxx',
    toolName: 'getDateTime',
    input: {}
  }
]
📊 执行结果 (toolResults): [
  {
    type: 'tool-result',
    toolCallId: 'call_xxxx',
    toolName: 'getDateTime',
    output: '2026-11-17T16:27:29.397Z'
  }
]
```

这说明：
1. **模型识别到了工具**：根据 `getDateTime` 的 `description`，准确判断出用户需要时间，并发起了调用请求。
2. **工具成功执行**：你写的 `execute` 函数被执行，成功返回了 ISO 格式的系统时间。

**想要模型直接用自然语言回答出当前时间？**

从 `'ai'` 包中直接导入内置的 **`isStepCount`** 辅助函数，传入 `generateText` 中的 `stopWhen`：

```typescript
import { generateText, isStepCount, type ModelMessage } from "ai";

const result = await generateText({
model: deepSeek(DEEPSEEK_MODEL_NAME),
prompt: userMessage,
instructions: SYSTEM_PROMPT,
tools,
stopWhen: isStepCount(5),, // 允许模型在拿到工具结果后，继续生成最终文本回复
});
console.log(result.text); // 这时就会输出：今天的日期是 2026年11月18日...
```

这也是后续第 4 讲 **The Agent Loop** 的核心原理！

除了使用 `isStepCount(n)`，`stopWhen` 还允许直接传入一个判断函数，通过入参中的 `steps` 数组决定何时停止（进阶用法）：

```ts
stopWhen: ({ steps }) => steps.length >= 2,
```

---

## 总结

学完本节之后，你应该学会：

1. 什么是工具调用？
2. 工具调用的本质是什么？
3. 为什么智能体需要工具调用？以及工具对智能体的重要程度。
4. 工具的内部结构是什么？
5. 如何声明一个本地的工具，然后导出工具
6. 如何编写一个工具调度器（Tool Dispatcher）
7. 如何将工具集成到 agent loop中