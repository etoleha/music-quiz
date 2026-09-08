"use client";

export type SiteSection = "quizzes" | "video" | "history" | "stats" | "catalog";
const sections: Array<[SiteSection, string]> = [["quizzes", "Музыкальные"], ["video", "Видеоквизы"], ["history", "История"], ["stats", "Статистика"], ["catalog", "Фонотека"]];

export default function SiteHeader({ active = "quizzes", onNavigate, guest = false, separateCatalog = false }: { active?: string; onNavigate?: (section: SiteSection) => void; guest?: boolean; separateCatalog?: boolean }) {
  return <header className="site-header">
    {guest ? <span className="site-brand">НЕ ПО<br />ПРИПЕВУ<span aria-hidden="true">●</span></span> : <a className="site-brand" href="/" onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate("quizzes"); } : undefined}>НЕ ПО<br />ПРИПЕВУ<span aria-hidden="true">●</span></a>}
    {!guest && <nav aria-label="Основное меню">{sections.map(([section, label]) => <a key={section} href={section === "catalog" ? "/catalog" : `/?section=${section}`} aria-current={active === section ? "page" : undefined} target={section === "catalog" && separateCatalog ? "_blank" : undefined} rel={section === "catalog" && separateCatalog ? "noreferrer" : undefined} onClick={onNavigate && section !== "catalog" ? (event) => { event.preventDefault(); onNavigate(section); } : undefined}>{label}</a>)}</nav>}
    <span className="site-profile">{guest ? "Гостевой квиз" : "Алексей"}</span>
  </header>;
}
