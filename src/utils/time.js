export function formatTime(dateLike) {
  const date = new Date(dateLike);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function nowIso() {
  return new Date().toISOString();
}
