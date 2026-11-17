import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { MongoError, MongoNetworkError, MongoServerSelectionError } from "mongodb";

/** An error with an intentional HTTP status, thrown from routes/validation. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Forwards rejected promises from async handlers to Express' error middleware. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isConnectivityError(err: unknown): boolean {
  if (err instanceof MongoServerSelectionError || err instanceof MongoNetworkError) return true;
  if (err instanceof MongoError) {
    return /server selection|timed out|timeout|ECONNREFUSED|ENOTFOUND|connect ECONN/i.test(err.message);
  }
  return false;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let message = "Internal Server Error";
  let details: unknown;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (
    err !== null &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status?: unknown }).status === 400
  ) {
    // express.json() failed to parse the body
    status = 400;
    message = "Malformed JSON request body";
    details = errorMessage(err);
  } else if (isConnectivityError(err)) {
    status = 503;
    message = "DocumentDB is unreachable. Is the local instance running on port 10260?";
    details = errorMessage(err);
  } else if (err instanceof MongoError) {
    status = 502;
    message = "DocumentDB rejected the operation";
    details = `${err.name}: ${err.message}`;
  } else {
    message = errorMessage(err);
  }

  // Keep the log concise: a 502 here is usually an unsupported command or a
  // bad query supplied by the caller, not an unexpected server failure.
  if (status >= 500) console.error(`[error] ${status}: ${errorMessage(err)}`);
  res.status(status).json({ error: message, ...(details === undefined ? {} : { details }) });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: `No route for ${req.method} ${req.originalUrl}`,
    hint: "GET / for the endpoint list",
  });
};
