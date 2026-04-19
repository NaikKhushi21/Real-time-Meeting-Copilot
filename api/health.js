import { sendJson, sendMethodNotAllowed } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res, ["GET"]);
  }

  return sendJson(res, 200, {
    ok: true,
    message: "TwinMind backend is running."
  });
}
