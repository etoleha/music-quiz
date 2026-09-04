import { getLocalDb } from "../../../server/local-db";

export const runtime = "nodejs";

const userAgent = "LamtyuginMusicQuiz/1.0 (https://quiz.lamtyugin.com)";
const yearOf = (value?: string) => value?.match(/(?:19|20)\d{2}/)?.[0];

type MusicBrainzRecording = {
  score?: number;
  title: string;
  "artist-credit"?: Array<{ artist: { id: string; name: string } }>;
  releases?: Array<{
    title: string;
    date?: string;
    status?: string;
    "release-group"?: { id: string; title: string; "primary-type"?: string; "first-release-date"?: string };
  }>;
};

type MusicBrainzArtist = {
  name?: string;
  country?: string;
  area?: { name?: string };
  "life-span"?: { begin?: string; end?: string; ended?: boolean };
  relations?: Array<{
    type?: string;
    direction?: string;
    begin?: string;
    end?: string;
    attributes?: string[];
    artist?: { id?: string; name?: string };
    url?: { resource?: string };
  }>;
};

const musicBrainz = async <T,>(path: string) => {
  const response = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
  return response.json() as Promise<T>;
};

const publicJson = async <T,>(url: string) => {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Public data ${response.status}`);
  return response.json() as Promise<T>;
};

async function wikidataEnrichment(qid?: string) {
  if (!qid) return {};
  const document = await publicJson<{ entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }> }>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const entity = document.entities?.[qid];
  const claimValues = (property: string) => (entity?.claims?.[property] || []).map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean);
  const relatedIds = [...claimValues("P1344"), ...claimValues("P166")].flatMap((value) => typeof value === "object" && value && "id" in value ? [String((value as { id: string }).id)] : []).slice(0, 4);
  let labels: Record<string, string> = {};
  if (relatedIds.length) {
    const labelData = await publicJson<{ entities?: Record<string, { labels?: Record<string, { value: string }> }> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${relatedIds.join("|")}&props=labels&languages=ru|en&format=json&origin=*`);
    labels = Object.fromEntries(Object.entries(labelData.entities || {}).map(([id, item]) => [id, item.labels?.ru?.value || item.labels?.en?.value || id]));
  }
  const facts = [
    ...claimValues("P1344").flatMap((value) => typeof value === "object" && value && "id" in value ? [{ text: `Среди заметных событий — участие в «${labels[String((value as { id: string }).id)] || (value as { id: string }).id}».`, sourceUrl: `https://www.wikidata.org/wiki/${qid}` }] : []),
    ...claimValues("P166").flatMap((value) => typeof value === "object" && value && "id" in value ? [{ text: `Среди наград — «${labels[String((value as { id: string }).id)] || (value as { id: string }).id}».`, sourceUrl: `https://www.wikidata.org/wiki/${qid}` }] : []),
  ].slice(0, 3);

  const imageName = claimValues("P18").find((value): value is string => typeof value === "string");
  let image: { url: string; attribution?: string; license?: string; licenseUrl?: string; sourceUrl?: string } | undefined;
  if (imageName) {
    const imageData = await publicJson<{ query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }> }> } }>(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${imageName}`)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`);
    const info = Object.values(imageData.query?.pages || {})[0]?.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value;
    if (info?.thumburl && license && /(?:CC|Creative Commons|Public domain|PD)/i.test(license)) {
      image = {
        url: info.thumburl,
        attribution: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        license,
        licenseUrl: info.extmetadata?.LicenseUrl?.value,
        sourceUrl: info.descriptionurl,
      };
    }
  }
  return { facts, image, wikidataUrl: `https://www.wikidata.org/wiki/${qid}` };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artist = url.searchParams.get("artist")?.trim();
  const title = url.searchParams.get("title")?.trim();
  const trackKey = url.searchParams.get("key")?.trim();
  if (!artist || !title || !trackKey || artist.length > 200 || title.length > 200 || trackKey.length > 500) {
    return Response.json({ error: "Некорректная песня" }, { status: 400 });
  }

  const database = getLocalDb();
  const cached = database.prepare("SELECT payload_json AS payloadJson FROM track_info_cache WHERE track_key = ? AND expires_at > CURRENT_TIMESTAMP").get(trackKey) as { payloadJson: string } | undefined;
  if (cached) return Response.json(JSON.parse(cached.payloadJson));

  try {
    const query = encodeURIComponent(`recording:\"${title.replaceAll('"', "")}\" AND artist:\"${artist.replaceAll('"', "")}\"`);
    const recordings = await musicBrainz<{ recordings?: MusicBrainzRecording[] }>(`recording?query=${query}&limit=8`);
    const recording = recordings.recordings?.find((item) => (item.score ?? 0) >= 90) ?? recordings.recordings?.[0];
    if (!recording) throw new Error("recording not found");
    const official = (recording.releases || []).filter((release) => !release.status || release.status === "Official");
    const sorted = official.sort((left, right) => (left.date || "9999").localeCompare(right.date || "9999"));
    const albumRelease = sorted.find((release) => release["release-group"]?.["primary-type"] === "Album");
    const primaryRelease = albumRelease || sorted[0];
    const releaseGroup = primaryRelease?.["release-group"];
    const artistCredit = recording["artist-credit"]?.[0]?.artist;
    let artistDetails: MusicBrainzArtist | null = null;
    if (artistCredit?.id) artistDetails = await musicBrainz(`artist/${artistCredit.id}?inc=artist-rels+url-rels`);
    const begin = artistDetails?.["life-span"]?.begin?.slice(0, 4);
    const end = artistDetails?.["life-span"]?.end?.slice(0, 4);
    const wikidataResource = artistDetails?.relations?.find((relation) => relation.type === "wikidata")?.url?.resource;
    const qid = wikidataResource?.match(/Q\d+$/)?.[0];
    const structured = await wikidataEnrichment(qid).catch(() => ({}));
    const members = (artistDetails?.relations || [])
      .filter((relation) => relation.type === "member of band" && relation.artist?.name && !relation.end)
      .map((relation) => ({ name: relation.artist!.name!, roles: relation.attributes || [], since: yearOf(relation.begin) }))
      .slice(0, 12);
    const payload = {
      name: artistDetails?.name || artistCredit?.name || artist,
      country: artistDetails?.area?.name || artistDetails?.country,
      activeYears: begin ? (artistDetails?.["life-span"]?.ended ? `${begin}–${end || "?"}` : `с ${begin}`) : undefined,
      members,
      image: "image" in structured ? structured.image : undefined,
      facts: "facts" in structured ? structured.facts : [],
      artistUrl: artistCredit?.id ? `https://musicbrainz.org/artist/${artistCredit.id}` : undefined,
      recordingTitle: recording.title,
      releaseYear: Number(yearOf(releaseGroup?.["first-release-date"] || primaryRelease?.date)) || undefined,
      releaseYearStatus: "candidate",
      album: primaryRelease ? {
        title: releaseGroup?.title || primaryRelease.title,
        kind: releaseGroup?.["primary-type"]?.toLocaleLowerCase("ru-RU") || "release",
        year: Number(yearOf(releaseGroup?.["first-release-date"] || primaryRelease.date)) || undefined,
        coverUrl: releaseGroup?.id ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-500` : undefined,
      } : undefined,
      sources: [
        { name: "MusicBrainz", url: artistCredit?.id ? `https://musicbrainz.org/artist/${artistCredit.id}` : "https://musicbrainz.org" },
        ...("wikidataUrl" in structured ? [{ name: "Wikidata", url: structured.wikidataUrl }] : []),
      ],
    };
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare(`INSERT INTO track_info_cache (track_key, payload_json, updated_at, expires_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(track_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at`).run(trackKey, JSON.stringify(payload), expiresAt);
    return Response.json(payload);
  } catch (error) {
    console.error("track info unavailable", error);
    return Response.json({ error: "Справка пока не найдена" }, { status: 404 });
  }
}
