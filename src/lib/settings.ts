export function initialStoredBooleanSetting(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

export function initialNumberSetting(key: string, fallback: number, min: number, max: number) {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
  } catch {
    return fallback;
  }
}
