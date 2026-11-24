(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, terminal, FileSystemAPI } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// A relative path `levels` directories deep: "d/d/d/..."
const nested = (levels) => Array(levels).fill("d").join("/");
// How deep the deepest "d" chain under the home directory goes.
function chainLength() {
    let node = FileSystemAPI.get("/home/guest");
    let length = 0;
    while (node.children && node.children.d) {
        node = node.children.d;
        length++;
    }
    return length;
}
// /home/guest is 2 levels below "/", so this many more fit under it.
const ROOM_UNDER_HOME = FS_MAX_DEPTH - 2;

describe("directory depth is limited, so a saved filesystem can always be loaded again");

test("the limit is safely below what the saved-filesystem validator accepts", async () => {
    await run(`mkdir -p ${nested(ROOM_UNDER_HOME)}`);
    assertEqual(chainLength(), ROOM_UNDER_HOME);
    assertEqual(FileSystemAPI.restore(FileSystemAPI.serialize()), true);
});

test("mkdir -p stops at the limit with a clear error", async () => {
    const r = await run(`mkdir -p ${nested(300)}`);
    assert(r.exitCode !== 0, "expected mkdir to fail");
    assertIncludes(r.stdout, "Directory nesting too deep");
    assertEqual(chainLength(), ROOM_UNDER_HOME);
});

test("the tree that could be created survives a save and reload, with other files intact", async () => {
    await run("echo precious > mine.txt");
    await run(`mkdir -p ${nested(300)}`);
    const saved = FileSystemAPI.serialize();
    assertEqual(FileSystemAPI.restore(saved), true);
    assertEqual(FileSystemAPI.get("/home/guest/mine.txt").content, "precious");
});

test("every way of creating an entry respects the limit", async () => {
    await run(`mkdir -p ${nested(ROOM_UNDER_HOME)}`);
    await run(`cd ${nested(ROOM_UNDER_HOME)}`);
    for (const command of ["mkdir one", "touch one", "echo x > one", "ln -s /home/guest/readme.md one", "cp /home/guest/readme.md one"]) {
        const r = await run(command);
        assert(r.exitCode !== 0, `should fail: ${command}`);
        assertIncludes(r.stdout, "Directory nesting too deep");
    }
    terminal.cwd = HOME;
});

test("copying or moving a tree can't push it past the limit either", async () => {
    await run(`mkdir -p ${nested(40)}`);   // 40 levels under home
    await run("mkdir -p x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x/x"); // 30 levels
    const copy = await run(`cp -r x ${nested(40)}/x`);
    assertIncludes(copy.stdout, "Directory nesting too deep");
    const move = await run(`mv x ${nested(40)}/x`);
    assertIncludes(move.stdout, "Directory nesting too deep");
    assert(FileSystemAPI.isDirectory("/home/guest/x"), "x should still be where it was");
    // a shallow move is still fine
    assertEqual((await run("mv x y")).exitCode, 0);
    assertEqual(FileSystemAPI.restore(FileSystemAPI.serialize()), true);
});

})();
