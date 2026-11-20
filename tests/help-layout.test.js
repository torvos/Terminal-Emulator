(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Runs `help` as if the terminal were `columns` characters wide.
async function helpAt(columns) {
    const original = terminal.getColumns;
    terminal.getColumns = () => columns;
    try {
        return (await run("help")).stdout.split("\n");
    } finally {
        terminal.getColumns = original;
    }
}

describe("help: picks a layout that fits the screen width");

test("a wide screen gets the boxed layout, every line the same width", async () => {
    const lines = await helpAt(120);
    assertEqual(lines[0], "    +" + "-".repeat(68) + "+");
    assert(lines.every((l) => l.length === 74), "every boxed line should be 74 characters");
    assertEqual(lines.length, 22);
    assertIncludes(lines.join("\n"), "|  cat <file>       Display file contents, example cat readme.md     |");
});

test("the box is used at exactly its own width, and not one column narrower", async () => {
    assert((await helpAt(74))[0].startsWith("    +"), "74 columns fits the box");
    assert(!(await helpAt(73))[0].includes("+"), "73 columns does not");
});

test("a phone-width screen gets the compact layout, which fits without wrapping", async () => {
    const lines = await helpAt(50);
    assert(lines.every((l) => l.length <= 45), `longest line is ${Math.max(...lines.map((l) => l.length))}`);
    assert(!lines.some((l) => l.includes("|") || l.includes("+--")), "no box characters");
});

test("both layouts list the same commands", async () => {
    const wide = (await helpAt(120)).join("\n");
    const narrow = (await helpAt(50)).join("\n");
    for (const command of ["ls", "ls -l", "cd <dir>", "cd ..", "cat <file>", "edit <file>", "more <file>",
                           "man <command>", "<command> --help", "help", "reset", "clear"]) {
        assertIncludes(wide, `  ${command} `);
        assertIncludes(narrow, `  ${command} `);
    }
});

})();
