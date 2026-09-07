import type { DatabaseSync } from "node:sqlite";
import { calibrateDifficulty } from "../shared/difficulty-calibration.ts";

type AggregateRow = {
  key: string;
  label: string;
  attempts: number;
  artistSuccesses: number;
  titleSuccesses: number;
  bothCorrect: number;
  artistOnly: number;
  titleOnly: number;
  neither: number;
};

const aggregate = (database: DatabaseSync, groupExpression: string, labelExpression: string) =>
  database.prepare(`SELECT ${groupExpression} AS key, ${labelExpression} AS label,
    COUNT(*) AS attempts,
    SUM(aa.artist_point) AS artistSuccesses,
    SUM(aa.title_point) AS titleSuccesses,
    SUM(CASE WHEN aa.artist_point = 1 AND aa.title_point = 1 THEN 1 ELSE 0 END) AS bothCorrect,
    SUM(CASE WHEN aa.artist_point = 1 AND aa.title_point = 0 THEN 1 ELSE 0 END) AS artistOnly,
    SUM(CASE WHEN aa.artist_point = 0 AND aa.title_point = 1 THEN 1 ELSE 0 END) AS titleOnly,
    SUM(CASE WHEN aa.artist_point = 0 AND aa.title_point = 0 THEN 1 ELSE 0 END) AS neither
    FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
    WHERE a.user_id = 'owner' AND aa.load_failed = 0
      AND NOT EXISTS (
        SELECT 1 FROM fragment_reports fr
        WHERE fr.attempt_id = aa.attempt_id AND fr.track_key = aa.track_key
          AND fr.reason = 'bad-fragment'
      )
    GROUP BY ${groupExpression}
    ORDER BY attempts DESC, label ASC`).all() as unknown as AggregateRow[];

const normalizeArtistKey = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();

export function difficultyCalibration(database: DatabaseSync) {
  const tracks = aggregate(database, "aa.track_key", "MAX(aa.artist || ' — ' || aa.title)")
    .map((row) => ({ trackKey: row.key, label: row.label, ...calibrateDifficulty(row) }));
  const artists = aggregate(database, "LOWER(TRIM(aa.artist))", "MAX(aa.artist)")
    .map((row) => ({ artistKey: normalizeArtistKey(row.label), artist: row.label, ...calibrateDifficulty(row) }));
  return {
    policy: {
      artistWeight: 2,
      titleWeight: 1,
      priorDifficulty: 50,
      priorStrength: 6,
      note: "Маленькие выборки стягиваются к средней сложности; плохие фрагменты и незагрузившиеся видео исключены.",
    },
    tracks,
    artists,
  };
}
