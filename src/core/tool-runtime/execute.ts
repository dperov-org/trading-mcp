import { ZodError } from 'zod';
import type { ToolArguments, ToolDefinition } from './types.js';

export function createToolTextResponse(text: string, isError = false) {
  if (isError) {
    return {
      content: [{ type: 'text' as const, text }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}

export function formatToolExecutionError(err: unknown): string {
  if (err instanceof ZodError) {
    return `Validation error: ${err.errors.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}`;
  }

  return `Error: ${(err as Error).message}`;
}

export async function executeToolCall(
  tool: ToolDefinition,
  args: ToolArguments | undefined,
) {
  try {
    const parsed = tool.inputSchema.parse(args ?? {}) as ToolArguments;
    const result = await tool.handler(parsed);
    return createToolTextResponse(JSON.stringify(result, null, 2));
  } catch (err) {
    return createToolTextResponse(formatToolExecutionError(err), true);
  }
}
