(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, makeFile, terminal, FileSystemAPI } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Names every ordinary JavaScript object answers to. None of them is a
// command, a variable, an alias or a file unless one is really created.
const BUILTIN_NAMES = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"];
// The three the saved-filesystem validator rejects, so they can't be file names.
const FORBIDDEN_FILE_NAMES = ["__proto__", "constructor", "prototype"];

describe("names of JavaScript built-ins are not commands, variables, aliases or files");

test("as a command: plain 'command not found'", async () => {
    for (const name of BUILTIN_NAMES) {
        const r = await run(name);
        assertEqual(r.exitCode, 127);
        assertEqual(r.stdout, `command not found: ${name}`);
    }
});

test("as a variable: expands to nothing instead of crashing", async () => {
    for (const name of BUILTIN_NAMES) {
        assertEqual((await run(`echo [$${name}]`)).stdout, "[]");
        assertEqual((await run(`echo [\${${name}}]`)).stdout, "[]");
        assertEqual((await run(`printenv ${name}`)).exitCode, 1);
    }
});

test("which and man don't report them as existing commands", async () => {
    for (const name of BUILTIN_NAMES) {
        assertEqual((await run(`which ${name}`)).exitCode, 1);
        assertIncludes((await run(`man ${name}`)).stdout, "no manual entry");
    }
});

test("as a file: not found, by every command that looks one up", async () => {
    for (const name of BUILTIN_NAMES) {
        for (const command of ["cat", "ls", "cd", "rm", "chmod 777", "stat", "wc"]) {
            const r = await run(`${command} ${name}`);
            assert(r.exitCode !== 0, `${command} ${name} should fail`);
        }
        assertEqual(FileSystemAPI.get(`/home/guest/${name}`), null);
        assertEqual(FileSystemAPI.get(`/bin/${name}`), null);
    }
});

test("nothing leaks onto the prototype all objects share", async () => {
    for (const command of ["touch __proto__", "chmod 777 __proto__", "echo x > __proto__", "mkdir __proto__",
                           "touch constructor", "cd __proto__", "__proto__=5", "export __proto__=5",
                           "alias __proto__=ls"]) {
        await run(command);
    }
    assertEqual(Object.keys(Object.prototype).length, 0);
    for (const leaked of ["modified", "accessed", "mode", "content", "children"]) {
        assert(!(leaked in {}), `Object.prototype.${leaked} should not exist`);
    }
});

test("ordinary built-in names can be used as real variables, aliases and files", async () => {
    await run("toString=5");
    assertEqual((await run("echo $toString")).stdout, "5");
    await run("export hasOwnProperty=1");
    assertEqual((await run("printenv hasOwnProperty")).stdout, "1");
    await run('alias valueOf="echo aliased"');
    assertEqual((await run("valueOf")).stdout, "aliased");
    await run("echo hi > toString");
    assertEqual((await run("cat toString")).stdout, "hi");
    await run("mkdir valueOf");
    assert(FileSystemAPI.isDirectory("/home/guest/valueOf"), "valueOf should be a directory");
});

test("the three names the saved-filesystem validator rejects can't be created", async () => {
    makeFile("real.txt", "x");
    for (const name of FORBIDDEN_FILE_NAMES) {
        for (const command of [`touch ${name}`, `mkdir ${name}`, `mkdir -p a/${name}/b`, `echo x > ${name}`,
                               `cp real.txt ${name}`, `mv real.txt ${name}`, `ln -s real.txt ${name}`]) {
            const r = await run(command);
            assert(r.exitCode !== 0, `should fail: ${command}`);
            assertIncludes(r.stdout, "Invalid file name");
        }
    }
    assert(FileSystemAPI.get("/home/guest/real.txt"), "real.txt should be untouched");
    // and so the filesystem still survives a save and reload
    assertEqual(FileSystemAPI.restore(FileSystemAPI.serialize()), true);
});

test("copied and restored directories are protected the same way", async () => {
    await run("mkdir src");
    await run("cp -r src copy");
    assertEqual((await run("cat copy/constructor")).exitCode, 1);
    FileSystemAPI.restore(FileSystemAPI.serialize());
    assertEqual((await run("cat copy/toString")).exitCode, 1);
    assertEqual((await run("cat /home/constructor")).exitCode, 1);
});

})();
