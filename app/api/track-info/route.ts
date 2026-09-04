import { getPersistedTrackInfo } from "../../../server/song-enrichment";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artist = url.searchParams.get("artist")?.trim();
  const title = url.searchParams.get("title")?.trim();
  const youtubeId = url.searchParams.get("youtubeId")?.trim();
  if (!artist || !title || artist.length > 200 || title.length > 200) {
    return Response.json({ error: "Некорректная песня" }, { status: 400 });
  }
  if (youtubeId && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    return Response.json({ error: "Некорректное видео" }, { status: 400 });
  }
  const payload = getPersistedTrackInfo(artist, title, youtubeId);
  return payload
    ? Response.json(payload, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } })
    : Response.json({ error: "Справка пока не найдена" }, { status: 404 });
}
