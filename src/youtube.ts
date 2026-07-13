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

export interface PlaylistInfo {
  id: string;
  title: string;
  itemCount: number;
  privacy: string;
  url: string;
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

// Newly created playlists are eventually consistent: follow-up calls can get
// 404 playlistNotFound or aborted requests for a few seconds. Retrying may
// rarely double-add a video if an "aborted" insert actually landed — an
// acceptable trade-off for playlists.
const TRANSIENT = /playlistNotFound|aborted|ECONNRESET|ETIMEDOUT|socket hang up/i;

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= attempts || !TRANSIENT.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function insertVideos(
  youtube: youtube_v3.Youtube,
  playlistId: string,
  videoIds: string[]
): Promise<Pick<PlaylistResult, "added" | "failed">> {
  const added: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const videoId of videoIds) {
    try {
      await withRetry(() =>
        youtube.playlistItems.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              playlistId,
              resourceId: { kind: "youtube#video", videoId },
            },
          },
        })
      );
      added.push(videoId);
    } catch (err) {
      failed.push({
        id: videoId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { added, failed };
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

  return {
    playlistId,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    ...(await insertVideos(youtube, playlistId, videoIds)),
  };
}

export async function addToPlaylist(
  playlistId: string,
  videoIds: string[]
): Promise<PlaylistResult> {
  const youtube = await getClient();
  return {
    playlistId,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    ...(await insertVideos(youtube, playlistId, videoIds)),
  };
}

/**
 * Lists the authorized account's own playlists (search.list can't scope to
 * "mine", so filtering by title happens client-side).
 */
export async function searchPlaylists(query?: string): Promise<PlaylistInfo[]> {
  const youtube = await getClient();
  const playlists: PlaylistInfo[] = [];
  let pageToken: string | undefined;
  do {
    const res = await youtube.playlists.list({
      part: ["snippet", "contentDetails", "status"],
      mine: true,
      maxResults: 50,
      pageToken,
    });
    for (const p of res.data.items ?? []) {
      if (!p.id) continue;
      playlists.push({
        id: p.id,
        title: p.snippet?.title ?? "(untitled)",
        itemCount: p.contentDetails?.itemCount ?? 0,
        privacy: p.status?.privacyStatus ?? "unknown",
        url: `https://www.youtube.com/playlist?list=${p.id}`,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && playlists.length < 200);

  const q = query?.trim().toLowerCase();
  if (!q) return playlists;
  return playlists.filter((p) => p.title.toLowerCase().includes(q));
}

export interface PlaylistItem {
  videoId: string;
  title: string;
  channel: string;
  position: number;
  url: string;
}

export async function listPlaylistItems(
  playlistId: string
): Promise<PlaylistItem[]> {
  const youtube = await getClient();
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      youtube.playlistItems.list({
        part: ["snippet"],
        playlistId,
        maxResults: 50,
        pageToken,
      })
    );
    for (const item of res.data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      items.push({
        videoId,
        // deleted/private videos show up as "Deleted video"/"Private video"
        title: item.snippet?.title ?? "(unknown title)",
        channel: item.snippet?.videoOwnerChannelTitle ?? "(unknown channel)",
        position: item.snippet?.position ?? items.length,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && items.length < 500);
  return items;
}

export interface ReorderResult {
  playlistId: string;
  moves: number;
  order: string[];
}

/**
 * Reorders a playlist so the given videos appear first, in the given order;
 * unmentioned videos keep their relative order after them. Each API position
 * update costs 50 quota units, so we simulate the list and only move items
 * that are out of place instead of rewriting every position.
 */
export async function reorderPlaylist(
  playlistId: string,
  videoIds: string[]
): Promise<ReorderResult> {
  const youtube = await getClient();
  const items: { itemId: string; videoId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      youtube.playlistItems.list({
        part: ["snippet"],
        playlistId,
        maxResults: 50,
        pageToken,
      })
    );
    for (const item of res.data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (item.id && videoId) items.push({ itemId: item.id, videoId });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && items.length < 500);

  // Target order: requested videos first (consuming duplicates in order of
  // appearance), then everything else in its current relative order.
  const pool = [...items];
  const target: typeof items = [];
  const missing: string[] = [];
  for (const videoId of videoIds) {
    const idx = pool.findIndex((p) => p.videoId === videoId);
    if (idx === -1) {
      missing.push(videoId);
      continue;
    }
    target.push(...pool.splice(idx, 1));
  }
  if (missing.length > 0) {
    throw new Error(
      `Not in playlist ${playlistId}: ${missing.join(", ")} — no changes made`
    );
  }
  target.push(...pool);

  const current = [...items];
  let moves = 0;
  for (let i = 0; i < target.length; i++) {
    if (current[i].itemId === target[i].itemId) continue;
    const j = current.findIndex((c) => c.itemId === target[i].itemId);
    const [moved] = current.splice(j, 1);
    current.splice(i, 0, moved);
    await withRetry(() =>
      youtube.playlistItems.update({
        part: ["snippet"],
        requestBody: {
          id: moved.itemId,
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId: moved.videoId },
            position: i,
          },
        },
      })
    );
    moves++;
  }

  return { playlistId, moves, order: current.map((c) => c.videoId) };
}

/** Permanently deletes a playlist. Title lookup is best-effort, for the confirmation message. */
export async function deletePlaylist(
  playlistId: string
): Promise<{ playlistId: string; title: string | null; deleted: true }> {
  const youtube = await getClient();
  const res = await withRetry(() =>
    youtube.playlists.list({ part: ["snippet"], id: [playlistId], maxResults: 1 })
  );
  const title = res.data.items?.[0]?.snippet?.title ?? null;
  await withRetry(() => youtube.playlists.delete({ id: playlistId }));
  return { playlistId, title, deleted: true };
}

/**
 * Removes every occurrence of a video from a playlist. The API deletes
 * playlist *items*, so we first resolve the video ID to its item IDs.
 */
export async function removeVideo(
  playlistId: string,
  videoId: string
): Promise<{ playlistId: string; videoId: string; removed: number }> {
  const youtube = await getClient();
  // An empty result may also be consistency lag (video added moments ago),
  // so retry empty lookups before concluding the video isn't there.
  let itemIds: string[] = [];
  for (let attempt = 1; attempt <= 3 && itemIds.length === 0; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const items = await withRetry(() =>
      youtube.playlistItems.list({
        part: ["id"],
        playlistId,
        videoId,
        maxResults: 50,
      })
    );
    itemIds = (items.data.items ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
  }

  if (itemIds.length === 0) {
    throw new Error(`Video ${videoId} not found in playlist ${playlistId}`);
  }
  for (const id of itemIds) {
    await youtube.playlistItems.delete({ id });
  }
  return { playlistId, videoId, removed: itemIds.length };
}
