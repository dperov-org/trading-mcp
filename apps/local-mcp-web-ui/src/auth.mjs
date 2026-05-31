import crypto from "node:crypto";

function nowMs() {
  return Date.now();
}

function parseCookieHeader(headerValue) {
  const cookies = new Map();
  const raw = String(headerValue || "");

  for (const part of raw.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    cookies.set(key, value);
  }

  return cookies;
}

function encodeCookieValue(value) {
  return encodeURIComponent(String(value));
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function signValue(secret, sessionId) {
  return crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("base64url");
}

function serializeCookie({
  name,
  value,
  maxAgeSeconds = null,
}) {
  const parts = [
    `${name}=${encodeCookieValue(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (maxAgeSeconds !== null) {
    parts.push(`Max-Age=${Math.max(0, Math.trunc(maxAgeSeconds))}`);
  }

  return parts.join("; ");
}

export class SessionAuth {
  constructor({
    mode,
    password,
    secret,
    cookieName,
    ttlMs,
    logger = null,
  }) {
    this.mode = mode;
    this.password = password;
    this.secret = secret;
    this.cookieName = cookieName;
    this.ttlMs = ttlMs;
    this.logger = logger;
    this.sessions = new Map();
  }

  get enabled() {
    return this.mode === "session";
  }

  #cookieValueForSession(sessionId) {
    return `${sessionId}.${signValue(this.secret, sessionId)}`;
  }

  #lookupSession(request) {
    if (!this.enabled) {
      return null;
    }

    this.clearExpiredSessions();

    const cookies = parseCookieHeader(request.headers.cookie);
    const rawCookie = cookies.get(this.cookieName);
    if (!rawCookie) {
      return null;
    }

    const decoded = decodeCookieValue(rawCookie);
    const separatorIndex = decoded.lastIndexOf(".");
    if (separatorIndex <= 0) {
      return null;
    }

    const sessionId = decoded.slice(0, separatorIndex);
    const signature = decoded.slice(separatorIndex + 1);
    const expectedSignature = signValue(this.secret, sessionId);
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      this.sessions.delete(sessionId);
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= nowMs()) {
      this.sessions.delete(sessionId);
      return null;
    }

    session.lastSeenAt = nowMs();
    return session;
  }

  clearExpiredSessions() {
    const currentTime = nowMs();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= currentTime) {
        this.sessions.delete(sessionId);
      }
    }
  }

  isAuthenticated(request) {
    if (!this.enabled) {
      return true;
    }

    return Boolean(this.#lookupSession(request));
  }

  getSession(request) {
    return this.#lookupSession(request);
  }

  authenticate(passwordAttempt) {
    if (!this.enabled) {
      return { ok: true, sessionId: null };
    }

    if (!this.password) {
      return {
        ok: false,
        error: "WEB_UI_SESSION_PASSWORD is not configured",
      };
    }

    const attempt = String(passwordAttempt || "");
    const expected = Buffer.from(this.password);
    const actual = Buffer.from(attempt);

    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      this.logger?.warn("auth", "login_failed", {
        reason: "invalid_password",
      });
      return {
        ok: false,
        error: "Invalid password",
      };
    }

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: nowMs(),
      lastSeenAt: nowMs(),
      expiresAt: nowMs() + this.ttlMs,
    });
    this.logger?.info("auth", "login_succeeded", {
      sessionId,
    });

    return {
      ok: true,
      sessionId,
    };
  }

  writeLoginCookie(response, sessionId) {
    const cookieValue = this.#cookieValueForSession(sessionId);
    response.setHeader(
      "set-cookie",
      serializeCookie({
        name: this.cookieName,
        value: cookieValue,
        maxAgeSeconds: Math.floor(this.ttlMs / 1000),
      }),
    );
  }

  writeLogoutCookie(response) {
    response.setHeader(
      "set-cookie",
      serializeCookie({
        name: this.cookieName,
        value: "",
        maxAgeSeconds: 0,
      }),
    );
  }
}
