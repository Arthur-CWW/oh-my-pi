import { parseTwitterErrors } from "./capture-classifier.boundary";
import type { StopConditionInput, StopConditionResult } from "./capture-types";

/**
 * Classifies HTTP status, headers, body, or HTML to detect stop conditions
 * like security challenges, rate limits, or account lockouts.
 */
export function classifyStopCondition(input: StopConditionInput): StopConditionResult {
  const { status, headers, body, html } = input;

  // 1. Check HTTP Status code
  if (status === 429) {
    return { shouldStop: true, reason: "Rate limit exceeded (HTTP 429)." };
  }
  if (status === 401 || status === 403) {
    return { shouldStop: true, reason: `Authentication or access restriction (HTTP ${status}).` };
  }

  // 2. Check Rate Limit Headers
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (k === "x-rate-limit-remaining" && value === "0") {
      return { shouldStop: true, reason: "Rate limit remaining is 0." };
    }
    if (k === "retry-after" && value && parseInt(value, 10) > 0) {
      return { shouldStop: true, reason: `Rate limit hit (Retry-After: ${value}s).` };
    }
  }

  // 3. Check JSON / String Response Body
  if (body) {
    const parsedJson = parseTwitterErrors(body);
    if (parsedJson !== null) {
      for (const err of parsedJson.errors) {
        const code = err.code !== undefined ? Number(err.code) : NaN;
        const msg = String(err.message || "").toLowerCase();

        if (code === 88 || msg.includes("rate limit") || msg.includes("too many requests")) {
          return { shouldStop: true, reason: `Rate limit exceeded (Code 88): ${err.message}` };
        }
        if (code === 326 || msg.includes("lock") || msg.includes("verify your account")) {
          return {
            shouldStop: true,
            reason: `Account challenge or temporary lock (Code 326): ${err.message}`,
          };
        }
        if (
          msg.includes("challenge") ||
          msg.includes("captcha") ||
          msg.includes("robot") ||
          msg.includes("human")
        ) {
          return { shouldStop: true, reason: `Security challenge: ${err.message}` };
        }
        if (msg.includes("suspended") || msg.includes("banned") || msg.includes("deactivated")) {
          return { shouldStop: true, reason: `Account suspended or banned: ${err.message}` };
        }
      }
    } else {
      // Treat as plain text
      const text = body.toLowerCase();
      if (text.includes("rate limit") || text.includes("too many requests")) {
        return { shouldStop: true, reason: "Rate limit pattern detected in text body." };
      }
      if (
        text.includes("verify you are human") ||
        text.includes("challenge") ||
        text.includes("arkose") ||
        text.includes("captcha") ||
        text.includes("recaptcha")
      ) {
        return { shouldStop: true, reason: "Security challenge pattern detected in text body." };
      }
      if (text.includes("temporarily locked") || text.includes("account is locked")) {
        return { shouldStop: true, reason: "Account lock pattern detected in text body." };
      }
      if (text.includes("suspended") || text.includes("account has been suspended")) {
        return { shouldStop: true, reason: "Account suspension pattern detected in text body." };
      }
    }
  }

  // 4. Check HTML content
  if (html) {
    const text = html.toLowerCase();
    if (
      text.includes("verify you are human") ||
      text.includes("arkose") ||
      text.includes("recaptcha") ||
      text.includes("captcha") ||
      text.includes("challenge")
    ) {
      return { shouldStop: true, reason: "Security challenge detected in HTML." };
    }
    if (text.includes("rate limit") || text.includes("too many requests") || text.includes("retry-after")) {
      return { shouldStop: true, reason: "Rate limit message detected in HTML." };
    }
    if (
      text.includes("temporarily locked") ||
      text.includes("account is locked") ||
      text.includes("verify your account")
    ) {
      return { shouldStop: true, reason: "Account lock message detected in HTML." };
    }
    if (text.includes("account has been suspended") || text.includes("account is suspended")) {
      return { shouldStop: true, reason: "Account suspension message detected in HTML." };
    }
    if (text.includes("/i/flow/login") || text.includes("log in to x") || text.includes("log in to twitter")) {
      return { shouldStop: true, reason: "Redirected to login flow." };
    }
  }

  return { shouldStop: false };
}
