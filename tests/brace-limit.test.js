(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, terminal, FileSystemAPI } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

describe("brace expansion is limited to MAX_BRACE_EXPANSIONS results");

test("ordinary brace expansion still works", async () => {
    assertEqual(terminal.expandBraces("a{1,2}{x,y}").join(" "), "a1x a1y a2x a2y");
    assertEqual(terminal.expandBraces("a{1,{2,3}}").join(" "), "a1 a2 a3");
    assertEqual(terminal.expandBraces("foo{bar}").join(" "), "foo{bar}");
    const r = await run("echo file{1,2}.txt");
    assertEqual(r.stdout, "file1.txt\nfile2.txt");
});

test("exactly the limit is allowed", async () => {
    // 2^10 = 1024 results
    assertEqual(MAX_BRACE_EXPANSIONS, 1024);
    assertEqual(terminal.expandBraces("{a,b}".repeat(10)).length, 1024);
});

test("one more than the limit is refused with a clear error, and nothing runs", async () => {
    const r = await run("touch made-it; echo " + "{a,b}".repeat(11));
    assertIncludes(r.stdout, "brace expansion: too many results");
    assert(r.exitCode !== 0, "expected a failing exit code");
    assertEqual(FileSystemAPI.get("/home/guest/made-it"), null);
});

test("a huge expansion is refused quickly instead of crashing", async () => {
    const started = Date.now();
    const r = await run("echo " + "{a,b}".repeat(22));
    assertIncludes(r.stdout, "brace expansion: too many");
    assert(Date.now() - started < 2000, "took too long to refuse");
});

test("an extreme number of brace groups is also refused cleanly", async () => {
    const r = await run("echo " + "{a,b}".repeat(20000));
    assertIncludes(r.stdout, "brace expansion: too many");
    const many = await run("echo " + "{a}".repeat(20000));
    assert(typeof many.stdout === "string", "should not throw");
});

test("the shell keeps working afterwards", async () => {
    await run("echo " + "{a,b}".repeat(22));
    const r = await run("echo ok");
    assertEqual(r.stdout, "ok");
});

})();
