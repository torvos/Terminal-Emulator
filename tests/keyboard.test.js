(function () {
"use strict";

const { describe, test, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// A minimal stand-in for a KeyboardEvent, sent straight to the terminal's
// key handler. `prevented` records whether the terminal took the key away
// from the browser.
function press(key, modifiers = {}) {
    const event = {
        key,
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        isComposing: false, keyCode: 0,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...modifiers
    };
    terminal.handleKeyDown(event);
    return event;
}
const ctrl = (key) => press(key, { ctrlKey: true });

// Pretends text is (or is not) selected on the page for one test.
function withSelection(selected, fn) {
    const original = terminal.hasTextSelection;
    terminal.hasTextSelection = () => selected;
    try { return fn(); } finally { terminal.hasTextSelection = original; }
}
// Silences terminal.write for one call (Ctrl+C prints "^C").
function quietly(fn) {
    const original = terminal.write;
    terminal.write = () => {};
    try { return fn(); } finally { terminal.write = original; }
}

describe("browser shortcuts are left alone unless the terminal uses them");

test("Ctrl combinations the terminal does not use reach the browser", async () => {
    for (const key of ["r", "f", "p", "+", "-", "=", "0", "t", "n", "s", "d", "j", "h"]) {
        terminal.currentInput = "abc";
        terminal.cursorPos = 3;
        const e = ctrl(key);
        assertEqual(e.prevented, false);
        assertEqual(terminal.currentInput, "abc"); // and the letter is not typed
    }
});

test("Cmd combinations and function keys reach the browser", async () => {
    terminal.currentInput = "";
    for (const key of ["c", "v", "a", "r", "f"]) {
        assertEqual(press(key, { metaKey: true }).prevented, false);
    }
    for (const key of ["F5", "F11", "F12"]) {
        assertEqual(press(key).prevented, false);
    }
    assertEqual(terminal.currentInput, "");
});

test("the terminal's own Ctrl shortcuts still work and are kept from the browser", async () => {
    terminal.currentInput = "hello world";
    terminal.cursorPos = 11;
    assertEqual(ctrl("a").prevented, true);
    assertEqual(terminal.cursorPos, 0);
    assertEqual(ctrl("e").prevented, true);
    assertEqual(terminal.cursorPos, 11);
    assertEqual(ctrl("w").prevented, true);
    assertEqual(terminal.currentInput, "hello ");
    assertEqual(ctrl("u").prevented, true);
    assertEqual(terminal.currentInput, "");
    terminal.currentInput = "abcdef";
    terminal.cursorPos = 3;
    assertEqual(ctrl("k").prevented, true);
    assertEqual(terminal.currentInput, "abc");
    terminal.currentInput = "";
    terminal.cursorPos = 0;
});

test("ordinary typing still works", async () => {
    terminal.currentInput = "";
    terminal.cursorPos = 0;
    for (const ch of "ls -l") press(ch);
    assertEqual(terminal.currentInput, "ls -l");
    press("Backspace");
    assertEqual(terminal.currentInput, "ls -");
    terminal.currentInput = "";
    terminal.cursorPos = 0;
});

describe("Ctrl+C copies when text is selected, and is a terminal key otherwise");

test("with text selected, Ctrl+C is left to the browser and nothing is cancelled", async () => {
    terminal.currentInput = "half typed";
    terminal.cursorPos = 10;
    const e = withSelection(true, () => ctrl("c"));
    assertEqual(e.prevented, false);
    assertEqual(terminal.currentInput, "half typed");
    terminal.currentInput = "";
    terminal.cursorPos = 0;
});

test("with nothing selected, Ctrl+C still clears the typed line", async () => {
    terminal.currentInput = "half typed";
    terminal.cursorPos = 10;
    const e = withSelection(false, () => quietly(() => ctrl("c")));
    assertEqual(e.prevented, true);
    assertEqual(terminal.currentInput, "");
});

test("with text selected, Ctrl+C does not interrupt a running command", async () => {
    terminal.currentInput = "sleep 0.3";
    const running = quietly(() => terminal.handleEnter());
    await new Promise((r) => setTimeout(r, 20));
    withSelection(true, () => ctrl("c"));
    assertEqual(terminal.interruptRequested, false);
    assertEqual(terminal.busy, true);
    withSelection(false, () => ctrl("c"));
    assertEqual(terminal.interruptRequested, true);
    const originalWrite = terminal.write;
    terminal.write = () => {};
    try { await running; } finally { terminal.write = originalWrite; }
    assertEqual(terminal.lastExitCode, 130);
});

test("while a command runs, browser shortcuts still work but plain keys are ignored", async () => {
    terminal.currentInput = "sleep 0.2";
    const originalWrite = terminal.write;
    terminal.write = () => {};
    try {
        const running = terminal.handleEnter();
        await new Promise((r) => setTimeout(r, 20));
        assertEqual(ctrl("r").prevented, false);
        assertEqual(press("x").prevented, true);
        await running;
    } finally {
        terminal.write = originalWrite;
    }
    assertEqual(terminal.currentInput, "");
});

})();
