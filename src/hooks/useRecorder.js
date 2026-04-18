import { useCallback, useEffect, useRef, useState } from "react";
import { debugError, debugLog, debugWarn } from "../utils/debug";

function pickMimeType() {
  if (MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")) {
    return "audio/mp4;codecs=mp4a.40.2";
  }
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
    return "audio/ogg;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  return "";
}

export function useRecorder({ chunkMs, firstChunkMs = chunkMs, onChunk }) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState("");

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const partsRef = useRef([]);
  const queueRef = useRef(Promise.resolve());
  const segmentTimerRef = useRef(null);
  const segmentStartRef = useRef(null);
  const stopReasonRef = useRef("");
  const stopPromiseRef = useRef(null);
  const segmentResolveRef = useRef(null);
  const isStoppingRef = useRef(false);

  const enqueueChunk = useCallback(
    async (blob, reason, windowStart, endedAt) => {
      const durationMs = Math.max(0, endedAt.getTime() - windowStart.getTime());

      if (durationMs < 900) {
        debugWarn("recorder", "Skipping too-short audio window", {
          reason,
          durationMs,
          size: blob?.size || 0
        });
        return;
      }

      if (!blob?.size || blob.size < 500) {
        debugWarn("recorder", "Skipping too-small chunk", {
          reason,
          size: blob?.size || 0
        });
        return;
      }

      debugLog("recorder", "Flushing chunk", {
        reason,
        mimeType: blob.type || recorderRef.current?.mimeType || "audio/webm",
        size: blob.size,
        durationMs
      });

      await onChunk(blob, {
        reason,
        windowStartIso: windowStart.toISOString(),
        windowEndIso: endedAt.toISOString()
      });
    },
    [chunkMs, onChunk]
  );

  const stopCurrentSegment = useCallback(async (reason = "manual") => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }
    if (stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    clearTimeout(segmentTimerRef.current);
    segmentTimerRef.current = null;
    stopReasonRef.current = reason;
    stopPromiseRef.current = new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        if (segmentResolveRef.current) {
          segmentResolveRef.current = null;
          stopPromiseRef.current = null;
          resolve();
        }
      }, 3000);

      segmentResolveRef.current = () => {
        clearTimeout(timeoutId);
        segmentResolveRef.current = null;
        stopPromiseRef.current = null;
        resolve();
      };

      try {
        recorder.stop();
      } catch (flushError) {
        segmentResolveRef.current = null;
        stopPromiseRef.current = null;
        debugError("recorder", "stop segment failed", {
          error: flushError.message,
          reason
        });
        resolve();
      }
    });

    return stopPromiseRef.current;
  }, []);

  const startSegment = useCallback(
    (durationMs) => {
      const stream = streamRef.current;
      if (!stream) {
        return;
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      partsRef.current = [];
      segmentStartRef.current = new Date();
      stopReasonRef.current = "";

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data?.size) {
          return;
        }
        partsRef.current.push(event.data);
        debugLog("recorder", "dataavailable", {
          size: event.data.size,
          mimeType: event.data.type
        });
      });

      recorder.addEventListener("stop", () => {
        const endedAt = new Date();
        const reason = stopReasonRef.current || "interval";
        const windowStart = segmentStartRef.current || new Date(endedAt.getTime() - chunkMs);
        const blob = new Blob(partsRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm"
        });
        partsRef.current = [];

        debugLog("recorder", "segment stopped", {
          reason,
          size: blob.size
        });

        queueRef.current = queueRef.current
          .catch(() => undefined)
          .then(() => enqueueChunk(blob, reason, windowStart, endedAt))
          .catch((chunkError) => {
            debugError("recorder", "Chunk handler failed", {
              reason,
              error: chunkError.message
            });
          })
          .finally(() => {
            if (segmentResolveRef.current) {
              segmentResolveRef.current();
            }
            if (!isStoppingRef.current && streamRef.current) {
              startSegment(chunkMs);
            }
          });
      });

      recorder.start();
      debugLog("recorder", "segment started", {
        mimeType: recorder.mimeType || mimeType || "default",
        durationMs
      });
      segmentTimerRef.current = setTimeout(() => {
        stopCurrentSegment("interval");
      }, durationMs);
    },
    [chunkMs, enqueueChunk, stopCurrentSegment]
  );

  const flushChunk = useCallback(async (reason = "manual") => {
    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      return;
    }
    await stopCurrentSegment(reason);
  }, [stopCurrentSegment]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || !streamRef.current) {
      return;
    }

    try {
      if (recorder.state === "recording") {
        isStoppingRef.current = true;
        await stopCurrentSegment("stop");
        await queueRef.current.catch(() => undefined);
      }
    } finally {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      recorderRef.current = null;
      isStoppingRef.current = false;
      segmentStartRef.current = null;
      stopReasonRef.current = "";
      stopPromiseRef.current = null;
      segmentResolveRef.current = null;
      setIsRecording(false);
    }
  }, [stopCurrentSegment]);

  const start = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      debugLog("recorder", "Mic stream started", {
        chunkMs,
        firstChunkMs,
        mode: "segmented"
      });

      streamRef.current = stream;
      isStoppingRef.current = false;
      const initialDurationMs =
        firstChunkMs > 0 && firstChunkMs < chunkMs ? firstChunkMs : chunkMs;
      startSegment(initialDurationMs);
      setIsRecording(true);
    } catch (startError) {
      debugError("recorder", "Could not start microphone", {
        error: startError.message
      });
      setError(startError.message || "Could not start microphone.");
      setIsRecording(false);
    }
  }, [chunkMs, firstChunkMs, startSegment]);

  useEffect(() => {
    return () => {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      recorderRef.current = null;
      streamRef.current = null;
      partsRef.current = [];
      segmentStartRef.current = null;
      stopReasonRef.current = "";
      stopPromiseRef.current = null;
      segmentResolveRef.current = null;
    };
  }, []);

  return {
    isRecording,
    error,
    start,
    stop,
    flushChunk
  };
}
