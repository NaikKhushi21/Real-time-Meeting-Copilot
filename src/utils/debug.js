function isEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const value = window.localStorage.getItem("twinmind_debug");
    if (value == null) {
      return false;
    }
    return value === "1" || value === "true";
  } catch (_error) {
    return false;
  }
}

function formatPrefix(scope) {
  return `[TwinMind][${scope}]`;
}

export function debugLog(scope, message, data) {
  if (!isEnabled()) {
    return;
  }
  if (data === undefined) {
    console.log(formatPrefix(scope), message);
    return;
  }
  console.log(formatPrefix(scope), message, data);
}

export function debugWarn(scope, message, data) {
  if (!isEnabled()) {
    return;
  }
  if (data === undefined) {
    console.warn(formatPrefix(scope), message);
    return;
  }
  console.warn(formatPrefix(scope), message, data);
}

export function debugError(scope, message, data) {
  if (!isEnabled()) {
    return;
  }
  if (data === undefined) {
    console.error(formatPrefix(scope), message);
    return;
  }
  console.error(formatPrefix(scope), message, data);
}
