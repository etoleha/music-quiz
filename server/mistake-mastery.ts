import type { DatabaseSync } from "node:sqlite";

export const requiredMistakeSuccesses = 2;

type MistakeResult = {
  trackKey: string;
  artist: string;
  title: string;
  artistPoint: number;
  titlePoint: number;
  loadFailed: boolean;
};

const currentMastery = (database: DatabaseSync, trackKey: string) => database.prepare(`SELECT
  successes, active FROM mistake_mastery WHERE track_key = ?`).get(trackKey) as {
    successes: number;
    active: number;
  } | undefined;

export function applyMistakeResult(database: DatabaseSync, result: MistakeResult) {
  if (result.loadFailed) return;
  const correct = result.artistPoint + result.titlePoint === 2;
  const current = currentMastery(database, result.trackKey);
  if (!correct) {
    database.prepare(`INSERT INTO mistake_mastery
      (track_key, artist, title, successes, required_successes, misses, active, last_error_at, updated_at)
      VALUES (?, ?, ?, 0, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(track_key) DO UPDATE SET
        artist = excluded.artist,
        title = excluded.title,
        successes = 0,
        misses = mistake_mastery.misses + 1,
        active = 1,
        last_error_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP`).run(
          result.trackKey,
          result.artist,
          result.title,
          requiredMistakeSuccesses,
        );
    return;
  }
  if (!current?.active) return;
  const successes = Math.min(requiredMistakeSuccesses, current.successes + 1);
  database.prepare(`UPDATE mistake_mastery SET successes = ?, active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE track_key = ?`).run(successes, successes < requiredMistakeSuccesses ? 1 : 0, result.trackKey);
}

export function rebuildMistakeMasteryForTrack(database: DatabaseSync, trackKey: string) {
  const history = database.prepare(`SELECT aa.track_key AS trackKey, aa.artist, aa.title,
    aa.artist_point AS artistPoint, aa.title_point AS titlePoint, aa.load_failed AS loadFailed
    FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
    WHERE a.user_id = 'owner' AND aa.track_key = ?
      AND NOT (
        TRIM(aa.artist_answer) = '' AND TRIM(aa.title_answer) = ''
        AND EXISTS (
          SELECT 1 FROM fragment_reports fr
          WHERE fr.attempt_id = aa.attempt_id AND fr.track_key = aa.track_key
            AND fr.reason = 'bad-fragment'
        )
      )
    ORDER BY a.created_at ASC, aa.id ASC`).all(trackKey) as Array<{
      trackKey: string;
      artist: string;
      title: string;
      artistPoint: number;
      titlePoint: number;
      loadFailed: number;
    }>;
  database.prepare("DELETE FROM mistake_mastery WHERE track_key = ?").run(trackKey);
  for (const item of history) applyMistakeResult(database, { ...item, loadFailed: Boolean(item.loadFailed) });
}

export function backfillMistakeMastery(database: DatabaseSync) {
  const existing = database.prepare("SELECT COUNT(*) AS count FROM mistake_mastery").get() as { count: number };
  if (!existing.count) {
    const missedTracks = database.prepare(`SELECT DISTINCT aa.track_key AS trackKey
      FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      WHERE a.user_id = 'owner' AND aa.load_failed = 0 AND (aa.artist_point + aa.title_point) < 2`).all() as Array<{ trackKey: string }>;
    for (const { trackKey } of missedTracks) rebuildMistakeMasteryForTrack(database, trackKey);
  }
  const exemptedTracks = database.prepare(`SELECT DISTINCT aa.track_key AS trackKey
    FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
    JOIN fragment_reports fr ON fr.attempt_id = aa.attempt_id AND fr.track_key = aa.track_key
    WHERE a.user_id = 'owner' AND TRIM(aa.artist_answer) = '' AND TRIM(aa.title_answer) = ''
      AND fr.reason = 'bad-fragment'`).all() as Array<{ trackKey: string }>;
  for (const { trackKey } of exemptedTracks) rebuildMistakeMasteryForTrack(database, trackKey);
}
