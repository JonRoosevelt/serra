import { readProfileFile } from '../config.ts';
import type { Command } from '../manage.ts';
import { formatMcpOverview, mcpOverview } from '../mcp.ts';

const command: Command = {
  summary: "List the MCP servers the worker's provider loads in T3, and any the alert triggers need. Read-only.",
  usage: ['pnpm bot tools --profile /absolute/profile [--json]'],
  async run({ flag, profileDir, log }) {
    const overview = mcpOverview(readProfileFile(profileDir));
    log(flag('--json') ? JSON.stringify(overview, null, 2) : formatMcpOverview(overview));
  },
};
export default command;
