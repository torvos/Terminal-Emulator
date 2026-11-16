(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, makeFile, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Simulates typing a line and pressing Enter (the real handleEnter()
// path, which is what sets `busy` and catches Ctrl+C), capturing what is
// printed. Returns immediately with the still-running promise so a test
// can act while the command is in progress.
function startCommand(commandLine) {
    const lines = [];
    const originalWrite = terminal.write;
    terminal.write = function (text) {
        lines.push(Array.isArray(text) ? text.map((s) => s.text ?? s).join("") : String(text));
        if (startCommand.onWrite) startCommand.onWrite(lines);
    };
    terminal.currentInput = commandLine;
    const done = terminal.handleEnter().finally(() => {
        terminal.write = originalWrite;
        startCommand.onWrite = null;
    });
    return { lines, done };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("one command at a time: Enter is ignored while a command is running");

test("a second Enter while busy does not start a second command", async () => {
    const first = startCommand("sleep 0.2");
    await wait(20);
    assertEqual(terminal.busy, true);
    terminal.currentInput = "echo SECOND";
    await terminal.handleEnter(); // returns straight away - nothing runs
    assertEqual(terminal.busy, true);
    await first.done;
    assertEqual(terminal.busy, false);
    assert(!first.lines.some((l) => l === "SECOND"), "the second command must not have run");
    assertEqual(terminal.history.length, 1);
    assertEqual(terminal.history[0], "sleep 0.2");
});

test("the terminal accepts commands again once the first one finishes", async () => {
    await startCommand("sleep 0.05").done;
    const second = startCommand("echo again");
    await second.done;
    assertIncludes(second.lines.join("\n"), "again");
});

describe("Ctrl+C stops the running command");

test("with nothing running, there is nothing to interrupt", async () => {
    assertEqual(terminal.requestInterrupt(), false);
    assertEqual(terminal.interruptRequested, false);
});

test("a long sleep ends immediately, with ^C and exit code 130", async () => {
    const started = Date.now();
    const cmd = startCommand("sleep 30");
    await wait(20);
    assertEqual(terminal.requestInterrupt(), true);
    await cmd.done;
    assert(Date.now() - started < 2000, "sleep should have ended early");
    assertEqual(cmd.lines[cmd.lines.length - 1], "^C");
    assertEqual(terminal.lastExitCode, 130);
    assertEqual(terminal.busy, false);
    assertEqual(terminal.interruptRequested, false);
});

test("the rest of the line does not run after an interrupt", async () => {
    const cmd = startCommand("sleep 30; echo AFTER && echo ALSO");
    await wait(20);
    terminal.requestInterrupt();
    await cmd.done;
    assert(!cmd.lines.some((l) => l === "AFTER" || l === "ALSO"), "later commands must not run");
});

test("long output stops part-way through", async () => {
    startCommand.onWrite = (lines) => {
        if (lines.length === 6) terminal.requestInterrupt(); // prompt echo + 5 numbers
    };
    const cmd = startCommand("seq 1000");
    await cmd.done;
    assert(cmd.lines.length < 20, `expected output to stop early, got ${cmd.lines.length} lines`);
    assertEqual(cmd.lines[cmd.lines.length - 1], "^C");
});

test("an endless script loop can be stopped", async () => {
    makeFile("loop.sh", "while true; do\n    x=1\ndone\n", { executable: true });
    const cmd = startCommand("sh loop.sh");
    await wait(30);
    assertEqual(terminal.busy, true);
    terminal.requestInterrupt();
    await cmd.done;
    assertEqual(cmd.lines[cmd.lines.length - 1], "^C");
    assertEqual(terminal._scriptStack.length, 0);
});

test("a command substitution in progress can be stopped", async () => {
    const cmd = startCommand("echo $(sleep 30)");
    await wait(20);
    terminal.requestInterrupt();
    await cmd.done;
    assertEqual(cmd.lines[cmd.lines.length - 1], "^C");
});

test("commands work normally after an interrupt", async () => {
    const cmd = startCommand("sleep 30");
    await wait(20);
    terminal.requestInterrupt();
    await cmd.done;
    const r = await run("echo fine");
    assertEqual(r.stdout, "fine");
    assertEqual(r.exitCode, 0);
});

describe("long output is sped up instead of taking 50 ms per line forever");

// Replaces terminal.sleep with one that records the requested delays.
async function measurePauses(commandLine) {
    const originalSleep = terminal.sleep;
    const pauses = [];
    terminal.sleep = async (ms) => { pauses.push(ms); };
    try {
        await run(commandLine);
    } finally {
        terminal.sleep = originalSleep;
    }
    return { count: pauses.length, total: pauses.reduce((a, b) => a + b, 0) };
}

test("short output keeps the normal per-line delay", async () => {
    const p = await measurePauses("seq 10");
    assertEqual(p.count, 10);
    assertEqual(Math.round(p.total), 10 * LINE_PRINT_DELAY_MS);
});

test("very long output takes about MAX_OUTPUT_ANIMATION_MS in total", async () => {
    const p = await measurePauses("seq 50000");
    assert(Math.abs(p.total - MAX_OUTPUT_ANIMATION_MS) < 50, `total pause was ${p.total} ms`);
    assert(p.count <= MAX_OUTPUT_ANIMATION_MS / MIN_OUTPUT_PAUSE_MS + 1, `too many pauses: ${p.count}`);
});

})();
