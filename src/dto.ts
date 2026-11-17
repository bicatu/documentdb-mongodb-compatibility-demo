import { ObjectId, type Document } from "mongodb";

/** The curated, application-facing representation of a movie. */
export interface MovieDTO {
  id: string;
  title: string;
  year: number;
  genres: string[];
}

/**
 * Shapes a stored document into the public DTO. Note what disappears here
 * compared to the raw document: `_id` becomes a flat `id` string, and
 * director / rating / runtimeMinutes / boxOffice / addedAt / internal are
 * dropped entirely. See /admin/raw/movies for the unshaped version.
 */
export function toMovieDTO(doc: Document): MovieDTO {
  return {
    id: doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id),
    title: String(doc.title),
    year: Number(doc.year),
    genres: Array.isArray(doc.genres) ? doc.genres.map(String) : [],
  };
}
