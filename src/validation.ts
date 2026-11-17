import type { Request } from "express";
import { ObjectId, type Document, type Sort } from "mongodb";
import { config } from "./config.js";
import { HttpError } from "./http.js";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new HttpError(400, `${name} must be a JSON object`);
  }
  return value;
}

export function parseObjectId(value: string): ObjectId {
  if (!/^[a-fA-F0-9]{24}$/.test(value) || !ObjectId.isValid(value)) {
    throw new HttpError(400, "Invalid id: expected a 24-character hex ObjectId");
  }
  return new ObjectId(value);
}

export function parseLimit(value: unknown, fallback: number, max = config.rawMaxLimit): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "limit must be a positive integer");
  }
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, `${name} must be a non-negative integer`);
  }
  return parsed;
}

const COLLECTION_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function parseCollectionName(value: unknown): string {
  if (value === undefined || value === null || value === "") return config.collection;
  if (typeof value !== "string" || value.length > 120 || !COLLECTION_NAME.test(value)) {
    throw new HttpError(400, "collection must be a valid MongoDB collection name");
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Public API input                                                            */
/* -------------------------------------------------------------------------- */

export interface MovieQuery {
  filter: Document;
  sort: Sort;
  limit: number;
}

export function parseMovieQuery(query: Request["query"]): MovieQuery {
  const filter: Document = {};

  if (query.minYear !== undefined) {
    const minYear = Number.parseInt(String(query.minYear), 10);
    if (!Number.isInteger(minYear)) throw new HttpError(400, "minYear must be an integer");
    filter.year = { $gte: minYear };
  }
  if (typeof query.genre === "string" && query.genre.trim() !== "") {
    filter.genres = query.genre.trim();
  }

  const sortParam = typeof query.sort === "string" ? query.sort : "-year";
  return {
    filter,
    sort: parseSortParam(sortParam),
    limit: parseLimit(query.limit, 50, 200),
  };
}

function parseSortParam(value: string): Sort {
  const allowed = ["year", "-year", "title", "-title"];
  if (!allowed.includes(value)) {
    throw new HttpError(400, `sort must be one of: ${allowed.join(", ")}`);
  }
  const field = value.replace(/^-/, "");
  const direction = value.startsWith("-") ? -1 : 1;
  return { [field]: direction, ...(field === "year" ? { title: 1 } : {}) } as Sort;
}

export interface NewMovie extends Document {
  title: string;
  year: number;
  genres: string[];
  director?: string;
  rating?: number;
}

export function parseMovieInput(body: unknown): NewMovie {
  const b = requireObject(body, "Request body");

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) throw new HttpError(400, "title is required and must be a non-empty string");

  const year = typeof b.year === "number" ? b.year : Number(b.year);
  if (!Number.isInteger(year) || year < 1888 || year > 2200) {
    throw new HttpError(400, "year must be an integer between 1888 and 2200");
  }

  let genres: string[] = [];
  if (b.genres !== undefined) {
    if (!Array.isArray(b.genres) || !b.genres.every((g) => typeof g === "string" && g.trim() !== "")) {
      throw new HttpError(400, "genres must be an array of non-empty strings");
    }
    genres = (b.genres as string[]).map((g) => g.trim());
  }

  const movie: NewMovie = { title, year, genres };

  if (b.director !== undefined) {
    if (typeof b.director !== "string") throw new HttpError(400, "director must be a string");
    movie.director = b.director.trim();
  }
  if (b.rating !== undefined) {
    if (typeof b.rating !== "number" || b.rating < 0 || b.rating > 10) {
      throw new HttpError(400, "rating must be a number between 0 and 10");
    }
    movie.rating = b.rating;
  }
  return movie;
}

/* -------------------------------------------------------------------------- */
/* Admin / raw API input                                                       */
/* -------------------------------------------------------------------------- */

export interface RawFindSpec {
  collection: string;
  filter: Document;
  projection: Document | undefined;
  sort: Sort | undefined;
  skip: number | undefined;
  limit: number;
}

export function parseRawFind(body: unknown): RawFindSpec {
  const b = body === undefined ? {} : requireObject(body, "Request body");
  return {
    collection: parseCollectionName(b.collection),
    filter: b.filter === undefined ? {} : requireObject(b.filter, "filter"),
    projection: b.projection === undefined ? undefined : requireObject(b.projection, "projection"),
    sort: b.sort === undefined ? undefined : parseSortObject(b.sort),
    skip: parseNonNegativeInt(b.skip, "skip"),
    limit: parseLimit(b.limit, config.rawDefaultLimit),
  };
}

function parseSortObject(value: unknown): Sort {
  const sort = requireObject(value, "sort");
  for (const direction of Object.values(sort)) {
    if (direction !== 1 && direction !== -1 && direction !== "asc" && direction !== "desc") {
      throw new HttpError(400, "sort values must be 1 / -1 / 'asc' / 'desc'");
    }
  }
  return sort as Sort;
}

export interface RawAggregateSpec {
  collection: string;
  pipeline: Document[];
}

export function parseRawAggregate(body: unknown): RawAggregateSpec {
  const b = requireObject(body, "Request body");
  if (!Array.isArray(b.pipeline)) {
    throw new HttpError(400, "pipeline must be an array of aggregation stages");
  }
  if (b.pipeline.length > 50) {
    throw new HttpError(400, "pipeline is too long (maximum 50 stages)");
  }
  const pipeline = b.pipeline.map((stage, index) => requireObject(stage, `pipeline[${index}]`));
  return { collection: parseCollectionName(b.collection), pipeline };
}

/** A raw MongoDB command document, passed straight to db.command(). */
export function parseRawCommand(body: unknown): Document {
  const command = requireObject(body, "Request body");
  const keys = Object.keys(command);
  if (keys.length === 0) {
    throw new HttpError(400, "command must be a non-empty JSON object");
  }
  for (const key of keys) {
    if (key.startsWith("$")) {
      throw new HttpError(400, `command keys must not start with '$' (got '${key}')`);
    }
  }
  return command;
}
