import { Decimal128, Int32 } from "bson";
import type { Movie } from "./db.js";

/**
 * The three movies from the Node.js quick start, with extra fields and BSON
 * types added on purpose. The public /api/movies endpoint projects most of them
 * away; /admin/raw/* shows every field and the real BSON types.
 */
export function sampleMovies(): Movie[] {
  return [
    {
      title: "The Matrix",
      year: 1999,
      genres: ["sci-fi", "action"],
      director: "Lana Wachowski",
      rating: 8.7,
      runtimeMinutes: new Int32(136),
      boxOffice: { amount: Decimal128.fromString("463500000"), currency: "USD" },
      addedAt: new Date("2024-01-12T10:00:00Z"),
      internal: { source: "nodejs-quickstart", reviewed: false },
    },
    {
      title: "Dune",
      year: 2021,
      genres: ["sci-fi", "adventure"],
      director: "Denis Villeneuve",
      rating: 8.0,
      runtimeMinutes: new Int32(155),
      boxOffice: { amount: Decimal128.fromString("407600000"), currency: "USD" },
      addedAt: new Date("2024-01-12T10:00:05Z"),
      internal: { source: "nodejs-quickstart", reviewed: true },
    },
    {
      title: "Arrival",
      year: 2016,
      genres: ["sci-fi", "drama"],
      director: "Denis Villeneuve",
      rating: 7.9,
      runtimeMinutes: new Int32(116),
      boxOffice: { amount: Decimal128.fromString("203400000"), currency: "USD" },
      addedAt: new Date("2024-01-12T10:00:09Z"),
      internal: { source: "nodejs-quickstart", reviewed: false },
    },
  ];
}
