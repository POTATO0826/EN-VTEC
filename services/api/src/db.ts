/**
 * Storage for the API.
 *
 * Build plan section 3: "SQLite + append-only job log, simple persistent queue."
 * Bun ships SQLite, so this needs no dependency.
 *
 * Two rules the schema enforces rather than trusts:
 *
 *   - `job_events` is append-only. Section 7 requires the experiment log keep
 *     every attempt including the rejected ones, and a log you can UPDATE is a
 *     log that can be tidied after the fact.
 *   - `proposals.digest` is UNIQUE. Section 3: "Restarted services must resume
 *     or explicitly fail interrupted jobs, never silently repeat a publication."
 *     Two rows with the same digest would be two chances to publish one approval.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id        TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      owner             TEXT NOT NULL,
      evaluator_signer  TEXT NOT NULL,
      bridge_signer     TEXT NOT NULL,
      policy_hash       TEXT NOT NULL,
      config_version    INTEGER NOT NULL DEFAULT 1,
      chain_id          INTEGER NOT NULL,
      registry_address  TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id             TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL REFERENCES projects(project_id),
      workload_id        TEXT NOT NULL,
      status             TEXT NOT NULL,
      budget_candidates  INTEGER NOT NULL,
      budget_seconds     INTEGER NOT NULL,
      idempotency_key    TEXT UNIQUE,
      created_at         TEXT NOT NULL
    );

    -- Append-only. Nothing in this service issues UPDATE or DELETE against it.
    CREATE TABLE IF NOT EXISTS job_events (
      seq      INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id   TEXT NOT NULL REFERENCES jobs(job_id),
      at       TEXT NOT NULL,
      payload  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_events_by_job ON job_events(job_id, seq);

    CREATE TABLE IF NOT EXISTS candidates (
      candidate_id     TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES projects(project_id),
      parent_id        TEXT NOT NULL,
      workload_hash    TEXT NOT NULL,
      env_scope_hash   TEXT NOT NULL,
      source_digest    TEXT NOT NULL,
      binary_digest    TEXT NOT NULL,
      hypothesis_hash  TEXT NOT NULL,
      manifest_hash    TEXT NOT NULL,
      hypothesis       TEXT NOT NULL,
      -- The readable hardware scope behind env_scope_hash. Stored so a consumer
      -- that declines can say which field differed instead of just showing two
      -- hashes that are not equal.
      env_scope        TEXT,
      job_id           TEXT REFERENCES jobs(job_id),
      created_at       TEXT NOT NULL,
      onchain_tx       TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      report_hash        TEXT PRIMARY KEY,
      candidate_id       TEXT NOT NULL REFERENCES candidates(candidate_id),
      policy_hash        TEXT NOT NULL,
      raw_samples_digest TEXT NOT NULL,
      environment_digest TEXT NOT NULL,
      verdict            TEXT NOT NULL,
      observed_at        INTEGER NOT NULL,
      evaluator          TEXT NOT NULL,
      signature          TEXT,
      body               TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      onchain_tx         TEXT
    );

    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id        TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL REFERENCES projects(project_id),
      channel            TEXT NOT NULL,
      channel_hash       TEXT NOT NULL,
      candidate_id       TEXT NOT NULL,
      report_hash        TEXT NOT NULL,
      policy_hash        TEXT NOT NULL,
      expected_previous  TEXT NOT NULL,
      nonce              TEXT NOT NULL,
      deadline           INTEGER NOT NULL,
      owner              TEXT NOT NULL,
      config_version     INTEGER NOT NULL,
      -- One row per approvable action. See the note at the top of this file.
      digest             TEXT NOT NULL UNIQUE,
      status             TEXT NOT NULL,
      consented_at       TEXT,
      identity_state     TEXT,
      identity_detail    TEXT,
      permit_signature   TEXT,
      -- "world" for a real identity journey, "dev-stub" for the labelled
      -- development escape hatch. Never null once a permit exists.
      permit_kind        TEXT,
      owner_signature    TEXT,
      release_id         TEXT,
      tx_hash            TEXT,
      created_at         TEXT NOT NULL
    );
  `);

  return db;
}

/* -------------------------------------------------------------------------- */
/* Append-only log                                                             */
/* -------------------------------------------------------------------------- */

export type StoredEvent = { seq: number; at: string; payload: unknown };

export function appendEvent(db: Database, jobId: string, payload: unknown): StoredEvent {
  const at = new Date().toISOString();
  const row = db
    .query<{ seq: number }, [string, string, string]>(
      "INSERT INTO job_events (job_id, at, payload) VALUES (?, ?, ?) RETURNING seq",
    )
    .get(jobId, at, JSON.stringify(payload));
  return { seq: row!.seq, at, payload };
}

export function eventsSince(db: Database, jobId: string, afterSeq: number): StoredEvent[] {
  return db
    .query<{ seq: number; at: string; payload: string }, [string, number]>(
      "SELECT seq, at, payload FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq",
    )
    .all(jobId, afterSeq)
    .map((row: { seq: number; at: string; payload: string }) => ({ seq: row.seq, at: row.at, payload: JSON.parse(row.payload) }));
}
