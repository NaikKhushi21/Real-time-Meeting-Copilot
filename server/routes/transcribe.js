import express from "express";
import multer from "multer";
import { transcribeAudio } from "../services/groqClient.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.post("/", upload.single("audio"), async (req, res) => {
  try {
    const { apiKey, model, audioMime } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: "Missing apiKey." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Missing audio file." });
    }
    console.log("[TwinMind][transcribe] chunk received", {
      size: req.file.size,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      declaredMime: audioMime || null
    });
    if (!req.file.size || req.file.size < 500) {
      console.warn("[TwinMind][transcribe] chunk too small, skipping");
      return res.json({ text: "" });
    }

    const text = await transcribeAudio({
      apiKey,
      model,
      audioBuffer: req.file.buffer,
      mimeType: audioMime || req.file.mimetype,
      fileName: req.file.originalname
    });

    return res.json({ text });
  } catch (error) {
    const message = String(error.message || "").toLowerCase();
    console.error("[TwinMind][transcribe] transcribe error", { error: error.message });
    // Recoverable media/container issues happen with fragmented chunks on some
    // browsers; treat these as empty chunks rather than surfacing a hard error.
    if (
      message.includes("could not process file") ||
      message.includes("valid media file") ||
      (message.includes("invalid_request_error") && message.includes("audio"))
    ) {
      return res.json({ text: "" });
    }
    return res.status(500).json({ error: error.message || "Transcription failed." });
  }
});

export default router;
