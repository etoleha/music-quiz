"use client";

import { Component, useState, type ReactNode } from "react";
import type { Track } from "./quiz-data";
import "./track-reference-card.css";

export type ArtistInfo = {
  status: "loading" | "ready" | "error";
  name?: string;
  country?: string;
  activeYears?: string;
  artistUrl?: string;
  releaseYear?: number;
  releaseYearStatus?: "candidate" | "verified";
  versionYear?: number;
  album?: { title: string; kind?: string; year?: number; coverUrl?: string; sourceUrl?: string };
  members?: Array<{ name: string; roles?: string[]; role?: string; since?: string; highlighted?: boolean }>;
  image?: { url: string; attribution?: string; license?: string; licenseUrl?: string; sourceUrl?: string };
  facts?: Array<{ text: string; sourceUrl?: string }>;
  credits?: Array<{ role: string; names?: string[]; name?: string }>;
  soundtrack?: { title: string; kind?: string; year?: number; sourceUrl?: string };
  originalRecording?: { artist: string; title?: string; year?: number; sourceUrl: string };
  difficulty?: { band: "recognizable" | "middle" | "deep"; score: number; explanation: string; basis?: string[] };
  verification?: { status: "verified" | "published"; verifiedChecks: number; totalChecks: number };
  sources?: Array<{ provider: string; url: string }>;
};

const releaseKind = (kind?: string) => ({ album: "Альбом", single: "Сингл", soundtrack: "Саундтрек", archive: "Архивная запись", release: "Релиз" }[kind || ""] || "Релиз");
const validYear = (year?: number) => Number.isInteger(year) && year! > 0 ? year : undefined;
const difficultyName = { recognizable: "Знакомая", middle: "Средняя", deep: "Сложная" };

function ReferenceImage({ url, alt, caption, href, cover = false }: { url: string; alt: string; caption: string; href?: string; cover?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const picture = <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return <figure className={cover ? "track-reference__cover" : "track-reference__photo"}>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${caption}: открыть источник в новой вкладке`}>{picture}</a> : picture}
    <figcaption>{caption}</figcaption>
  </figure>;
}

class ReferenceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <section className="track-reference"><p className="track-reference__status">Справка временно недоступна.</p></section>
      : this.props.children;
  }
}

export default function TrackReferenceCard(props: { info?: ArtistInfo; track: Track }) {
  return <ReferenceBoundary key={props.track.key}><TrackReferenceContent {...props} /></ReferenceBoundary>;
}

function TrackReferenceContent({ info, track }: { info?: ArtistInfo; track: Track }) {
  const ready = info?.status === "ready" ? info : undefined;
  // These are song-year fields only. Album/version dates are kept on separate lines.
  const songYear = validYear(ready?.releaseYear) ?? validYear(track.releaseYear);
  const approximate = validYear(ready?.releaseYear) !== undefined && ready?.releaseYearStatus === "candidate";
  const versionYear = validYear(ready?.versionYear) ?? validYear(track.versionYear);
  const album: ArtistInfo["album"] = ready?.album ?? track.album;
  const facts = ready?.facts ?? track.facts ?? [];
  const sources = [...new Map((ready?.sources || []).filter(source => source.url).map(source => [source.url, source])).values()];
  // Published metadata has both grouped {names: []} and individual {name} credits.
  const credits = (Array.isArray(ready?.credits) ? ready.credits : []).flatMap(credit => {
    if (!credit) return [];
    const names = (Array.isArray(credit.names) ? credit.names : [credit.name]).filter((name): name is string => typeof name === "string" && !!name.trim());
    return names.length ? [{ role: credit.role, names }] : [];
  });
  const bandLabel = ready?.difficulty && difficultyName[ready.difficulty.band];
  const difficultyLabel = typeof bandLabel === "string" ? bandLabel.toLocaleLowerCase("ru-RU") : undefined;
  const hasMedia = !!(ready?.image?.url || album?.coverUrl);
  const hasDetails = !!(ready?.members?.length || credits.length || facts.length || sources.length || ready?.artistUrl || ready?.soundtrack || ready?.originalRecording || ready?.difficulty || ready?.image?.attribution || ready?.image?.license);

  return <section className={`track-reference${hasMedia ? " track-reference--with-media" : ""}`} aria-label={`Справка о песне «${track.title}»`}>
    {hasMedia && <div className="track-reference__media">
      {ready?.image?.url && <ReferenceImage key={ready.image.url} url={ready.image.url} alt={`Фото: ${track.artist}`} caption={track.artist} href={ready.image.sourceUrl} />}
      {album?.coverUrl && <ReferenceImage key={album.coverUrl} url={album.coverUrl} alt={`Обложка: ${album.title}`} caption="Обложка релиза" href={album.sourceUrl} cover />}
    </div>}
    <div className="track-reference__body">
      <dl className="track-reference__basics">
        <div><dt>Год песни</dt><dd>{songYear ? `${approximate ? "Около " : ""}${songYear}` : "Уточняется"}</dd></div>
        {album?.title && <div><dt>{releaseKind(album.kind)}</dt><dd>«{album.title}»{validYear(album.year) && <span className="track-reference__muted"> · {album.year}</span>}</dd></div>}
        {versionYear && versionYear !== songYear && <div><dt>Год этой версии</dt><dd>{versionYear}</dd></div>}
      </dl>
      {(ready?.country || ready?.activeYears) && <p className="track-reference__context">{[ready.country, ready.activeYears].filter(Boolean).join(" · ")}</p>}
      {(!info || info.status === "loading") && <p className="track-reference__status" role="status">Загружаем справку…</p>}
      {info?.status === "error" && <p className="track-reference__status">Дополнительная справка пока недоступна.</p>}
      {hasDetails && <details className="track-reference__details">
        <summary>Подробнее</summary>
        <div className="track-reference__expanded">
          {!!ready?.members?.length && <section><h4>Участники</h4><ul>{ready.members.map((member, index) => <li key={`${member.name}-${index}`}><span className={member.highlighted ? "track-reference__highlighted" : undefined}>{member.name}</span>{(member.role || member.roles?.length || member.since) && <span className="track-reference__muted"> — {[member.role || member.roles?.join(", "), member.since && `с ${member.since}`].filter(Boolean).join(" · ")}</span>}</li>)}</ul></section>}
          {!!credits.length && <section><h4>Авторы</h4><dl className="track-reference__credits">{credits.map((credit, index) => <div key={`${credit.role}-${index}`}><dt>{credit.role}</dt><dd>{credit.names.join(", ")}</dd></div>)}</dl></section>}
          {ready?.soundtrack && <section><h4>Саундтрек</h4><p>{ready.soundtrack.sourceUrl ? <a href={ready.soundtrack.sourceUrl} target="_blank" rel="noopener noreferrer">{ready.soundtrack.title}</a> : ready.soundtrack.title}{validYear(ready.soundtrack.year) ? ` · ${ready.soundtrack.year}` : ""}</p></section>}
          {ready?.originalRecording && <section><h4>Оригинальная запись</h4><p><a href={ready.originalRecording.sourceUrl} target="_blank" rel="noopener noreferrer">{ready.originalRecording.artist}{ready.originalRecording.title ? ` — ${ready.originalRecording.title}` : ""}</a>{validYear(ready.originalRecording.year) ? ` · ${ready.originalRecording.year}` : ""}</p></section>}
          {!!facts.length && <section><h4>О песне</h4><ul>{facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}{fact.sourceUrl && <> <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Источник факта ${index + 1}`}>Источник<span aria-hidden="true"> ↗</span></a></>}</li>)}</ul></section>}
          {ready?.difficulty && <section><h4>Сложность{difficultyLabel ? `: ${difficultyLabel}` : ""}</h4><p>{ready.difficulty.explanation}</p></section>}
          {(sources.length > 0 || ready?.artistUrl || ready?.image?.attribution || ready?.image?.license) && <section><h4>Источники</h4>
            {!!sources.length && <ul className="track-reference__sources">{sources.map((source, index) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.provider === "verification" ? `Проверка ${index + 1}` : source.provider || `Источник ${index + 1}`}<span aria-hidden="true"> ↗</span></a></li>)}</ul>}
            {ready?.artistUrl && <p><a href={ready.artistUrl} target="_blank" rel="noopener noreferrer">Профиль исполнителя<span aria-hidden="true"> ↗</span></a></p>}
            {(ready?.image?.attribution || ready?.image?.license) && <p className="track-reference__muted">Фото: {ready.image.attribution}{ready.image.attribution && ready.image.license ? " · " : ""}{ready.image.licenseUrl ? <a href={ready.image.licenseUrl} target="_blank" rel="noopener noreferrer">{ready.image.license || "Лицензия"}</a> : ready.image.license}</p>}
          </section>}
        </div>
      </details>}
    </div>
  </section>;
}
