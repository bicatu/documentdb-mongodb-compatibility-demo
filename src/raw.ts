import type { Response } from "express";
import { EJSON } from "bson";
import type { Document } from "mongodb";

export type EjsonMode = "relaxed" | "canonical";

/** Payload keys that hold results returned by the MongoDB driver. */
const DEFAULT_RAW_KEYS = ["documents", "result"];

export interface RawOptions {
  status?: number;
  mode?: EjsonMode;
  /** Override which payload keys are EJSON-encoded. */
  rawKeys?: string[];
}

/**
 * Sends the driver's results as MongoDB Extended JSON (EJSON) instead of
 * letting res.json() run plain JSON.stringify(). Plain JSON.stringify loses
 * BSON types: ObjectId becomes a bare hex string, Date becomes an ISO string,
 * Decimal128 becomes an opaque object. EJSON keeps them explicit:
 *
 *   ObjectId   -> { "$oid": "..." }
 *   Date       -> { "$date": "..." }
 *   Decimal128 -> { "$numberDecimal": "..." }
 *   Binary     -> { "$binary": { "base64": "...", "subType": "00" } }
 *
 * Only the driver results (the `documents` / `result` keys) are EJSON-encoded;
 * the surrounding metadata (count, tookMs, source, the echoed filter/options)
 * stays plain JSON so it is not misleadingly wrapped in $numberInt etc.
 *
 * `canonical` additionally exposes every numeric BSON type ($numberInt,
 * $numberDouble, $numberLong ...); `relaxed` (the default) stays readable.
 *
 * This is what "raw results" means here: no projection, no DTO shaping, no
 * field renaming, and the BSON types preserved.
 */
export function sendRaw(res: Response, payload: Document, options: RawOptions = {}): void {
  const relaxed = (options.mode ?? "relaxed") === "relaxed";
  const body: Document = { ...payload };

  for (const key of options.rawKeys ?? DEFAULT_RAW_KEYS) {
    if (body[key] !== undefined && body[key] !== null) {
      body[key] = EJSON.serialize(body[key], { relaxed });
    }
  }

  res.status(options.status ?? 200).json(body);
}
