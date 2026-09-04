import Link from "next/link";
import { getCatalogPage, type CatalogFilters } from "../../server/song-catalog";

export const dynamic = "force-dynamic";

const valueOf = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const filtersFrom = (params: Record<string, string | string[] | undefined>): CatalogFilters => Object.fromEntries(
  Object.entries(params).map(([key, value]) => [key, valueOf(value)]),
);
const label = (value: string) => ({ russian: "русский", foreign: "иностранный", mixed: "смешанный", unknown: "не определён", waiting: "ожидает", used: "использована", rejected: "отклонена" }[value] || value);

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = filtersFrom(await searchParams);
  const result = getCatalogPage(filters);
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)]));
    params.set("page", String(page));
    return `/catalog?${params}`;
  };
  return <main className="catalog-shell">
    <header className="catalog-header"><div><Link href="/" className="catalog-back">← К квизам</Link><h1>Общая база песен</h1><p>Отбор, проверка годов и подготовка следующих квизов</p></div><div className="catalog-count">{result.total.toLocaleString("ru-RU")}<small>по фильтру</small></div></header>
    <section className="catalog-stats">
      <article><strong>{Number(result.stats.songs).toLocaleString("ru-RU")}</strong><span>всего песен</span></article>
      <article><strong>{Number(result.stats.readyForCuration).toLocaleString("ru-RU")}</strong><span>готовы к отбору</span></article>
      <article><strong>{Number(result.stats.readyForUniqueArtistQuiz).toLocaleString("ru-RU")}</strong><span>с новыми исполнителями</span></article>
      <article><strong>{Number(result.stats.withCandidateReleaseYear).toLocaleString("ru-RU")}</strong><span>есть кандидат года</span></article>
      <article><strong>{Number(result.stats.withAutomaticEnrichment || 0).toLocaleString("ru-RU")}</strong><span>найдена подробная справка</span></article>
      <article><strong>{Number(result.stats.readyForPublication).toLocaleString("ru-RU")}</strong><span>полностью готовы</span></article>
    </section>
    <form className="catalog-filters">
      <label>Поиск<input name="q" defaultValue={filters.q} placeholder="Исполнитель или песня" /></label>
      <label>Готовность<select name="readiness" defaultValue={filters.readiness || "all"}><option value="all">Любая</option><option value="curation">К отбору</option><option value="unique">Новые исполнители</option><option value="publish">К публикации</option><option value="review">Нужна проверка</option></select></label>
      <label>Язык<select name="language" defaultValue={filters.language || "all"}><option value="all">Любой</option><option value="russian">Русский</option><option value="foreign">Иностранный</option><option value="mixed">Смешанный</option><option value="unknown">Не определён</option></select></label>
      <label>Исполнители<select name="artistUsage" defaultValue={filters.artistUsage || "all"}><option value="all">Все</option><option value="new">Ещё не играли</option><option value="used">Уже встречались</option></select></label>
      <label>Источник<select name="source" defaultValue={filters.source || "all"}><option value="all">Любой</option>{result.sourceIds.map((source) => <option value={source} key={source}>{source}</option>)}</select></label>
      <label>Год<input name="year" defaultValue={filters.year} placeholder="например, 2008" /></label>
      <button type="submit">Применить</button><Link href="/catalog" className="catalog-reset">Сбросить</Link>
    </form>
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Песня</th><th>Год</th><th>Статус</th><th>Исполнители</th><th>Источники</th><th>Готовность</th></tr></thead><tbody>{result.songs.map((song) => <tr key={song.id}>
      <td><strong>{song.artist} — {song.title}</strong><small>{song.id}</small></td>
      <td>{song.release.releaseYear ? <span title={song.release.releaseYearStatus === "verified" ? "Подтверждено" : "Нужно подтвердить"}>{song.release.releaseYearStatus === "verified" ? "" : "≈ "}{song.release.releaseYear}</span> : "—"}</td>
      <td><span className={`catalog-status ${song.status.workflow}`}>{label(song.status.workflow)}</span><small>{label(song.status.language)}</small></td>
      <td>{song.usedArtistIds.length ? <span className="catalog-warning">есть использованные</span> : <span className="catalog-ok">все новые</span>}<small>{song.artistIds.length} {song.artistIds.length === 1 ? "сущность" : "участника"}</small></td>
      <td><span>{song.chart?.sourceIds.length || 0}</span><small>{song.candidateScore.toFixed(1)} балла</small></td>
      <td><div className="catalog-readiness" title="Личность · год · ролик/фрагмент · оформление"><i className={song.readyForCuration ? "done" : ""} /><i className={song.release.releaseYearStatus === "verified" ? "done" : ""} /><i className={song.externalIds.youtube?.length && song.status.fragment === "good" ? "done" : ""} /><i className={song.enrichment.review === "verified" ? "done" : ""} /></div></td>
    </tr>)}</tbody></table></div>
    <nav className="catalog-pages"><span>Страница {result.page} из {result.pageCount}</span><div>{result.page > 1 && <Link href={hrefForPage(result.page - 1)}>← Назад</Link>}{result.page < result.pageCount && <Link href={hrefForPage(result.page + 1)}>Вперёд →</Link>}</div></nav>
  </main>;
}
