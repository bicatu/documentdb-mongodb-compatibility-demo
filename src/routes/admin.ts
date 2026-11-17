import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { config } from "../config.js";
import { collection, getDb, movies } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { sendRaw, type EjsonMode } from "../raw.js";
import { sampleMovies } from "../seed-data.js";
import {
  parseCollectionName,
  parseLimit,
  parseRawAggregate,
  parseRawCommand,
  parseRawFind,
} from "../validation.js";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(header: string | undefined): string | undefined {
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/**
 * Admin guard. Locally the endpoints are open so the demo is easy to explore.
 * Set ADMIN_TOKEN to require `X-Admin-Token: <token>` (or a Bearer token); in
 * production the endpoints are disabled entirely unless a token is configured.
 *
 * These endpoints execute arbitrary MongoDB commands/queries. Never expose
 * them on a public network.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (config.isProduction && !config.adminToken) {
    next(new HttpError(503, "Admin endpoints are disabled in production without ADMIN_TOKEN"));
    return;
  }
  if (!config.adminToken) {
    next();
    return;
  }
  const provided = req.get("x-admin-token") ?? bearer(req.get("authorization"));
  if (!provided || !safeEqual(provided, config.adminToken)) {
    next(new HttpError(401, "Missing or invalid admin token. Send X-Admin-Token: <ADMIN_TOKEN>"));
    return;
  }
  next();
}

function rawMode(req: Request): EjsonMode {
  return req.query.ejson === "canonical" ? "canonical" : "relaxed";
}

function tookMs(started: number): number {
  return Date.now() - started;
}

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get("/", (_req, res) => {
  res.json({
    description:
      "Admin/debug endpoints that return the raw results straight from the MongoDB driver, with no DTO shaping and no projection.",
    warning:
      "These execute arbitrary queries and commands. Local development only - never expose this router publicly.",
    authentication: config.adminToken
      ? "ADMIN_TOKEN is set: send X-Admin-Token or Authorization: Bearer <token>."
      : "ADMIN_TOKEN is not set: open in local development. In production these routes are disabled.",
    ejson:
      "Responses are MongoDB Extended JSON (EJSON). Append ?ejson=canonical to expose every numeric BSON type ($numberInt, $numberDouble, $numberLong ...).",
    endpoints: {
      "POST /admin/seed": "Replace the sample data and create the { title: 1 } index.",
      "GET /admin/raw/movies": "All stored documents, no projection, no shaping.",
      "POST /admin/raw/find": "Run find(filter, options) and return the raw documents.",
      "POST /admin/raw/aggregate": "Run aggregate(pipeline) and return the raw documents.",
      "POST /admin/raw/command": "Run db.command(<body>) and return the raw command result.",
      "GET /admin/raw/collections": "db.listCollections().toArray() raw.",
      "GET /admin/raw/indexes": "listIndexes() raw (?collection=<name>).",
      "GET /admin/raw/build-info": "db.command({ buildInfo: 1 }) raw.",
    },
  });
});

adminRouter.post(
  "/seed",
  asyncRoute(async (_req, res) => {
    const started = Date.now();
    const handle = movies();
    await handle.deleteMany({});
    const documents = sampleMovies();
    await handle.insertMany(documents);
    await handle.createIndex({ title: 1 });
    res.json({
      status: "seeded",
      database: config.dbName,
      collection: config.collection,
      inserted: documents.length,
      index: { title: 1 },
      tookMs: tookMs(started),
    });
  }),
);

adminRouter.get(
  "/raw/movies",
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const limit = parseLimit(req.query.limit, config.rawDefaultLimit);
    const documents = await collection(config.collection).find({}).limit(limit).toArray();

    sendRaw(
      res,
      {
        source: `db.collection("${config.collection}").find({}).limit(${limit}).toArray()`,
        database: config.dbName,
        collection: config.collection,
        count: documents.length,
        limit,
        tookMs: tookMs(started),
        note: "No projection and no DTO shaping: the stored BSON documents as MongoDB Extended JSON.",
        documents,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.post(
  "/raw/find",
  asyncRoute(async (req, res) => {
    const spec = parseRawFind(req.body);
    const started = Date.now();
    const documents = await collection(spec.collection)
      .find(spec.filter, {
        ...(spec.projection ? { projection: spec.projection } : {}),
        ...(spec.sort ? { sort: spec.sort } : {}),
        ...(spec.skip !== undefined ? { skip: spec.skip } : {}),
        limit: spec.limit,
      })
      .toArray();

    sendRaw(
      res,
      {
        source: "db.collection(name).find(filter, options).toArray()",
        database: config.dbName,
        collection: spec.collection,
        filter: spec.filter,
        options: {
          projection: spec.projection ?? null,
          sort: spec.sort ?? null,
          skip: spec.skip ?? null,
          limit: spec.limit,
        },
        count: documents.length,
        tookMs: tookMs(started),
        documents,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.post(
  "/raw/aggregate",
  asyncRoute(async (req, res) => {
    const spec = parseRawAggregate(req.body);
    const started = Date.now();
    const documents = await collection(spec.collection).aggregate(spec.pipeline).toArray();

    sendRaw(
      res,
      {
        source: "db.collection(name).aggregate(pipeline).toArray()",
        database: config.dbName,
        collection: spec.collection,
        pipeline: spec.pipeline,
        count: documents.length,
        tookMs: tookMs(started),
        documents,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.post(
  "/raw/command",
  asyncRoute(async (req, res) => {
    const command = parseRawCommand(req.body);
    const started = Date.now();
    const result = await getDb().command(command);

    sendRaw(
      res,
      {
        source: "db.command(command)",
        database: config.dbName,
        command,
        tookMs: tookMs(started),
        result,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.get(
  "/raw/collections",
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const documents = await getDb().listCollections().toArray();

    sendRaw(
      res,
      {
        source: "db.listCollections().toArray()",
        database: config.dbName,
        count: documents.length,
        tookMs: tookMs(started),
        documents,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.get(
  "/raw/indexes",
  asyncRoute(async (req, res) => {
    const name = parseCollectionName(req.query.collection);
    const started = Date.now();
    const documents = await collection(name).listIndexes().toArray();

    sendRaw(
      res,
      {
        source: `db.collection("${name}").listIndexes().toArray()`,
        database: config.dbName,
        collection: name,
        count: documents.length,
        tookMs: tookMs(started),
        documents,
      },
      { mode: rawMode(req) },
    );
  }),
);

adminRouter.get(
  "/raw/build-info",
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const result = await getDb().command({ buildInfo: 1 });

    sendRaw(
      res,
      {
        source: "db.command({ buildInfo: 1 })",
        database: config.dbName,
        tookMs: tookMs(started),
        result,
      },
      { mode: rawMode(req) },
    );
  }),
);
