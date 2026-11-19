import type { ModelMessage } from "ai";
/**
 * Filter conversation history to only include compatible message formats.
 * Provider tools (like webSearch) may return messages with formats that
 * cause issues when passed back to subsequent API calls.
 */
export const filterCompatibleMessages = (
  messages: ModelMessage[],
): ModelMessage[] => {
  return messages.filter((msg) => {
    // Keep user and system messages
    // user and system messages are safe to keep
    if (msg.role === "user" || msg.role === "system") {
      return true;
    }

    // Keep assistant messages that have text content
    if (msg.role === "assistant") {
      const content = msg.content;
      // content is a non-empty string
      if (typeof content === "string" && content.trim()) {
        return true;
      }
      // Check for array content with text parts
      if (Array.isArray(content)) {
        /**
         * AI SDK 里 content 可能是纯字符串，
         * 也可能是结构化数组（多模态内容，如文本块、图片块、工具调用块等）。
         * 这里的规则是：
         *  1. 字符串形式：非空（去掉空白后仍有内容）才保留；
         *  2. 数组形式：用 .some() 检查是否至少包含一个有效文本片段——片段可以是字符串，
         *  也可以是带 text 字段的对象。只要有一个文本片段就保留。
         */
        const hasTextContent = content.some((part: unknown) => {
          if (typeof part === "string" && part.trim()) return true;
          if (typeof part === "object" && part !== null && "text" in part) {
            const textPart = part as { text?: string };
            return textPart.text && textPart.text.trim();
          }
          return false;
        });
        return hasTextContent;
      }
    }

    // Keep tool messages
    if (msg.role === "tool") {
      return true;
    }

    return false;
  });
};
