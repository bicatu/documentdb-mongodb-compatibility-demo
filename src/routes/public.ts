import { Router } from "express";
import { config } from "../config.js";
import { movies, ping } from "../db.js";
import { toMovieDTO } from "../dto.js";
import { asyncRoute, HttpError } from "../http.js";
import { parseMovieInput, parseMovieQuery, parseObjectId } from "../validation.js";

/**
 * The application-facing API: curated DTOs, a projection that hides fields the
 * application does not expose, and friendly query parameters. This is what a
 * normal MongoDB-compatible application looks like.
 */
export const publicRouter = Router();

// The projection is the point of comparison with /admin/raw/movies: everything
// else in the stored document is deliberately invisible here.
const MOVIE_PROJECTION = { _id: 1, title: 1, year: 1, genres: 1 };

publicRouter.get(
  "/health",
  asyncRoute(async (_req, res) => {
    const started = Date.now();
    try {
      await ping(); // db.command({ ping: 1 }) from the quick start
      res.json({
        status: "ok",
        backend: config.backend,
        reachable: true,
        endpoint: config.uri,
        database: config.dbName,
        pingMs: Date.now() - started,
      });
    } catch (error) {
      res.status(503).json({
        status: "degraded",
        backend: config.backend,
        reachable: false,
        endpoint: config.uri,
        database: config.dbName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }),
);

publicRouter.get(
  "/api/movies",
  asyncRoute(async (req, res) => {
    const { filter, sort, limit } = parseMovieQuery(req.query);
    const documents = await movies()
      .find(filter, { projection: MOVIE_PROJECTION, sort, limit })
      .toArray();

    res.json({
      data: documents.map(toMovieDTO),
      count: documents.length,
      query: { filter, sort, limit },
    });
  }),
);

publicRouter.get(
  "/api/movies/:id",
  asyncRoute(async (req, res) => {
    const id = parseObjectId(String(req.params.id));
    const document = await movies().findOne({ _id: id }, { projection: MOVIE_PROJECTION });
    if (!document) throw new HttpError(404, `No movie with id ${req.params.id}`);
    res.json(toMovieDTO(document));
  }),
);

publicRouter.post(
  "/api/movies",
  asyncRoute(async (req, res) => {
    const input = parseMovieInput(req.body);
    const { insertedId } = await movies().insertOne({
      ...input,
      addedAt: new Date(),
      internal: { source: "api", reviewed: false },
    });
    const document = await movies().findOne({ _id: insertedId }, { projection: MOVIE_PROJECTION });
    res.status(201).json(toMovieDTO(document ?? { _id: insertedId, ...input }));
  }),
);

publicRouter.delete(
  "/api/movies/:id",
  asyncRoute(async (req, res) => {
    const id = parseObjectId(String(req.params.id));
    const result = await movies().deleteOne({ _id: id });
    res.json({ id: req.params.id, deletedCount: result.deletedCount });
  }),
);
