import cors from "cors";
import express from "express";
import chatRoutes from "./routes/chat.js";
import suggestionRoutes from "./routes/suggestions.js";
import transcribeRoutes from "./routes/transcribe.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "TwinMind backend is running."
  });
});

app.use("/api/transcribe", transcribeRoutes);
app.use("/api/suggestions", suggestionRoutes);
app.use("/api/chat", chatRoutes);

export default app;

