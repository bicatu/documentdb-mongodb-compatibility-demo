import express from "express";
import { BACKEND_PRESETS, config } from "./config.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "DocumentDB Web API demo",
      description:
        "One TypeScript/Express application, runnable against DocumentDB or MongoDB via a single DB_BACKEND flag. /admin/raw/* returns unshaped results.",
      reference: "https://documentdb.io/docs/getting-started/nodejs-setup/",
      backend: {
        active: config.backend,
        endpoint: config.uri,
        database: config.dbName,
        collection: config.collection,
        credentialsConfigured: config.credentialsConfigured,
        presets: {
          documentdb: BACKEND_PRESETS.documentdb.uri,
          mongodb: BACKEND_PRESETS.mongodb.uri,
        },
        switchTo: "Set DB_BACKEND=documentdb|mongodb (or use `npm run dev -- --backend mongodb`) and restart. No code changes.",
      },
      endpoints: {
        "GET /health": "Ping DocumentDB.",
        "GET /api/movies": "Shaped movie list. Query: minYear, genre, sort, limit.",
        "GET /api/movies/:id": "One shaped movie.",
        "POST /api/movies": "Insert a movie (title, year, genres, director?, rating?).",
        "DELETE /api/movies/:id": "Delete a movie.",
        "GET /admin": "Admin endpoint index.",
        "POST /admin/seed": "Load the quick-start sample data.",
        "GET /admin/raw/movies": "RAW: all stored documents, no projection.",
        "POST /admin/raw/find": "RAW: arbitrary find(filter, options).",
        "POST /admin/raw/aggregate": "RAW: arbitrary aggregate(pipeline).",
        "POST /admin/raw/command": "RAW: arbitrary db.command(<body>).",
        "GET /admin/raw/collections": "RAW: listCollections().",
        "GET /admin/raw/indexes": "RAW: listIndexes().",
        "GET /admin/raw/build-info": "RAW: db.command({ buildInfo: 1 }).",
      },
      rawResults:
        "Raw endpoints return MongoDB Extended JSON (EJSON) so BSON types survive. Add ?ejson=canonical for full type detail.",
    });
  });

  app.use(publicRouter);
  app.use("/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
