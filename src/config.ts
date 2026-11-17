import "dotenv/config";
import type { MongoClientOptions } from "mongodb";

/**
 * Configuration for the connection and the HTTP API.
 *
 * The app can point at either DocumentDB Local or the official MongoDB image.
 * The ONLY difference is the connection preset below - every driver call, DTO
 * and route is shared verbatim. That is the point of this demo.
 *
 * The Node.js quick start (https://documentdb.io/docs/getting-started/nodejs-setup/)
 * exports DOCUMENTDB_USERNAME / DOCUMENTDB_PASSWORD in the shell. Docker Compose
 * uses USERNAME / PASSWORD for BOTH services, so both spellings are accepted:
 * DOCUMENTDB_* wins when present, USERNAME/PASSWORD is the fallback.
 */
const env = process.env;

function read(name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** Allows `npm run dev -- --backend mongodb` / `node dist/server.js --backend=mongodb`. */
function readArg(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readBool(name: string, fallback: boolean): boolean {
  const value = read(name)?.toLowerCase();
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function readInt(name: string, fallback: number): number {
  const value = read(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type Backend = "documentdb" | "mongodb";

export interface BackendPreset {
  uri: string;
  tls: boolean;
  allowInvalidCerts: boolean;
  authSource: string;
}

/**
 * Backend presets. Everything else (database name, collection, queries, DTOs,
 * raw endpoints) is identical. `directConnection: true` applies to both, since
 * each local backend is a single endpoint rather than a replica set.
 */
export const BACKEND_PRESETS: Record<Backend, BackendPreset> = {
  documentdb: {
    uri: "mongodb://localhost:10260/",
    tls: true, // gateway uses TLS
    allowInvalidCerts: true, // self-signed certificate, LOCAL DEVELOPMENT ONLY
    authSource: "admin",
  },
  mongodb: {
    uri: "mongodb://localhost:27017/",
    tls: false, // official mongo image has TLS disabled by default
    allowInvalidCerts: false,
    authSource: "admin", // MONGO_INITDB_ROOT_* creates the user in admin
  },
};

function parseBackend(value: string | undefined): Backend {
  if (value === undefined) return "documentdb";
  switch (value.toLowerCase().trim()) {
    case "documentdb":
    case "docdb":
      return "documentdb";
    case "mongodb":
    case "mongo":
      return "mongodb";
    default:
      throw new Error(`DB_BACKEND must be "documentdb" or "mongodb" (got "${value}")`);
  }
}

/** CLI flag wins over .env, which wins over the default. */
const backend = parseBackend(readArg("backend") ?? read("DB_BACKEND"));
const preset = BACKEND_PRESETS[backend];

const username = read("DOCUMENTDB_USERNAME") ?? read("USERNAME");
const password = read("DOCUMENTDB_PASSWORD") ?? read("PASSWORD");
const caFile = read("DOCUMENTDB_TLS_CA_FILE");

/*
 * Explicit overrides are optional. Leave DOCUMENTDB_URI / DOCUMENTDB_TLS unset
 * so that flipping DB_BACKEND alone is enough. Setting DOCUMENTDB_URI pins the
 * endpoint regardless of the flag (useful for a remote/custom instance).
 */
const uri = read("DOCUMENTDB_URI") ?? preset.uri;
const dbName = read("DOCUMENTDB_DB") ?? "quickstart";
const collectionName = read("DOCUMENTDB_COLLECTION") ?? "movies";
const authSource = read("DOCUMENTDB_AUTH_SOURCE") ?? preset.authSource;
const tlsEnabled = readBool("DOCUMENTDB_TLS", preset.tls);
const allowInvalidCerts = readBool("DOCUMENTDB_TLS_ALLOW_INVALID_CERTS", preset.allowInvalidCerts);

/**
 * Builds the driver options. `directConnection` is required because both local
 * backends are single endpoints the driver cannot auto-discover as a replica
 * set. TLS is on with `tlsAllowInvalidCertificates` only for DocumentDB's local
 * self-signed certificate; set DOCUMENTDB_TLS_CA_FILE to validate it instead.
 */
function buildMongoOptions(): MongoClientOptions {
  if (!username || !password) return {};

  const options: MongoClientOptions = {
    auth: { username, password },
    authSource,
    tls: tlsEnabled,
    directConnection: true,
    connectTimeoutMS: 5_000,
    serverSelectionTimeoutMS: 5_000,
  };

  if (tlsEnabled) {
    if (caFile) {
      options.tlsCAFile = caFile;
    } else if (allowInvalidCerts) {
      // Local development only. See the security note in the README.
      options.tlsAllowInvalidCertificates = true;
    }
  }

  return options;
}

export interface AppConfig {
  backend: Backend;
  uri: string;
  dbName: string;
  collection: string;
  port: number;
  adminToken: string | undefined;
  isProduction: boolean;
  rawDefaultLimit: number;
  rawMaxLimit: number;
  credentialsConfigured: boolean;
  mongoOptions: MongoClientOptions;
}

export const config: AppConfig = {
  backend,
  uri,
  dbName,
  collection: collectionName,
  port: readInt("PORT", 3000),
  adminToken: read("ADMIN_TOKEN"),
  isProduction: read("NODE_ENV") === "production",
  rawDefaultLimit: readInt("RAW_DEFAULT_LIMIT", 100),
  rawMaxLimit: readInt("RAW_MAX_LIMIT", 1000),
  credentialsConfigured: Boolean(username && password),
  mongoOptions: buildMongoOptions(),
};
