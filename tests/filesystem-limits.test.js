(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, makeFile, terminal, FileSystemAPI } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

describe("filesystem size limits: writes and new entries stop at the FS_MAX_* limits");

test("a file cannot grow past the per-file limit, and keeps its old content", async () => {
    makeFile("a.txt", "small");
    const ok = FileSystemAPI.writeContent("/home/guest/a.txt", "x".repeat(FS_MAX_FILE_CHARS));
    assertEqual(ok, true);
    const tooBig = FileSystemAPI.writeContent("/home/guest/a.txt", "x".repeat(FS_MAX_FILE_CHARS + 1));
    assertEqual(tooBig, false);
    assertEqual(FileSystemAPI.get("/home/guest/a.txt").content.length, FS_MAX_FILE_CHARS);
});

test("appending in a loop stops with 'No space left on device' instead of growing forever", async () => {
    let failure = null;
    for (let i = 0; i < 40 && !failure; i++) {
        const r = await run("seq 20000 >> fill");
        if (r.exitCode !== 0) failure = r;
    }
    assert(failure, "expected a write to be refused");
    assertIncludes(failure.stdout, "No space left on device");
    assert(FileSystemAPI.get("/home/guest/fill").content.length <= FS_MAX_FILE_CHARS, "file went over the per-file limit");
});

test("a refused redirect reports the error and does not print the output instead", async () => {
    const r = await run("seq 100000 > huge");
    assert(r.exitCode !== 0, "expected the redirect to fail");
    assertEqual(r.stdout, "No space left on device");
});

test("the total across many files is capped", async () => {
    const chunk = "y".repeat(FS_MAX_FILE_CHARS);
    let refused = false;
    for (let i = 0; i < 10; i++) {
        makeFile(`f${i}`, "");
        if (!FileSystemAPI.writeContent(`/home/guest/f${i}`, chunk)) { refused = true; break; }
    }
    assert(refused, "expected the total limit to refuse a write");
    assert(FileSystemAPI.usage().chars <= FS_MAX_TOTAL_CHARS, "total went over the limit");
});

test("a full filesystem can still be shrunk and cleaned up", async () => {
    const chunk = "y".repeat(FS_MAX_FILE_CHARS);
    for (let i = 0; i < 10; i++) {
        makeFile(`f${i}`, "");
        if (!FileSystemAPI.writeContent(`/home/guest/f${i}`, chunk)) break;
    }
    assertEqual(FileSystemAPI.writeContent("/home/guest/f0", "short"), true);
    const r = await run("rm f1");
    assertEqual(r.exitCode, 0);
    const again = await run("echo hello > note.txt");
    assertEqual(again.exitCode, 0);
});

test("the number of entries is capped (mkdir/touch)", async () => {
    let failure = null;
    for (let i = 0; i < FS_MAX_NODES + 10 && !failure; i++) {
        const r = await run(i % 2 ? `mkdir d${i}` : `touch t${i}`);
        if (r.exitCode !== 0) failure = r;
    }
    assert(failure, "expected an entry to be refused");
    assertIncludes(failure.stdout, "No space left on device");
    assert(FileSystemAPI.usage().nodes <= FS_MAX_NODES, "node count went over the limit");
});

test("cp is refused when the copy would not fit", async () => {
    makeFile("big", "");
    FileSystemAPI.writeContent("/home/guest/big", "z".repeat(FS_MAX_FILE_CHARS));
    let failure = null;
    for (let i = 0; i < 10 && !failure; i++) {
        const r = await run(`cp big copy${i}`);
        if (r.exitCode !== 0) failure = r;
    }
    assert(failure, "expected a copy to be refused");
    assertIncludes(failure.stdout, "No space left on device");
});

test("over-long names are refused", async () => {
    const name = "n".repeat(FS_MAX_NAME_LENGTH + 1);
    for (const command of [`touch ${name}`, `mkdir ${name}`, `echo hi > ${name}`]) {
        const r = await run(command);
        assert(r.exitCode !== 0, `should fail: ${command.slice(0, 12)}...`);
        assertIncludes(r.stdout, "File name too long");
    }
    makeFile("short", "x");
    const moved = await run(`mv short ${name}`);
    assertIncludes(moved.stdout, "File name too long");
    assert(FileSystemAPI.get("/home/guest/short"), "the file should still be at its old name");
});

test("the editor refuses to save a file that is too large", async () => {
    const node = makeFile("e.txt", "before");
    // Set the editor state directly rather than through openEditor(), so
    // this runs the same in Node (no real DOM) and in the browser.
    terminal.editor.active = true;
    terminal.editor.node = node;
    terminal.editor.path = "/home/guest/e.txt";
    try {
        terminal.editorEl.value = "q".repeat(FS_MAX_FILE_CHARS + 1);
        assertEqual(terminal.saveEditor(), false);
        assertEqual(node.content, "before");
        terminal.editorEl.value = "after";
        assertEqual(terminal.saveEditor(), true);
        assertEqual(node.content, "after");
    } finally {
        terminal.editor.active = false;
        terminal.editor.node = null;
        terminal.editorEl.value = "";
    }
});

})();
