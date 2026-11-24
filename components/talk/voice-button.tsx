"use client";
/** The same compact control starts capture and requests a transcript. Cancellation invalidates any late async result. */
import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { recordVoice } from "@/lib/voice/recorder";
import { api } from "@/lib/firebase/api-client";

export function VoiceButton({
  disabled,
  insert,
  report,
  onBusy,
}: {
  disabled: boolean;
  insert: (text: string) => void;
  report: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const stop = useRef<() => Promise<Blob>>(null),
    operation = useRef<AbortController>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [],
  );
  function reset() {
    stop.current = null;
    operation.current = null;
    setPhase("idle");
    onBusy(false);
  }
  async function finish() {
    const current = operation.current,
      capture = stop.current;
    if (!current || !capture) return;
    stop.current = null;
    setPhase("transcribing");
    try {
      const body = await capture();
      const response = await api("/api/voice/transcribe", {
        method: "POST",
        body,
        headers: { "Content-Type": "audio/wav", "X-Request-Id": crypto.randomUUID() },
        signal: current.signal,
      });
      const { text } = await response.json();
      if (!current.signal.aborted) insert(text);
    } catch (error) {
      if (!current.signal.aborted)
        report(error instanceof Error ? error.message : "Transcription is unavailable.");
    } finally {
      if (operation.current === current) reset();
    }
  }
  async function start() {
    if (operation.current) return;
    const current = new AbortController();
    operation.current = current;
    setPhase("starting");
    onBusy(true);
    report("");
    try {
      const capture = await recordVoice(current.signal, () => void finish());
      if (!current.signal.aborted) {
        stop.current = capture;
        setPhase("recording");
      }
    } catch (error) {
      if (!current.signal.aborted) {
        report(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access was denied. You can still type to OVI."
            : "The microphone is unavailable. You can still type to OVI.",
        );
        reset();
      }
    }
  }
  const label =
    phase === "idle"
      ? "Record a voice message"
      : phase === "recording"
        ? "Stop and transcribe"
        : phase === "starting"
          ? "Opening microphone…"
          : "Transcribing…";
  return (
    <>
      <button
        type="button"
        className={"mic-button " + phase}
        title={label}
        aria-label={label}
        disabled={disabled || phase === "starting" || phase === "transcribing"}
        onClick={phase === "idle" ? start : finish}
      >
        {phase === "recording" ? <Square size={17} /> : <Mic size={20} />}
      </button>
      {phase !== "idle" && (
        <>
          <span role="status" className="voice-state">
            {phase === "recording" ? "Recording" : label}
          </span>
          <button
            type="button"
            className="mic-button"
            aria-label="Cancel voice message"
            onClick={() => {
              operation.current?.abort();
              reset();
            }}
          >
            <X size={15} />
          </button>
        </>
      )}
    </>
  );
}
