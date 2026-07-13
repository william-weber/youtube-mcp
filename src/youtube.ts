import { google, type youtube_v3 } from "googleapis";
import { getAuthorizedClient } from "./auth.js";

export interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: string;
  url: string;
}

export interface PlaylistResult {
  playlistId: string;
  url: string;
  added: string[];
  failed: { id: string; reason: string }[];
}

let yt: youtube_v3.Youtube | undefined;

async function getClient(): Promise<youtube_v3.Youtube> {
  if (!yt) {
    yt = google.youtube({ version: "v3", auth: await getAuthorizedClient() });
  }
  return yt;
}

/** "PT1H4M13S" -> "1:04:13", "PT4M13S" -> "4:13"; live streams report "P0D" */
function formatDuration(iso: string | null | undefined): string {
  if (iso === "P0D") return "live";
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return "?";
  const [, d, dh, min, s] = m.map((v) => Number(v ?? 0));
  const h = d * 24 + dh;
  const mm = h ? String(min).padStart(2, "0") : String(min);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function searchVideos(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const youtube = await getClient();
  const search = await youtube.search.list({
    part: ["snippet"],
    q: query,
    type: ["video"],
    maxResults: Math.min(Math.max(maxResults, 1), 25),
  });

  const items = search.data.items ?? [];
  const ids = items
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  // search.list has no contentDetails; one batched videos.list gets durations
  const details = await youtube.videos.list({
    part: ["contentDetails", "snippet"],
    id: ids,
  });
  const byId = new Map(
    (details.data.items ?? []).map((v) => [v.id ?? "", v])
  );

  return ids.map((id) => {
    const video = byId.get(id);
    return {
      id,
      title: video?.snippet?.title ?? "(unknown title)",
      channel: video?.snippet?.channelTitle ?? "(unknown channel)",
      duration: formatDuration(video?.contentDetails?.duration),
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  });
}

export async function createPlaylist(
  title: string,
  videoIds: string[],
  description?: string
): Promise<PlaylistResult> {
  const youtube = await getClient();
  const playlist = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description },
      status: { privacyStatus: "private" },
    },
  });

  const playlistId = playlist.data.id;
  if (!playlistId) {
    throw new Error("playlists.insert returned no playlist id");
  }

  const added: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const videoId of videoIds) {
    try {
      await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      });
      added.push(videoId);
    } catch (err) {
      failed.push({
        id: videoId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    playlistId,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    added,
    failed,
  };
}
