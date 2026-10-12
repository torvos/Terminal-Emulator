(function () {
"use strict";

const { describe, test, run, assertEqual, assertIncludes } = typeof module !== "undefined" ? require("./harness") : window.TestHarness;

describe("quoted redirect operators are plain arguments, unquoted ones still redirect");

test("a quoted '>' after another word is printed, not treated as a redirect", async () => {
    const r = await run("echo a '>' b");
    assertEqual(r.stdout.trim(), "a > b");
    assertEqual((await run("cat b")).exitCode, 1);
});

test("a quoted '<' after another word is printed, not treated as a redirect", async () => {
    assertEqual((await run("echo a '<' b")).stdout.trim(), "a < b");
});

test("a quoted operator with a target does not create the target file", async () => {
    await run("echo hi '>' out2.txt");
    assertEqual((await run("cat out2.txt")).exitCode, 1);
});

test("unquoted redirects still write files, with or without spaces", async () => {
    await run("echo x > r.txt");
    await run("echo y >> r.txt");
    assertEqual((await run("cat r.txt")).stdout.trim(), "x\ny");
    await run("echo z>s.txt");
    assertEqual((await run("cat s.txt")).stdout.trim(), "z");
});

test("an escaped \\> is a plain argument", async () => {
    assertEqual((await run("echo \\>")).stdout.trim(), ">");
});

test("a trailing operator with no target stays a plain word, as before", async () => {
    assertEqual((await run("echo hi >")).stdout.trim(), "hi >");
});

test("expr can compare with '>' and '<' now that they are not redirects", async () => {
    assertEqual((await run("expr 5 '>' 3")).stdout.trim(), "1");
    assertEqual((await run("expr 5 '>' 3")).exitCode, 0);
    assertEqual((await run("expr 5 '<' 3")).stdout.trim(), "0");
    assertEqual((await run("expr 5 '<' 3")).exitCode, 1);
});

})();
