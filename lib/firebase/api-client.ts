"use client";
import { getFirebaseServices } from "./client";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
/** Same-origin requests carry only a fresh identity token. The vault key never leaves the browser. */
export async function api(path: string, init: RequestInit = {}) {
  const user = getFirebaseServices().auth.currentUser;
  if (!user) throw new Error("Sign in again to continue.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + (await user.getIdToken()));
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
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
    throw new ApiError((data.error || "OVI is temporarily unavailable.") + reset, data.code || "unavailable");
  }
  return response;
}
export const jsonPost = (value: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
  signal,
});
