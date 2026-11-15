(function () {
"use strict";

const { describe, test, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

describe("sanitizeSettings(): saved settings are type-checked before use");

test("non-objects fall back to defaults without throwing", async () => {
    for (const raw of [null, undefined, 42, "text", [], true]) {
        const s = terminal.sanitizeSettings(raw);
        assertEqual(JSON.stringify(s.history), "[]");
        assertEqual(s.cwd, HOME);
        assertEqual(s.hasbooted, 0);
        assertEqual(JSON.stringify(s.env), "{}");
        assertEqual(JSON.stringify(s.aliases), "{}");
    }
});

test("a well-formed settings object passes through unchanged", async () => {
    const s = terminal.sanitizeSettings({
        history: ["ls", "cd /bin"], historyIndex: 2, hasbooted: 1, cwd: "/bin",
        seedSync: { "/home/guest/resume.md": 3 },
        env: { FOO: "bar" }, aliases: { ll: "ls -la" }
    });
    assertEqual(JSON.stringify(s.history), '["ls","cd /bin"]');
    assertEqual(s.historyIndex, 2);
    assertEqual(s.hasbooted, 1);
    assertEqual(s.cwd, "/bin");
    assertEqual(s.seedSync["/home/guest/resume.md"], 3);
    assertEqual(s.env.FOO, "bar");
    assertEqual(s.aliases.ll, "ls -la");
});

test("wrong-typed fields are replaced by defaults", async () => {
    const s = terminal.sanitizeSettings({
        history: "ls", historyIndex: "7", hasbooted: 2, cwd: 5,
        seedSync: [1, 2], env: "PATH=/", aliases: null
    });
    assertEqual(JSON.stringify(s.history), "[]");
    assertEqual(s.historyIndex, 0);
    assertEqual(s.hasbooted, 0);
    assertEqual(s.cwd, HOME);
    assertEqual(Object.keys(s.seedSync).length, 0);
    assertEqual(Object.keys(s.env).length, 0);
    assertEqual(Object.keys(s.aliases).length, 0);
});

test("bad entries inside history/env/aliases are dropped, good ones kept", async () => {
    const s = terminal.sanitizeSettings({
        history: ["ls", 5, null, { a: 1 }, "", "x".repeat(MAX_HISTORY_ENTRY_CHARS + 1), "pwd"],
        env: { GOOD: "1", NUM: 2, OBJ: {}, "": "empty-key" },
        aliases: { ok: "ls", bad: ["ls"] }
    });
    assertEqual(JSON.stringify(s.history), '["ls","pwd"]');
    assertEqual(JSON.stringify(s.env), '{"GOOD":"1"}');
    assertEqual(JSON.stringify(s.aliases), '{"ok":"ls"}');
});

test("history is capped and an out-of-range index is reset", async () => {
    const many = Array.from({ length: MAX_HISTORY + 50 }, (_, i) => `cmd${i}`);
    const s = terminal.sanitizeSettings({ history: many, historyIndex: 999999 });
    assertEqual(s.history.length, MAX_HISTORY);
    assertEqual(s.history[s.history.length - 1], `cmd${MAX_HISTORY + 49}`);
    assertEqual(s.historyIndex, MAX_HISTORY);
});

test("prototype-polluting keys are never copied", async () => {
    const raw = JSON.parse('{"env":{"__proto__":"x","constructor":"y","OK":"1"},"aliases":{"__proto__":"z"},"seedSync":{"__proto__":1}}');
    const s = terminal.sanitizeSettings(raw);
    assertEqual(JSON.stringify(s.env), '{"OK":"1"}');
    assertEqual(Object.keys(s.aliases).length, 0);
    assertEqual(Object.keys(s.seedSync).length, 0);
    assertEqual(({}).polluted, undefined);
    assert(Object.getPrototypeOf(s.env) === Object.prototype, "env prototype was replaced");
});

})();
