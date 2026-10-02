/* Maps a focused-window process name to an app context id. Kept in sync with
 * the CONTEXTS list in renderer/data.js (display metadata lives there). */
"use strict";

const CONTEXT_MATCH = [
  ["chrome", ["chrome", "msedge", "brave", "opera", "vivaldi", "firefox"]],
  ["vscode", ["code", "cursor"]],
  ["terminal", ["windowsterminal", "wt", "powershell", "pwsh", "cmd", "conhost", "alacritty"]],
  ["slack", ["slack"]],
  ["discord", ["discord"]],
  ["figma", ["figma"]],
  ["excel", ["excel"]],
  ["word", ["winword"]],
  ["outlook", ["outlook"]],
  ["explorer", ["explorer"]],
  ["photoshop", ["photoshop"]],
  ["spotify", ["spotify"]],
  ["notion", ["notion"]],
  ["teams", ["teams", "ms-teams"]],
  ["zoom", ["zoom"]],
];

function contextForProcess(proc) {
  const p = (proc || "").toLowerCase().replace(/\.exe$/, "");
  if (!p) return "global";
  for (const [id, frags] of CONTEXT_MATCH) if (frags.some((f) => p.includes(f))) return id;
  return "global";
}

module.exports = { contextForProcess, CONTEXT_MATCH };
