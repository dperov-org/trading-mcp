import type { ZodTypeAny } from 'zod';

export type ToolArguments = Record<string, unknown>;
export type ToolOperation = 'read' | 'write';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (input: ToolArguments) => Promise<unknown>;
  /** Runtime-only execution classification. It is intentionally not published in the MCP tool schema. */
  operation?: ToolOperation;
}
