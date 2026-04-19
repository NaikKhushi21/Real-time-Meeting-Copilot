import multer from "multer";
import { transcribeAudio } from "./_lib/groq.js";
import { sendJson, sendMethodNotAllowed } from "./_lib/http.js";

const upload = multer({ storage: multer.memoryStorage() });

function runMiddleware(req, res, middleware) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (result) => {
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve(result);
    });
  });
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    // Parse multipart/form-data with audio file + model/api params.
    await runMiddleware(req, res, upload.single("audio"));

    const { apiKey, model, audioMime } = req.body || {};
    if (!apiKey) {
      return sendJson(res, 400, { error: "Missing apiKey." });
    }
    if (!req.file) {
      return sendJson(res, 400, { error: "Missing audio file." });
    }

    const mimeType = audioMime || req.file.mimetype || "audio/webm";
    console.log("[TwinMind][transcribe] chunk received", {
      size: req.file.size,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      declaredMime: audioMime || null
    });

    if (!req.file.size || req.file.size < 500) {
      console.warn("[TwinMind][transcribe] chunk too small, skipping");
      return sendJson(res, 200, { text: "" });
    }

    const audioBlob = new Blob([req.file.buffer], { type: mimeType });
    const text = await transcribeAudio({
      apiKey,
      model,
      file: audioBlob,
      mimeType
    });

    return sendJson(res, 200, { text });
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    console.error("[TwinMind][transcribe] transcribe error", {
      error: error?.message || "Unknown error"
    });

    if (
      message.includes("could not process file") ||
      message.includes("valid media file") ||
      (message.includes("invalid_request_error") && message.includes("audio"))
    ) {
      // Keep UI flowing when browser chunk/container is not decodable.
      return sendJson(res, 200, { text: "" });
    }

    return sendJson(res, 500, {
      error: error?.message || "Transcription failed."
    });
  }
}
