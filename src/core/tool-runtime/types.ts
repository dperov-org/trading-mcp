import type { ZodTypeAny } from 'zod';

export type ToolArguments = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (input: ToolArguments) => Promise<unknown>;
}
