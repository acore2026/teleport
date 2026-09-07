import React from "react";
import type { DesktopShortcuts } from "../types";

function platformShortcutModifier() {
  if (typeof navigator === "undefined") return "Control";
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS|macOS/i.test(userAgent) ? "Command" : "Control";
}

export function desktopShortcutDefaults(): DesktopShortcuts {
  const modifier = platformShortcutModifier();
  return {
    openPanel: `${modifier}+Alt+P`,
    copy: `${modifier}+Shift+C`,
    paste: `${modifier}+Shift+V`,
  };
}

export function normalizeShortcut(value: string, fallback: string) {
  const shortcut = value.trim();
  if (!shortcut) return fallback;
  if (!shortcut.includes("+")) {
    throw new Error(`Shortcut must include at least one modifier, for example ${fallback}.`);
  }
  return shortcut;
}

export function displayShortcut(value: string) {
  return value
    .split("+")
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      if (["control", "ctrl"].includes(normalized)) return "Ctrl";
      if (["command", "cmd", "meta", "super"].includes(normalized))
        return platformShortcutModifier() === "Command" ? "⌘" : "Ctrl";
      if (normalized === "shift") return "Shift";
      if (normalized === "alt" || normalized === "option")
        return platformShortcutModifier() === "Command" ? "Option" : "Alt";
      if (normalized === "space") return "Space";
      return part.trim();
    })
    .filter(Boolean)
    .join(" + ");
}

export function shortcutFromKeyboardEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = shortcutKeyFromEvent(event);
  if (!key) return "";

  const modifier = platformShortcutModifier();
  const parts: string[] = [];
  if (modifier === "Command" ? event.metaKey : event.ctrlKey) parts.push(modifier);
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (modifier === "Command" && event.ctrlKey) parts.push("Control");
  if (modifier === "Control" && event.metaKey) parts.push("Command");
  if (!parts.length) return "";
  parts.push(key);
  return parts.join("+");
}

function shortcutKeyFromEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) return "";
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key;
  if (event.code === "Space") return "Space";
  if (event.key.startsWith("Arrow")) return event.key;
  if (event.key === "Escape") return "Escape";
  if (event.key === "Tab") return "Tab";
  if (event.key === "Backspace") return "Backspace";
  if (event.key === "Delete") return "Delete";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function shortcutFingerprint(value: string) {
  const platformModifier = platformShortcutModifier().toLowerCase();
  return value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (["ctrl", "control"].includes(part)) return "control";
      if (["cmd", "command", "meta", "super"].includes(part)) return "command";
      if (["cmdorctrl", "commandorcontrol", "commandorctrl"].includes(part))
        return platformModifier.toLowerCase();
      if (part === "esc") return "escape";
      if (/^key[a-z]$/.test(part)) return part.slice(3);
      return part;
    })
    .sort()
    .join("+");
}

export function shortcutsMatch(left: string, right: string) {
  return shortcutFingerprint(left) === shortcutFingerprint(right);
}
