(function () {
"use strict";

const { describe, test, run, assert, assertEqual, makeFile, terminal, FileSystemAPI } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

describe("~ is only special at the start of a path; elsewhere it is an ordinary character");

test("a file name ending in ~ is its own file", async () => {
    makeFile("notes.txt", "original");
    await run("echo backup > notes.txt~");
    assert(FileSystemAPI.get("/home/guest/notes.txt~"), "notes.txt~ should exist");
    assertEqual((await run("cat notes.txt~")).stdout, "backup");
    assertEqual((await run("cat notes.txt")).stdout, "original");
});

test("a ~ in the middle of a name, or in a directory name", async () => {
    await run("mkdir old~dir");
    await run("echo inside > old~dir/a~b");
    assertEqual((await run("cat old~dir/a~b")).stdout, "inside");
    assertEqual((await run("cat /home/guest/old~dir/a~b")).stdout, "inside");
    await run("cd old~dir");
    assertEqual(terminal.cwd, "/home/guest/old~dir");
});

test("a name that starts with ~ but is not ~ or ~/ is an ordinary name", async () => {
    await run("echo x > ~draft");
    assert(FileSystemAPI.get("/home/guest/~draft"), "~draft should be a file in the current directory");
});

test("rm and mv work on names containing ~", async () => {
    await run("touch a~");
    await run("mv a~ b~");
    assert(FileSystemAPI.get("/home/guest/b~"), "b~ should exist");
    assertEqual(FileSystemAPI.get("/home/guest/a~"), null);
    await run("rm b~");
    assertEqual(FileSystemAPI.get("/home/guest/b~"), null);
});

test("~ and ~/ still mean the home directory", async () => {
    await run("cd /bin");
    await run("cd ~");
    assertEqual(terminal.cwd, HOME);
    await run("cd /bin");
    assert((await run("cat ~/readme.md")).stdout.length > 0, "~/readme.md should be readable");
    await run("cd ~/");
    assertEqual(terminal.cwd, HOME);
});

test("a symlink to a ~ path still resolves", async () => {
    await run("cd /bin");
    await run("ln -s ~/readme.md /home/guest/link-to-readme");
    assert((await run("cat /home/guest/link-to-readme")).stdout.length > 0, "link should resolve");
});

})();
