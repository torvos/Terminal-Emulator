(function () {
"use strict";

const { describe, test, run, assert, assertEqual, makeFile, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Runs a command as if the terminal were `columns` characters wide.
async function runAt(columns, commandLine) {
    const original = terminal.getColumns;
    terminal.getColumns = () => columns;
    try {
        return await run(commandLine);
    } finally {
        terminal.getColumns = original;
    }
}

const BOX = [
    "+----------------------+",
    "| - Email: a@b.co      |",
    "| - Site: https://b.co |",
    "+----------------------+"
];

describe("fitBoxes(): boxed output loses its box only when the box is too wide for the screen");

test("a box that fits is left exactly as it is", async () => {
    assertEqual(terminal.fitBoxes(BOX, 80).join("\n"), BOX.join("\n"));
    assertEqual(terminal.fitBoxes(BOX, 24).join("\n"), BOX.join("\n")); // exactly as wide as the screen
});

test("a box wider than the screen is replaced by its text", async () => {
    assertEqual(terminal.fitBoxes(BOX, 23).join("\n"), "- Email: a@b.co\n- Site: https://b.co");
});

test("indentation inside the box is kept; text outside it is untouched", async () => {
    const lines = ["Title", "+--------+", "| a      |", "|   b    |", "+--------+", "after | not a row"];
    assertEqual(terminal.fitBoxes(lines, 5).join("\n"), "Title\na\n  b\nafter | not a row");
});

test("output with no box, or only pipes, is never changed", async () => {
    const plain = ["just text", "a | b | c", "1 + 2 = 3", "+", "--------"];
    assertEqual(terminal.fitBoxes(plain, 3).join("\n"), plain.join("\n"));
});

test("a border line on its own is not a box, and is kept", async () => {
    assertEqual(terminal.fitBoxes(["+----------+"], 5).join("\n"), "+----------+");
    assertEqual(terminal.fitBoxes(["+----------+", "text"], 5).join("\n"), "+----------+\ntext");
});

describe("contact on a narrow screen");

test("at phone width, contact shows the three lines without the box", async () => {
    const r = await runAt(56, "cat ~/contact.md");
    const lines = r.stdout.split("\n");
    assertEqual(lines.length, 3);
    assert(lines.every((l) => l.length <= 56), "every line fits");
    assert(!r.stdout.includes("+--") && !r.stdout.includes("|"), "no box characters");
    assert(lines[0].startsWith("- Email:"), `first line was: ${lines[0]}`);
});

test("at desktop width, contact still shows its box", async () => {
    const r = await runAt(120, "cat ~/contact.md");
    assert(r.stdout.startsWith("+---"), "box is kept");
    assertEqual(r.stdout.split("\n").length, 5);
});

test("only the display changes: pipes and redirects get the original text", async () => {
    const piped = await runAt(40, "cat ~/contact.md | head -n 1");
    assert(piped.stdout.startsWith("+---"), "a pipe sees the border row");
    await runAt(40, "cat ~/contact.md > copy.md");
    const counted = await runAt(120, "cat copy.md");
    assertEqual(counted.stdout.split("\n").length, 5);
});

test("a visitor's own boxed file is handled the same way", async () => {
    makeFile("box.txt", BOX.join("\n"));
    assertEqual((await runAt(20, "cat box.txt")).stdout, "- Email: a@b.co\n- Site: https://b.co");
    assertEqual((await runAt(80, "cat box.txt")).stdout, BOX.join("\n"));
});

})();
