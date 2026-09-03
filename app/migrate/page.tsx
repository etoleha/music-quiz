"use client";

import { useEffect, useState } from "react";

type ImportResult = { ok?: boolean; attempts?: number; answers?: number; error?: string };

function decodeBase64(fragment: string) {
  const normalized = fragment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function decryptArchive(fragment: string) {
  const [keyFragment, archiveFragment] = fragment.split(".", 2);
  if (!keyFragment || !archiveFragment) throw new Error("fragment");
  const encrypted = decodeBase64(archiveFragment);
  if (encrypted.length < 29) throw new Error("archive");
  const iv = encrypted.slice(0, 12);
  const tag = encrypted.slice(12, 28);
  const ciphertext = encrypted.slice(28);
  const payload = new Uint8Array(ciphertext.length + tag.length);
  payload.set(ciphertext);
  payload.set(tag, ciphertext.length);
  const key = await crypto.subtle.importKey("raw", decodeBase64(keyFragment), "AES-GCM", false, ["decrypt"]);
  const compressed = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

export default function MigrationPage() {
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Переношу прежние прохождения…");

  useEffect(() => {
    let active = true;
    const migrate = async () => {
      try {
        const fragment = window.location.hash.slice(1);
        if (!fragment) throw new Error("key");
        const archive = await decryptArchive(fragment);
        const response = await fetch("/api/import-legacy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(archive),
        });
        const result = (await response.json()) as ImportResult;
        if (!response.ok || !result.ok) throw new Error(result.error ?? "import");
        if (active) {
          window.history.replaceState(null, "", "/migrate");
          setState("done");
          setMessage(`Готово: ${result.attempts ?? 0} прохождений и ${result.answers ?? 0} ответов в статистике.`);
        }
      } catch {
        if (active) {
          setState("error");
          setMessage("Перенос не сработал. Открой исходную ссылку ещё раз.");
        }
      }
    };
    void migrate();
    return () => { active = false; };
  }, []);

  return (
    <main className="shell migration-shell">
      <section className="migration-card">
        <p className="eyebrow">Статистика</p>
        <h1>{state === "done" ? "Перенос завершён" : state === "error" ? "Нужна повторная попытка" : "Перенос данных"}</h1>
        <p className={`migration-status ${state}`}>{message}</p>
        {state === "done" && <a className="migration-link" href="/">Открыть квизы и статистику</a>}
      </section>
    </main>
  );
}
