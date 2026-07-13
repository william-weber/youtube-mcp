#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylistItems,
  removeVideo,
  searchPlaylists,
  searchVideos,
} from "./youtube.js";

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

server.registerTool(
  "search_playlists",
  {
    title: "Search my playlists",
    description:
      "List the authorized account's own playlists, optionally filtered by a title substring. Use this to find an existing playlist's ID before adding or removing videos.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe("Case-insensitive title filter; omit to list all playlists"),
    },
  },
  async ({ query }) => {
    try {
      const results = await searchPlaylists(query);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "add_to_playlist",
  {
    title: "Add videos to a playlist",
    description:
      "Add videos to an existing playlist owned by the authorized account, in order. Returns which videos were added or failed.",
    inputSchema: {
      playlist_id: z.string().min(1).describe("Playlist ID (from search_playlists or create_playlist)"),
      video_ids: z
        .array(z.string().min(1))
        .min(1)
        .describe("YouTube video IDs to add, in order"),
    },
  },
  async ({ playlist_id, video_ids }) => {
    try {
      const result = await addToPlaylist(playlist_id, video_ids);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "list_playlist_items",
  {
    title: "List playlist contents",
    description:
      "List the videos in a playlist, in order, with video ID, title, channel, and position. Works on the authorized account's playlists.",
    inputSchema: {
      playlist_id: z.string().min(1).describe("Playlist ID (from search_playlists or create_playlist)"),
    },
  },
  async ({ playlist_id }) => {
    try {
      const results = await listPlaylistItems(playlist_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "remove_video",
  {
    title: "Remove a video from a playlist",
    description:
      "Remove all occurrences of a video from a playlist owned by the authorized account.",
    inputSchema: {
      playlist_id: z.string().min(1).describe("Playlist ID"),
      video_id: z.string().min(1).describe("YouTube video ID to remove"),
    },
  },
  async ({ playlist_id, video_id }) => {
    try {
      const result = await removeVideo(playlist_id, video_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "delete_playlist",
  {
    title: "Delete a playlist",
    description:
      "Permanently delete an entire playlist owned by the authorized account. This cannot be undone — confirm with the user before calling. To remove a single video instead, use remove_video.",
    inputSchema: {
      playlist_id: z.string().min(1).describe("Playlist ID to delete"),
    },
  },
  async ({ playlist_id }) => {
    try {
      const result = await deletePlaylist(playlist_id);
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
