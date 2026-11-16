import { StatusCodes } from "http-status-codes";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/user.model.js";

const readToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.split(" ")[1];
  return req.cookies?.accessToken;
};

export const requireAuth = async (req, res, next) => {
  try {
    const token = readToken(req);

    if (!token) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ success: false, message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, env.jwtAccessSecret);

    const user = await User.findById(decoded.sub);
    if (!user) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ success: false, message: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res
      .status(StatusCodes.UNAUTHORIZED)
      .json({ success: false, message: "Invalid or expired token" });
  }
};

/**
 * For public routes that show more to a logged-in user (for example, a farmer
 * viewing their own pending listing). Attaches req.user when a valid token is
 * present and never rejects the request.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (token) {
      const decoded = jwt.verify(token, env.jwtAccessSecret);
      req.user = (await User.findById(decoded.sub)) ?? undefined;
    }
  } catch {
    // An invalid or expired token on a public route just means "anonymous".
  }
  next();
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(StatusCodes.FORBIDDEN)
        .json({ success: false, message: "Forbidden" });
    }
    next();
  };
};
