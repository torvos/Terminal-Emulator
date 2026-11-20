(function () {
"use strict";

const { describe, test, assert, assertEqual, makeFile, makeDir, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Types `text` (cursor at the end, or at `cursor` if given), presses Tab,
// and returns the resulting input line plus anything printed.
function tab(text, cursor = text.length) {
    const printed = [];
    const originalWrite = terminal.write;
    terminal.write = (line) => {
        printed.push(Array.isArray(line) ? line.map((s) => s.text ?? s).join("") : String(line));
    };
    terminal.inputMode = INPUT_NORMAL;
    terminal.currentInput = text;
    terminal.cursorPos = cursor;
    try {
        terminal.autocomplete();
    } finally {
        terminal.write = originalWrite;
    }
    const result = { input: terminal.currentInput, cursor: terminal.cursorPos, printed };
    terminal.currentInput = "";
    terminal.cursorPos = 0;
    return result;
}
// The candidates shown by a listing (every printed line after the first,
// which repeats the prompt), as an array.
const listed = (result) => result.printed.slice(1).join(" ").split(/\s+/).filter(Boolean);

describe("Tab completion: command names");

test("a unique command is completed", async () => {
    assertEqual(tab("neo").input, "neofetch");
    assertEqual(tab("neo").printed.length, 0);
});

test("an ambiguous command is no longer completed to the first alphabetical match", async () => {
    const r = tab("c");
    assertEqual(r.input, "c");
    const names = listed(r);
    for (const expected of ["cal", "cat", "cd", "chmod", "clear", "cp"]) {
        assert(names.includes(expected), `listing should include ${expected}`);
    }
    assert(names.every((n) => n.startsWith("c")), "only matching names are listed");
});

test("the listing shows the prompt line first, then the candidates in order", async () => {
    const r = tab("c");
    assert(r.printed.length >= 2, "a prompt line and at least one row of candidates");
    assert(r.printed[0].endsWith("$ c"), "first line repeats the prompt and what was typed");
    const names = listed(r);
    assertEqual(names.join(","), [...names].sort().join(","));
});

test("several candidates are completed as far as they agree", async () => {
    // "cow" -> only cowsay; "ch" -> only chmod; "un" -> unalias, uname, uniq, unset share only "un"
    assertEqual(tab("cow").input, "cowsay");
    const r = tab("una");
    assertEqual(r.input, "una"); // unalias / uname agree only on "una"
    assertEqual(listed(r).join(","), "unalias,uname");
});

test("aliases are completed too", async () => {
    terminal.aliases = { ...DEFAULT_ALIASES };
    assertEqual(tab("resu").input, "resume");
    assertEqual(tab("cont").input, "contact");
    const r = tab("res");
    assertEqual(r.input, "res");
    assertEqual(listed(r).join(","), "reset,resume");
});

test("the listing is laid out in columns that fit a narrow screen", async () => {
    const original = terminal.getColumns;
    terminal.getColumns = () => 30;
    try {
        const r = tab("c");
        const rows = r.printed.slice(1);
        assert(rows.length > 1, "should need more than one row at 30 columns");
        assert(rows.every((row) => row.length <= 30), "no row is wider than the screen");
        assert(listed(r).includes("cowsay") && listed(r).includes("curl"), "names are kept whole");
    } finally {
        terminal.getColumns = original;
    }
});

test("no match changes nothing and prints nothing", async () => {
    const r = tab("zzz");
    assertEqual(r.input, "zzz");
    assertEqual(r.printed.length, 0);
});

describe("Tab completion: file and directory names");

test("a unique file is completed", async () => {
    assertEqual(tab("cat cont").input, "cat contact.md");
});

test("several files are completed to their common prefix, then listed", async () => {
    makeFile("report-jan.txt", "");
    makeFile("report-feb.txt", "");
    const first = tab("cat rep");
    assertEqual(first.input, "cat report-");
    assertEqual(first.printed.length, 0);
    const second = tab("cat report-");
    assertEqual(second.input, "cat report-");
    assertEqual(listed(second).join(","), "report-feb.txt,report-jan.txt");
    assertEqual(tab("cat report-j").input, "cat report-jan.txt");
});

test("the seed files that share a prefix are listed instead of doing nothing", async () => {
    const r = tab("cat re");
    assertEqual(r.input, "cat re");
    assertEqual(listed(r).join(","), "readme.md,resume.md");
});

test("directories complete with a trailing slash, and are listed with one", async () => {
    makeDir("docs");
    makeDir("downloads");
    assertEqual(tab("cd doc").input, "cd docs/");
    const r = tab("cd do");
    assertEqual(listed(r).join(","), "docs/,downloads/");
});

test("paths with directories: only the last segment is listed", async () => {
    assertEqual(tab("ls /bi").input, "ls /bin/");
    const r = tab("ls /bin/ca");
    assertEqual(r.input, "ls /bin/ca");
    assertEqual(listed(r).join(","), "cal,cat");
    assertEqual(tab("cat ~/cont").input, "cat ~/contact.md");
});

test("hidden files are offered only after typing the dot", async () => {
    makeFile(".secret", "");
    makeFile("shown.txt", "");
    const all = tab("cat ");
    assert(!listed(all).some((n) => n.startsWith(".")), "dot files should not be listed");
    assert(listed(all).includes("shown.txt"), "ordinary files should be listed");
    assertEqual(tab("cat .sec").input, "cat .secret");
});

test("completing a word in the middle of the line leaves the rest alone", async () => {
    const r = tab("cat cont | wc -l", "cat cont".length);
    assertEqual(r.input, "cat contact.md | wc -l");
    assertEqual(r.cursor, "cat contact.md".length);
});

test("Tab does nothing at the login prompts", async () => {
    terminal.currentInput = "c";
    terminal.cursorPos = 1;
    terminal.inputMode = INPUT_WAIT_FOR_USERNAME;
    const originalWrite = terminal.write;
    let wrote = 0;
    terminal.write = () => { wrote++; };
    try {
        terminal.autocomplete();
    } finally {
        terminal.write = originalWrite;
        terminal.inputMode = INPUT_NORMAL;
    }
    assertEqual(terminal.currentInput, "c");
    assertEqual(wrote, 0);
    terminal.currentInput = "";
    terminal.cursorPos = 0;
});

})();
