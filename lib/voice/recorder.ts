/** Manage microphone permission, audio capture, duration limits and release of the recording device on every exit. */
import { makeWav, maxSeconds, sampleRate } from "./wav";
export async function recordVoice(signal: AbortSignal, onLimit: () => void) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext)
    throw new Error("Recording is unavailable in this browser.");
  const context = new AudioContext({ sampleRate });
  let stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    if (context.state !== "closed") void context.close().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
    });
    signal.throwIfAborted();
    await context.audioWorklet.addModule("/ovi-microphone.js");
    signal.throwIfAborted();
    const source = context.createMediaStreamSource(stream),
      node = new AudioWorkletNode(context, "ovi-microphone", {
        channelCount: 1,
        channelCountMode: "explicit",
      });
    const silence = context.createGain();
    silence.gain.value = 0;
    source.connect(node).connect(silence).connect(context.destination);
    let length = 0;
    const chunks: Float32Array[] = [];
    let flushed!: () => void;
    const finished = new Promise<void>((r) => {
      flushed = r;
    });
    node.port.onmessage = ({ data }) => {
      if (data === null) {
        flushed();
        return;
      }
      if (length < sampleRate * maxSeconds) {
        chunks.push(data);
        length += data.length;
      }
    };
    timer = setTimeout(onLimit, maxSeconds * 1000);
    return async () => {
      clearTimeout(timer);
      node.port.postMessage("stop");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finished,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 500);
          }),
        ]);
        signal.throwIfAborted();
        if (!length) throw new Error("No audio was recorded.");
        return makeWav(chunks, length);
      } finally {
        clearTimeout(timeout);
        close();
        chunks.length = 0;
        signal.removeEventListener("abort", close);
      }
    };
  } catch (error) {
    close();
    signal.removeEventListener("abort", close);
    throw error;
  }
}
