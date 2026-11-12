/* Input guards for the main process: who may call IPC, and how a host `open` target is opened. */
"use strict";

const { pathToFileURL } = require("url");

// IPC is for Studio's own page only (renderer/index.html), never a page it was navigated or framed to.
function isAppFrame(url, indexFile) {
  try {
    const a = new URL(url), b = pathToFileURL(indexFile);
    const p = (u) => decodeURIComponent(u.pathname).toLowerCase();   // Windows paths: case-insensitive
    return a.protocol === "file:" && a.host === b.host && p(a) === p(b);
  } catch (_) { return false; }
}

// `open <target>`: a URL (scheme, not a drive letter) goes to the browser or its app; anything else is a
// path or an app name, opened by the shell's file association, never parsed by cmd (& | ^ stay literal).
const openKind = (target) => (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target) ? "url" : "path");

module.exports = { isAppFrame, openKind };
