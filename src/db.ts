import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { config } from "./config.js";
import { HttpError } from "./http.js";

/**
 * The minimal shape the application relies on. Stored documents contain many
 * more fields (director, rating, boxOffice, addedAt, internal ...) and several
 * BSON-specific types on purpose: the public API projects/shapes them away,
 * while /admin/raw/* shows every field exactly as stored.
 */
export interface Movie extends Document {
  title: string;
  year: number;
  genres: string[];
}

let client: MongoClient | undefined;

/** Lazily creates a single MongoClient (the driver manages its own pool). */
export function getClient(): MongoClient {
  if (client) return client;

  if (!config.credentialsConfigured) {
    throw new HttpError(
      503,
      "DocumentDB credentials are missing. Set DOCUMENTDB_USERNAME and " +
        "DOCUMENTDB_PASSWORD (or USERNAME / PASSWORD in .env). See .env.example.",
    );
  }

  client = new MongoClient(config.uri, config.mongoOptions);
  return client;
}

export function getDb(): Db {
  return getClient().db(config.dbName);
}

export function movies(): Collection<Movie> {
  return getDb().collection<Movie>(config.collection);
}

/** Untyped handle for the admin endpoints, which can target any collection. */
export function collection(name: string): Collection<Document> {
  return getDb().collection<Document>(name);
}

/**
 * Explicit connect, mirroring `await client.connect()` from the quick start.
 * If DocumentDB is not up yet we discard the client so the driver can lazily
 * reconnect on the first request, and let the HTTP server start anyway (so
 * GET /health can report the outage).
 */
export async function connect(): Promise<void> {
  const candidate = getClient();
  try {
    await candidate.connect();
    await candidate.db(config.dbName).command({ ping: 1 });
  } catch (error) {
    await candidate.close().catch(() => undefined);
    client = undefined;
    throw error;
  }
}

/** Runs `db.command({ ping: 1 })`, exactly as in the quick start. */
export function ping(): Promise<Document> {
  return getDb().command({ ping: 1 });
}

export async function close(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}
