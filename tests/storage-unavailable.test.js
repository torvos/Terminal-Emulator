(function () {
"use strict";

const { describe, test, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Makes any use of `localStorage` throw for the duration of fn, the way
// a browser does when site data is blocked, then puts things back.
async function withStorageBlocked(fn) {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new Error("The operation is insecure."); }
    });
    try {
        return await fn();
    } finally {
        if (original) {
            Object.defineProperty(window, "localStorage", original);
        } else {
            delete window.localStorage;
        }
    }
}

describe("blocked browser storage: the terminal still works, it just isn't saved");

test("reading and removing saved values never throws", async () => {
    await withStorageBlocked(() => {
        assertEqual(terminal.readStorage(STORAGE_KEY_SETTINGS), null);
        assertEqual(terminal.readStorage(STORAGE_KEY_FILESYSTEM), null);
        terminal.removeStorage(STORAGE_KEY_SETTINGS);
        terminal.removeStorage(STORAGE_KEY_FILESYSTEM);
    });
});

test("saving doesn't throw, and the visitor is told once", async () => {
    const warnings = [];
    const originalWrite = terminal.write;
    const alreadyWarned = terminal._storageWriteWarned;
    terminal._storageWriteWarned = false;
    terminal.write = (text) => { warnings.push(String(text)); };
    const originalError = console.error;
    console.error = () => {};
    try {
        await withStorageBlocked(() => {
            terminal.saveSettings({ forceFs: true });
            terminal.saveSettings({ forceFs: true });
        });
    } finally {
        console.error = originalError;
        terminal.write = originalWrite;
        terminal._storageWriteWarned = alreadyWarned;
    }
    assertEqual(warnings.length, 1);
    assert(warnings[0].includes("Unable to save session"), "should explain that nothing will be kept");
});

test("commands keep working while storage is blocked", async () => {
    const originalWrite = terminal.write;
    const originalError = console.error;
    const printed = [];
    terminal.write = (text) => { printed.push(String(text)); };
    console.error = () => {};
    try {
        await withStorageBlocked(async () => {
            terminal.currentInput = "echo still-works";
            await terminal.handleEnter();
        });
    } finally {
        console.error = originalError;
        terminal.write = originalWrite;
    }
    assert(printed.includes("still-works"), "the command should have run");
});

test("normal storage still round-trips", async () => {
    localStorage.setItem("torvos-test-key", "value");
    assertEqual(terminal.readStorage("torvos-test-key"), "value");
    terminal.removeStorage("torvos-test-key");
    assertEqual(terminal.readStorage("torvos-test-key"), null);
});

})();
