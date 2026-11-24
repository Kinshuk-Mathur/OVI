"use client";
import { getFirebaseServices } from "./client";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
/** Netlify may return its own HTML error page before the API runs. Preserve the HTTP
 * status without rendering a proxy's HTML, stack traces, or provider response bodies. */
function transportError(status: number) {
  if (status === 401 || status === 403) return "The server denied this request. Sign in to OVI again.";
  if (status === 404 || status === 405) return "This deployment is missing the OVI API route.";
  if (status === 429) return "OVI is handling too many requests. Please try again shortly.";
  if (status === 504) return "The OVI server timed out. Please try again.";
  return "The OVI server could not complete the request.";
}

/** Same-origin requests carry only a fresh identity token. The vault key never leaves the browser. */
export async function api(path: string, init: RequestInit = {}) {
  const user = getFirebaseServices().auth.currentUser;
  if (!user) throw new Error("Sign in again to continue.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + (await user.getIdToken()));
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: "no-store" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError("Could not connect to OVI. Check your connection and try again.", "network");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (typeof data?.error !== "string" || !data.error.trim())
      throw new ApiError(transportError(response.status) + " (HTTP " + response.status + ")", "http", response.status);
    const reset =
      data.retryAt && ["voice_daily", "chat_daily", "photo_daily"].includes(data.code)
        ? " Resets at " +
          new Date(data.retryAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          }) +
          "."
        : "";
    throw new ApiError(data.error + reset, data.code || "unavailable", response.status);
  }
  if (response.headers.get("content-type")?.includes("text/html"))
    throw new ApiError("This deployment returned a web page for the OVI API route.", "route");
  return response;
}
export const jsonPost = (value: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
  signal,
});
