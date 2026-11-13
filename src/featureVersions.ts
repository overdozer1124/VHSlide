import type { HistorySQL } from "./historyStore.ts";

/** Per-deck, per-feature change counters, maintained by SQLite triggers
 * on the feature's tables. Polling clients send the version they already
 * have; when it still matches, the server answers "unchanged" after
 * reading this single row instead of re-reading the whole list. That
 * keeps idle polling at a couple of SQL rows read per request, which is
 * what the cloud quota actually meters. */
export const featureVersionSchema = `
CREATE TABLE IF NOT EXISTS feature_versions(deck TEXT NOT NULL, feature TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(deck,feature));`;

export function featureVersion(
  sql: HistorySQL,
  deck: string,
  feature: string,
): number {
  const row = [
    ...sql(
      "SELECT version FROM feature_versions WHERE deck=? AND feature=?",
      deck,
      feature,
    ),
  ][0];
  return row ? Number(row.version) : 0;
}

/** AFTER INSERT/UPDATE/DELETE triggers that bump the feature counter.
 * deckOf maps a row alias (NEW/OLD) to a SQL expression for its deck id. */
export function versionTriggers(
  table: string,
  feature: string,
  deckOf: (alias: "NEW" | "OLD") => string,
): string {
  const bump = (alias: "NEW" | "OLD") =>
    `INSERT INTO feature_versions(deck,feature,version) VALUES(${deckOf(alias)},'${feature}',1) ON CONFLICT(deck,feature) DO UPDATE SET version=version+1;`;
  return `
CREATE TRIGGER IF NOT EXISTS fv_${table}_ins AFTER INSERT ON ${table} BEGIN ${bump("NEW")} END;
CREATE TRIGGER IF NOT EXISTS fv_${table}_upd AFTER UPDATE ON ${table} BEGIN ${bump("NEW")} END;
CREATE TRIGGER IF NOT EXISTS fv_${table}_del AFTER DELETE ON ${table} BEGIN ${bump("OLD")} END;`;
}
