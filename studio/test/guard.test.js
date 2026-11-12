"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { isAppFrame, openKind } = require("../services/guard");

const INDEX = path.join(__dirname, "..", "renderer", "index.html");

test("IPC answers only Studio's own page", () => {
  const own = pathToFileURL(INDEX).href;
  assert.equal(isAppFrame(own, INDEX), true);
  assert.equal(isAppFrame(`${own}#editor`, INDEX), true);
  assert.equal(isAppFrame(own.replace(/^file:\/\/\/(.)/, (_, d) => `file:///${d.toLowerCase()}`), INDEX), true);   // drive letter case
  for (const u of ["https://evil.example/index.html", pathToFileURL(path.join(__dirname, "x.html")).href, "file:///C:/Users/x/Downloads/index.html", "", undefined, "not a url"])
    assert.equal(isAppFrame(u, INDEX), false, String(u));
});

test("an open target is a URL or a path; a path is never handed to a shell", () => {
  for (const u of ["https://github.com", "spotify:", "mailto:", "outlookcal:", "steam://run/1"]) assert.equal(openKind(u), "url", u);
  for (const p of ["C:\\tools\\a&calc.exe", "D:/x y/report.pdf", "notepad", "\\\\server\\share", "..\\x"]) assert.equal(openKind(p), "path", p);
});
