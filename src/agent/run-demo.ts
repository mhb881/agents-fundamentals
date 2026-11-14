import "dotenv/config";
import * as readline from "node:readline/promises";

import { deepSeek } from "@ai-sdk/deepseek";
import { streamText, type ModelMessage } from "ai";

const messages: ModelMessage[] = [];

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  while (true) {
    const userInput = await terminal.question("You: ");

    messages.push({ role: "user", content: userInput });

    const result = await streamText({
      model: deepSeek("deepseek-v4-flash"),
      messages,
    });

    let fullResponse = "";
    process.stdout.write("\nAssistant: ");
    for await (const delta of result.textStream) {
      fullResponse += delta;
      process.stdout.write(delta);
    }
    process.stdout.write("\n\n");

    messages.push({ role: "assistant", content: fullResponse });
  }
}

// main().catch(console.error);
