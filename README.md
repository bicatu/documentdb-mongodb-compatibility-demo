# DocumentDB ↔ MongoDB compatibility demo

A small **TypeScript + Express** web API that talks to a MongoDB-compatible
backend through the **official `mongodb` driver**, following the
[Node.js Quick Start](https://documentdb.io/docs/getting-started/nodejs-setup/).

It ships with two interchangeable local backends — **DocumentDB Local** and the
official **MongoDB 8** image — selected by a single `DB_BACKEND` flag. That is
the point of the demo: the application code is ordinary MongoDB code
(`MongoClient`, `insertOne`, `find`, `createIndex`, `db.command`, aggregation
pipelines), and **nothing in `src/` changes** when you flip the backend. Only
the endpoint (and its TLS setting) changes.

It exposes two layers:

| Layer | Prefix | What you get |
| --- | --- | --- |
| Application API | `/api/*` | Curated, shaped DTOs — what a real application would consume. Fields are projected away, `_id` becomes a flat `id`. |
| **Admin / raw API** | `/admin/raw/*` | **The raw results straight from the driver**: no projection, no DTO shaping, no field renaming, and BSON types preserved as MongoDB Extended JSON. |

---

## Quick start — see the switch

Both containers run side by side, so switching backends is a **restart**, not a
rebuild. You need Docker, Node 20.19+ and npm (§1); `jq` is optional and just
makes the output readable.

```bash
cp .env.example .env
docker compose --profile mongodb up -d   # starts BOTH: DocumentDB 10260 + MongoDB 27017
docker compose logs -f                  # wait for "=== DocumentDB is ready ===", then Ctrl-C
npm install
```

**Backend A — DocumentDB** (terminal 1):

```bash
DB_BACKEND=documentdb npm run dev
```

In terminal 2:

```bash
curl -s localhost:3000/health | jq                       # "backend": "documentdb"
curl -s -X POST localhost:3000/admin/seed | jq
curl -s 'localhost:3000/api/movies?minYear=2000' | jq
curl -s localhost:3000/admin/raw/build-info | jq        # "version": "7.0.0"
```

**Backend B — MongoDB.** Stop the app with Ctrl-C and start it again. The
**only** change is the flag:

```bash
DB_BACKEND=mongodb npm run dev
```

```bash
curl -s localhost:3000/health | jq                       # "backend": "mongodb"
curl -s -X POST localhost:3000/admin/seed | jq           # each backend has its own data
curl -s 'localhost:3000/api/movies?minYear=2000' | jq    # identical response shape
curl -s localhost:3000/admin/raw/build-info | jq         # "version": "8.3.17"
```

Same code, same endpoints, same response shapes. Sections 1–8 below are the
reference details.

---

## 1. Prerequisites

- Node.js **20.19+** (the current `mongodb` driver requires it) and npm
- Docker, for the local DocumentDB / MongoDB containers
- `jq` — used to pretty-print the curl examples (drop the `| jq` if unavailable)

## 2. Start the backends

`compose.yaml` defines two services. Both use the **same** `USERNAME` /
`PASSWORD` from `.env`, and both publish their port on loopback only.

```bash
cp .env.example .env      # edit USERNAME / PASSWORD if you like
```

**Both at once — recommended for this demo.** Lets you flip the flag without
ever starting or stopping containers:

```bash
docker compose --profile mongodb up -d
docker compose logs -f    # wait for "=== DocumentDB is ready ===", then Ctrl-C
```

> `docker ps` says "Up" before DocumentDB's gateway accepts connections. Wait
> for the readiness banner. For MongoDB, `docker compose logs mongodb` should
> show `Waiting for connections`.

Or start just one backend:

| Backend | Command | Port |
| --- | --- | --- |
| DocumentDB Local (quick-start equivalent, TLS on) | `docker compose up -d` | 10260 |
| MongoDB 8 Community Server (TLS off) | `docker compose --profile mongodb up -d mongodb` | 27017 |

## 3. Configure and run the API

```bash
npm install
npm run dev               # tsx watch, http://localhost:3000
```

Other scripts: `npm run build` (tsc → `dist/`), `npm start` (`node dist/server.js`,
run `npm run build` first), `npm run typecheck`.

### One flag switches backends

`DB_BACKEND` is the **only** thing you change. It selects a connection preset;
the database name, collection, queries, DTOs and raw endpoints are identical.

| `DB_BACKEND` | Endpoint | TLS | Backend |
| --- | --- | --- | --- |
| `documentdb` (default) | `mongodb://localhost:10260/` | on (local self-signed cert bypass) | DocumentDB Local |
| `mongodb` | `mongodb://localhost:27017/` | off | MongoDB 8 Community Server |

**How to switch:**

1. Start the backend(s) — `docker compose --profile mongodb up -d` runs both,
   so you can flip without ever restarting containers (§2).
2. Pick the backend with **any one** of these equivalent forms:

   | Form | Command / setting | Scope |
   | --- | --- | --- |
   | `.env` | `DB_BACKEND=mongodb` | every run |
   | shell env var | `DB_BACKEND=mongodb npm run dev` | one run |
   | CLI flag | `npm run dev -- --backend mongodb` | one run |

   Precedence is **CLI flag > shell env var > `.env` > default (`documentdb`)**.
   `dotenv` does not override variables already in the environment, so a shell
   value wins over `.env`. The CLI flag also accepts `--backend=mongodb`.
3. **Restart the app** — configuration is read once at startup.
4. Re-run `POST /admin/seed`: each backend has its own data.
5. Confirm with `GET /health` (reports `backend` and `endpoint`), `GET /` (the
   active preset plus both alternatives), and `GET /admin/raw/build-info`
   (`7.0.0` on DocumentDB vs the real MongoDB version, e.g. `8.3.17`).

For the built app, run `npm run build` first, then
`node dist/server.js --backend=mongodb` (or `DB_BACKEND=mongodb npm start`).

> Leave `DOCUMENTDB_URI` / `DOCUMENTDB_TLS` unset for the flag to be a true
> one-line switch. Setting `DOCUMENTDB_URI` pins the endpoint and overrides the
> preset regardless of `DB_BACKEND` (useful for a remote/custom instance).

The app reads `DOCUMENTDB_USERNAME` / `DOCUMENTDB_PASSWORD` — exactly as the
quick start exports them — and falls back to `USERNAME` / `PASSWORD` from the
same `.env` used by Docker Compose. If you prefer the quick start's literal
flow, skip `.env` and export in the shell instead:

```bash
export DOCUMENTDB_USERNAME='docdbadmin'
export DOCUMENTDB_PASSWORD='change-me'
```

### The connection (the MongoDB-compatible part)

`src/config.ts` builds the exact options from the quick start, with only the
URI/TLS values coming from the selected preset (simplified):

```ts
export const BACKEND_PRESETS = {
  documentdb: { uri: "mongodb://localhost:10260/", tls: true,  allowInvalidCerts: true,  authSource: "admin" },
  mongodb:    { uri: "mongodb://localhost:27017/", tls: false, allowInvalidCerts: false, authSource: "admin" },
};

const preset = BACKEND_PRESETS[backend]; // backend comes from DB_BACKEND
const options: MongoClientOptions = {
  auth: { username, password },
  authSource: preset.authSource,
  tls: preset.tls,
  tlsAllowInvalidCertificates: preset.allowInvalidCerts, // local self-signed cert, DEV ONLY
  directConnection: true,                                // single endpoint, not a replica set
};
const client = new MongoClient(preset.uri, options);
await client.connect();
await client.db("quickstart").command({ ping: 1 });
```

`tlsAllowInvalidCertificates` is for the self-signed certificate of a local
instance only. To validate the certificate instead, set
`DOCUMENTDB_TLS_CA_FILE=/absolute/path/documentdb-cert.pem` (the quick start
shows how to copy it out of the container). When that variable is set, the
app uses `tlsCAFile` and does **not** disable validation.

---

## 4. Application API (shaped results)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Endpoint index + active backend and both presets |
| `GET` | `/health` | Runs `db.command({ ping: 1 })`; reports the active backend, returns `503` if it is down |
| `GET` | `/api/movies` | Shaped list. Query params: `minYear`, `genre`, `sort` (`year`, `-year`, `title`, `-title`), `limit` |
| `GET` | `/api/movies/:id` | One shaped movie |
| `POST` | `/api/movies` | Insert (`{ "title", "year", "genres", "director?", "rating?" }`) |
| `DELETE` | `/api/movies/:id` | Delete |

```bash
curl -s 'localhost:3000/api/movies?minYear=2000&sort=-year' | jq
```

```json
{
  "data": [
    { "id": "65a1...", "title": "Dune",    "year": 2021, "genres": ["sci-fi", "adventure"] },
    { "id": "65a1...", "title": "Arrival", "year": 2016, "genres": ["sci-fi", "drama"] }
  ],
  "count": 2,
  "query": { "filter": { "year": { "$gte": 2000 } }, "sort": { "year": -1, "title": 1 }, "limit": 50 }
}
```

Only `id`, `title`, `year`, `genres` survive — the projection in
`src/routes/public.ts` hides `director`, `rating`, `runtimeMinutes`,
`boxOffice`, `addedAt` and `internal`. That is normal, healthy application
design, but it means you cannot see what the backend actually stored.

---

## 5. Admin API — raw results

`GET /admin` lists these endpoints. All responses are **MongoDB Extended JSON
(EJSON)**, produced by `EJSON.serialize(..., { relaxed })`, so BSON types are
explicit instead of being silently coerced by `JSON.stringify`:

| BSON type | Raw EJSON (`relaxed`) |
| --- | --- |
| `ObjectId` | `{ "$oid": "65a1..." }` |
| `Date` | `{ "$date": "2024-01-12T10:00:00Z" }` |
| `Decimal128` | `{ "$numberDecimal": "463500000" }` |
| `Binary` | `{ "$binary": { "base64": "...", "subType": "00" } }` |
| `Int32` / `Long` | `136` / `...` |

Append **`?ejson=canonical`** to any raw endpoint to expose every numeric BSON
type as well (`$numberInt`, `$numberDouble`, `$numberLong`, ...). Only the
driver results (`documents` / `result`) are EJSON-encoded; the surrounding
metadata (`count`, `tookMs`, echoed filter/options) stays plain JSON. This is
the closest you can get to the actual BSON on the wire over HTTP.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/admin/seed` | Replace the sample data + create the `{ title: 1 }` index |
| `GET` | `/admin/raw/movies` | **All stored documents, no projection** |
| `POST` | `/admin/raw/find` | `find(filter, options)` → raw documents |
| `POST` | `/admin/raw/aggregate` | `aggregate(pipeline)` → raw documents |
| `POST` | `/admin/raw/command` | `db.command(<body>)` → raw command result |
| `GET` | `/admin/raw/collections` | `db.listCollections().toArray()` raw |
| `GET` | `/admin/raw/indexes` | `listIndexes()` raw (`?collection=<name>`) |
| `GET` | `/admin/raw/build-info` | `db.command({ buildInfo: 1 })` raw |

### Shaped vs. raw — the whole point

```bash
curl -s 'localhost:3000/admin/raw/movies?limit=1' | jq
```

(output shown pretty-printed)

```json
{
  "source": "db.collection(\"movies\").find({}).limit(1).toArray()",
  "database": "quickstart",
  "collection": "movies",
  "count": 1,
  "limit": 1,
  "tookMs": 4,
  "note": "No projection and no DTO shaping: the stored BSON documents as MongoDB Extended JSON.",
  "documents": [
    {
      "_id": { "$oid": "65a1..." },
      "title": "The Matrix",
      "year": 1999,
      "genres": ["sci-fi", "action"],
      "director": "Lana Wachowski",
      "rating": 8.7,
      "runtimeMinutes": 136,
      "boxOffice": { "amount": { "$numberDecimal": "463500000" }, "currency": "USD" },
      "addedAt": { "$date": "2024-01-12T10:00:00Z" },
      "internal": { "source": "nodejs-quickstart", "reviewed": false }
    }
  ]
}
```

Compare with `GET /api/movies`: same collection, same driver, but the raw view
keeps `_id` as an EJSON `$oid`, keeps every hidden field, and keeps the
`Decimal128` / `Date` types.

### Run your own MongoDB operations

```bash
# find with a MongoDB filter, projection, sort, skip, limit
curl -s -X POST localhost:3000/admin/raw/find \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"year":{"$gte":2000},"genres":"sci-fi"},
       "projection":{"title":1,"year":1,"rating":1},
       "sort":{"year":-1},"limit":10}' | jq

# aggregation pipeline
curl -s -X POST localhost:3000/admin/raw/aggregate \
  -H 'Content-Type: application/json' \
  -d '{"pipeline":[{"$group":{"_id":"$year","titles":{"$push":"$title"}}},
                   {"$sort":{"_id":-1}}]}' | jq

# any MongoDB command, returned raw (this is the quick start's ping)
curl -s -X POST localhost:3000/admin/raw/command \
  -H 'Content-Type: application/json' \
  -d '{"ping":1}' | jq

curl -s -X POST localhost:3000/admin/raw/command \
  -H 'Content-Type: application/json' \
  -d '{"count":"movies"}' | jq

# canonical EJSON (all BSON numeric types visible)
curl -s 'localhost:3000/admin/raw/movies?ejson=canonical&limit=1' | jq
```

`GET /admin/raw/build-info` is a nice backend comparison: DocumentDB reports a
MongoDB-compatible `"7.0.0"`, while the `mongo:8` image reports its real
version (e.g. `"8.3.17"`, with a much larger build-environment document).
`GET /admin/raw/collections` also exposes the collection UUID as a BSON
`Binary` (`$binary`), which plain `JSON.stringify` would mangle.

Bodies for `/admin/raw/find` and `/admin/raw/aggregate` also accept an optional
`collection` name (defaults to `DOCUMENTDB_COLLECTION`). Responses are capped by
`RAW_DEFAULT_LIMIT` / `RAW_MAX_LIMIT`.

---

## 6. Admin security

> **These endpoints execute arbitrary MongoDB queries and commands. They are a
> debugging tool for a local demo — never expose them on a public network.**

- Set `ADMIN_TOKEN` in `.env` to require `X-Admin-Token: <token>` (or
  `Authorization: Bearer <token>`) on every `/admin/*` request.
- With `NODE_ENV=production` and **no** `ADMIN_TOKEN`, `/admin/*` is disabled
  entirely (returns `503`).
- Without a token in development, `/admin/*` is open and the server logs a
  warning at startup.
- `POST /admin/raw/command` is intentionally unrestricted within the demo;
  treat it like a direct database shell.

The TLS certificate bypass (`DOCUMENTDB_TLS_ALLOW_INVALID_CERTS=true`) is also
local-development-only. Use `DOCUMENTDB_TLS_CA_FILE` with a trusted certificate
for anything else, and see the quick start's network guidance before exposing
the gateway.

---

## 7. Project layout

```
compose.yaml            DocumentDB Local + MongoDB services (profile-gated)
.env.example            all configuration options, incl. DB_BACKEND
src/
  config.ts             DB_BACKEND presets + MongoClient options from the quick start
  db.ts                 lazy MongoClient, db/collection handles, connect + ping
  http.ts               HttpError, async handler wrapper, error middleware
  raw.ts                EJSON "raw results" serializer
  dto.ts                shaped application DTO
  seed-data.ts          the 3 quick-start movies (+ extra fields/BSON types)
  validation.ts         input parsing for both APIs
  routes/public.ts      /health, /api/movies  (shaped)
  routes/admin.ts       /admin/seed, /admin/raw/*  (raw)
  app.ts                Express app + endpoint index
  server.ts             connect, listen, graceful shutdown
```

## 8. Cleanup

```bash
docker compose --profile mongodb down   # stops/removes both containers
npm run build                          # optional: produce dist/ for `npm start`
```

Notes: DocumentDB implements the MongoDB wire protocol, so not every MongoDB
command or operator is available. The quick start's `ping`, `insertMany`,
`createIndex`, `find` and `db.command` are used here; if a raw command is
unsupported, its driver error is returned as a `502` with the driver's message.
Against the `mongodb` backend every command is a real MongoDB command. Both
containers are disposable demos with no mounted volumes, so `down` discards
the seeded data.
