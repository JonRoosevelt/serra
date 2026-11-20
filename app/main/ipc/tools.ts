// Tools (MCP) (APP-23): the MCP servers the profile's worker will load in T3, read from the provider configs by
// src/mcp.ts. Read-only: MCP servers are configured in Claude or Codex, never here. The service reports a server by
// name, scope, transport and host only, so tokens in a config's env, headers or arguments never reach the window.
import { readProfileFile } from '../../../src/config.ts';
import { mcpOverview, type McpOptions, type McpOverview } from '../../../src/mcp.ts';
import type { Handlers } from '../bridge.ts';
import type { HandlerContext } from './context.ts';

export const toolsHandlers = (context: HandlerContext, options: McpOptions = {}): Handlers<'tools'> => ({
  overview: (): McpOverview => mcpOverview(readProfileFile(context.profileDir()), options),
});
