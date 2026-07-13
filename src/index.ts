#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPlaylist, searchVideos } from "./youtube.js";

const server = new McpServer({ name: "yt-playlist-mcp", version: "0.1.0" });

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

server.registerTool(
  "search_youtube",
  {
    title: "Search YouTube",
    description:
      "Search YouTube for videos. Returns id, title, channel, duration, and URL for each result.",
    inputSchema: {
      query: z.string().min(1).describe("Search query"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(25)
        .default(10)
        .describe("Number of results to return (1-25, default 10)"),
    },
  },
  async ({ query, max_results }) => {
    try {
      const results = await searchVideos(query, max_results);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "create_playlist",
  {
    title: "Create YouTube playlist",
    description:
      "Create a new private YouTube playlist on the authorized account and add the given videos to it, in order. Returns the playlist URL plus which videos were added or failed.",
    inputSchema: {
      title: z.string().min(1).describe("Playlist title"),
      video_ids: z
        .array(z.string().min(1))
        .min(1)
        .describe("YouTube video IDs to add, in playlist order"),
      description: z.string().optional().describe("Optional playlist description"),
    },
  },
  async ({ title, video_ids, description }) => {
    try {
      const result = await createPlaylist(title, video_ids, description);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

// stdout carries MCP protocol traffic; log only to stderr
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("yt-playlist-mcp running on stdio");
