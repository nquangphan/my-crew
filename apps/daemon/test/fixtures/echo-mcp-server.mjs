// A minimal stdio MCP server for inventory tests: one tool with a description.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.registerTool(
  'say',
  { description: 'Lặp lại một từ', inputSchema: { word: z.string() } },
  async ({ word }) => ({
    content: [{ type: 'text', text: word }],
  }),
);
await server.connect(new StdioServerTransport());
