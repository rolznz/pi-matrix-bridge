import type { AssistantMessage } from "@earendil-works/pi-ai";

/**
 * Extract text from assistant message.
 */
export function extractTextFromMessage(message: AssistantMessage): string {
  const textParts = message.content.filter((part) => part.type === "text");
  return textParts.map((part: any) => part.text).join("\n");
}

/**
 * Extract the model's reasoning (thinking) text from an assistant message.
 * Returns "" when there is none (or it was redacted to an empty block).
 */
export function extractThinkingFromMessage(message: AssistantMessage): string {
  const thinkingParts = message.content.filter((part) => part.type === "thinking");
  return thinkingParts
    .map((part: any) => part.thinking ?? "")
    .join("\n")
    .trim();
}

/**
 * Check if assistant message contains tool calls (more turns will follow).
 */
export function hasToolCalls(message: AssistantMessage): boolean {
  return message.content.some((part) => part.type === "toolCall");
}

/**
 * Format a single tool-call summary line for the remote user.
 * Wraps the tool name in backticks so Matrix renders it as inline code,
 * preserving snake_case readability.
 */
export function formatToolCall(name: string, args: Record<string, unknown> | undefined): string {
  const toolName = name || "tool";
  const argPairs = Object.entries(args || {})
    .map(([k, v]) => {
      const valStr = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${truncate(valStr, 50)}`;
    })
    .join(", ");

  return argPairs ? `🔧 \`${toolName}\` (${argPairs})` : `🔧 \`${toolName}\``;
}

/**
 * Format tool call summaries for the remote user.
 */
export function formatToolCalls(message: AssistantMessage): string {
  const toolCalls = message.content.filter((part) => part.type === "toolCall");
  if (toolCalls.length === 0) return "";
  return toolCalls
    .map((tc: any) => formatToolCall(tc.name, tc.arguments))
    .join("\n");
}

/**
 * Extract text from a tool result (AgentToolResult-shaped, or a plain string).
 */
export function extractToolResultText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  const content = result.content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n");
  }
  return "";
}

/**
 * Format a tool's output, shown (truncated) under its call line.
 * Returns "" when there's nothing to show and it wasn't an error.
 */
export function formatToolResult(result: any, isError: boolean): string {
  const text = extractToolResultText(result).trim();
  if (!text) return isError ? "↳ ⚠️ (error)" : "";
  return `↳ ${isError ? "⚠️ " : ""}${truncate(text, 1500)}`;
}

/**
 * Truncate string to max length with ellipsis.
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

/**
 * Split long messages into chunks, breaking at newlines when possible.
 */
export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt < maxLen * 0.5) {
      breakAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (breakAt < maxLen * 0.3) {
      breakAt = maxLen;
    }

    chunks.push(remaining.substring(0, breakAt));
    remaining = remaining.substring(breakAt).trimStart();
  }

  return chunks;
}
