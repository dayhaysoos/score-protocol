import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultRunnerDatabasePath } from "../src/runner/runner-paths.js";

describe("Runner application storage", () => {
  it("keeps the default durable database outside the invoking project on macOS", () => {
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "darwin",
        homeDirectory: "/Users/tester",
        environment: { XDG_DATA_HOME: "/tmp/xdg-must-not-override-macos" }
      }),
      "/Users/tester/Library/Application Support/SCORE/runner.db"
    );
  });

  it("honors the standard XDG data directory on Linux", () => {
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "linux",
        homeDirectory: "/home/tester",
        environment: { XDG_DATA_HOME: "/var/tester-data" }
      }),
      "/var/tester-data/score/runner.db"
    );
  });

  it("uses the local application data directory on Windows", () => {
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "win32",
        homeDirectory: "C:\\Users\\tester",
        environment: { LOCALAPPDATA: "D:\\LocalData" }
      }),
      "D:\\LocalData\\SCORE\\runner.db"
    );
  });

  it("rejects relative environment paths that would place state under cwd", () => {
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "linux",
        homeDirectory: "/home/tester",
        environment: { XDG_DATA_HOME: ".score-data" }
      }),
      "/home/tester/.local/share/score/runner.db"
    );
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "win32",
        homeDirectory: "C:\\Users\\tester",
        environment: { LOCALAPPDATA: "relative-data" }
      }),
      "C:\\Users\\tester\\AppData\\Local\\SCORE\\runner.db"
    );
    assert.equal(
      defaultRunnerDatabasePath({
        platform: "win32",
        homeDirectory: "C:\\Users\\tester",
        environment: { LOCALAPPDATA: "" }
      }),
      "C:\\Users\\tester\\AppData\\Local\\SCORE\\runner.db"
    );
  });
});
