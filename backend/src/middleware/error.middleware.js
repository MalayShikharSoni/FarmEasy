import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";

export const errorHandler = (err, req, res, next) => {
  // A malformed id such as /api/auctions/abc is the client's mistake, not a
  // server failure.
  if (err?.name === "CastError") {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: `Invalid ${err.path}` });
  }
  if (err?.name === "ValidationError") {
    const first = Object.values(err.errors ?? {})[0];
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: first?.message ?? "Invalid data" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Malformed JSON body" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(StatusCodes.REQUEST_TOO_LONG).json({ success: false, message: "Request body too large" });
  }

  const status = err?.statusCode || err?.status || StatusCodes.INTERNAL_SERVER_ERROR;
  if (status >= 500) console.error(err);

  // Internal error details stay in the server log, not in the response.
  const message =
    status >= 500 && env.nodeEnv === "production" ? "Something went wrong" : err?.message || "Something went wrong";
  res.status(status).json({ success: false, message });
};
