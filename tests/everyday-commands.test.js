(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, makeFile, makeDir } = typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Output with the trailing newline trimmed, so tests don't depend on it
const out = async (cmd) => (await run(cmd)).stdout.replace(/\n$/, "");

// Runs a command with stderr redirected to a file, returns what it printed to stderr
async function errOf(cmd) {
    await run(`${cmd} 2> err.txt`);
    return (await run("cat err.txt")).stdout;
}

describe("cut: fields, characters, and lists");

test("-f selects fields with -d", async () => {
    makeFile("d.csv", "a,b,c\n1,2,3\n");
    assertEqual(await out("cut -d , -f 2 d.csv"), "b\n2");
});

test("-f accepts lists and ranges (1,3 / 2- / -2)", async () => {
    assertEqual(await out("echo a:b:c:d | cut -d : -f 1,3"), "a:c");
    assertEqual(await out("echo a:b:c:d | cut -d : -f 2-"), "b:c:d");
    assertEqual(await out("echo a:b:c:d | cut -d : -f -2"), "a:b");
});

test("fields default to TAB", async () => {
    assertEqual(await out("printf 'x\\ty\\tz\\n' | cut -f 3"), "z");
});

test("-c selects characters", async () => {
    assertEqual(await out("echo hello | cut -c 1-3"), "hel");
    assertEqual(await out("echo hello | cut -c 2,4"), "el");
});

test("lines without the delimiter pass through, unless -s", async () => {
    assertEqual(await out("echo nodelim | cut -d : -f 1"), "nodelim");
    assertEqual(await out("echo nodelim | cut -s -d : -f 1"), "");
});

test("missing list, both list types, or a bad range are errors", async () => {
    assertEqual((await run("echo hi | cut")).exitCode, 1);
    assertIncludes(await errOf("echo hi | cut"), "you must specify a list");
    assertIncludes(await errOf("echo hi | cut -c 1 -f 1"), "only one type of list");
    assertIncludes(await errOf("echo hi | cut -f 0"), "numbered from 1");
});

test("cut reads named files and reports missing ones without hiding the rest", async () => {
    makeFile("ok.txt", "a:b\n");
    const r = await run("cut -d : -f 2 missing.txt ok.txt");
    assertIncludes(r.stdout, "b");
    assertIncludes(r.stdout, "cut: missing.txt: No such file or directory");
});

describe("tee: copy stdin to files");

test("tee passes input through and writes the file", async () => {
    assertEqual(await out("printf 'hi' | tee out.txt"), "hi");
    assertEqual((await run("cat out.txt")).stdout, "hi");
});

test("tee overwrites by default and appends with -a", async () => {
    makeFile("log.txt", "one\n");
    await run("echo two | tee log.txt");
    assertEqual((await run("cat log.txt")).stdout.trim(), "two");
    await run("echo three | tee -a log.txt");
    assertEqual(await out("cat log.txt"), "two\nthree");
});

describe("xargs: build commands from stdin");

test("xargs appends all items to the command", async () => {
    assertEqual(await out("printf 'a b\\n' | xargs echo"), "a b");
});

test("-n limits items per run", async () => {
    assertEqual(await out("echo a b c | xargs -n 1 echo"), "a\nb\nc");
});

test("-I runs once per line, substituting the placeholder", async () => {
    assertEqual(await out("printf 'x\\ny\\n' | xargs -I {} echo item-{}"), "item-x\nitem-y");
});

test("xargs can act on files named in a pipeline", async () => {
    makeFile("f.txt", "hello\n");
    assertEqual(await out("echo f.txt | xargs cat"), "hello");
});

test("xargs with no input runs the command once with no arguments", async () => {
    assertEqual(await out("printf '' | xargs echo done"), "done");
});

describe("seq: number sequences");

test("seq LAST counts from 1", async () => {
    assertEqual(await out("seq 3"), "1\n2\n3");
});

test("seq FIRST INCREMENT LAST steps by the increment", async () => {
    assertEqual(await out("seq 2 2 8"), "2\n4\n6\n8");
    assertEqual(await out("seq 5 -2 1"), "5\n3\n1");
});

test("-s changes the separator and -w pads with zeros", async () => {
    assertEqual(await out("seq -s , 1 4"), "1,2,3,4");
    assertEqual(await out("seq -w 8 10"), "08\n09\n10");
});

test("decimal steps keep their decimal places", async () => {
    assertEqual(await out("seq 1 0.5 2"), "1.0\n1.5\n2.0");
});

test("an empty range prints nothing, a zero increment is an error", async () => {
    assertEqual(await out("seq 5 1"), "");
    assertEqual((await run("seq 1 0 5")).exitCode, 1);
});

describe("basename and dirname: split paths");

test("basename returns the last component", async () => {
    assertEqual(await out("basename /home/guest/resume.md"), "resume.md");
    assertEqual(await out("basename /home/guest/"), "guest");
});

test("basename removes a matching suffix", async () => {
    assertEqual(await out("basename /home/guest/resume.md .md"), "resume");
    assertEqual(await out("basename notes.txt .md"), "notes.txt");
});

test("dirname returns everything before the last slash", async () => {
    assertEqual(await out("dirname /home/guest/resume.md"), "/home/guest");
    assertEqual(await out("dirname notes.txt"), ".");
    assertEqual(await out("dirname /file"), "/");
});

describe("sleep: pause for a while");

test("sleep accepts fractions and returns success", async () => {
    const r = await run("sleep 0.01");
    assertEqual(r.exitCode, 0);
});

test("sleep adds up several arguments", async () => {
    assertEqual((await run("sleep 0.01 0.01")).exitCode, 0);
});

test("sleep rejects bad intervals and anything over the 60 second cap", async () => {
    assertEqual((await run("sleep 1x")).exitCode, 1);
    assertIncludes(await errOf("sleep 1x"), "invalid time interval");
    assertIncludes(await errOf("sleep 3600"), "interval too long");
});

describe("du: disk usage");

test("a small file takes one 4 KiB block (reported in KiB)", async () => {
    makeFile("small.txt", "hi");
    assertEqual(await out("du small.txt"), "4\tsmall.txt");
});

test("sizes round up to whole blocks; -h makes them readable", async () => {
    makeFile("big.txt", "x".repeat(5000));
    assertEqual(await out("du big.txt"), "8\tbig.txt");
    assertEqual(await out("du -h big.txt"), "8.0K\tbig.txt");
});

test("-s totals a directory, otherwise each directory is listed", async () => {
    makeDir("proj");
    makeFile("proj/a.txt", "");
    assertEqual(await out("du -s proj"), "4\tproj");
    assertEqual(await out("du proj"), "4\tproj");
});

test("du reports missing paths as errors", async () => {
    assertEqual((await run("du nowhere")).exitCode, 1);
});

describe("rev: reverse each line");

test("rev reverses characters on stdin", async () => {
    assertEqual(await out("echo hello | rev"), "olleh");
});

test("rev reverses each line of a file and keeps line order", async () => {
    makeFile("r.txt", "abc\nxyz\n");
    assertEqual(await out("rev r.txt"), "cba\nzyx");
});

test("rev handles multi-byte characters as single characters", async () => {
    assertEqual(await out("echo héllo | rev"), "olléh");
});

describe("nl: number lines");

test("nl numbers only non-empty lines by default", async () => {
    const lines = (await out("printf 'a\\n\\nb\\n' | nl")).split("\n");
    assertEqual(lines[0], "     1\ta");
    assertEqual(lines[2], "     2\tb");
});

test("nl -b a numbers blank lines too", async () => {
    const lines = (await out("printf 'a\\n\\nb\\n' | nl -b a")).split("\n");
    assertEqual(lines[1], "     2\t");
    assertEqual(lines[2], "     3\tb");
});

test("nl rejects an unknown numbering style", async () => {
    assertEqual((await run("echo hi | nl -b x")).exitCode, 1);
});

describe("cal: month calendar");

test("cal MONTH YEAR prints a Sunday-first calendar", async () => {
    // February 2026 starts on a Sunday and has 28 days
    const lines = (await out("cal 2 2026")).split("\n");
    assertEqual(lines[0], "   February 2026");
    assertEqual(lines[1], "Su Mo Tu We Th Fr Sa");
    assertEqual(lines[2], " 1  2  3  4  5  6  7");
    assertEqual(lines[lines.length - 1], "22 23 24 25 26 27 28");
    assertEqual(lines.length, 6);
});

test("cal rejects an invalid month or year", async () => {
    assertEqual((await run("cal 13 2026")).exitCode, 1);
    assertIncludes(await errOf("cal 13 2026"), "invalid month or year");
});

describe("expr: evaluate expressions");

test("arithmetic with the usual precedence", async () => {
    assertEqual(await out("expr 2 + 3"), "5");
    assertEqual(await out("expr 2 + 3 '*' 4"), "14");
    assertEqual(await out("expr 7 / 2"), "3");
    assertEqual(await out("expr 7 % 3"), "1");
});

test("parentheses override precedence", async () => {
    assertEqual(await out("expr '(' 2 + 3 ')' '*' 2"), "10");
});

test("comparisons print 1 or 0 and set the exit status", async () => {
    // Note: '<' and '>' are left out on purpose. The shell currently treats a
    // quoted '>' or '<' after another word as a redirect, before expr runs.
    assertEqual(await out("expr 5 '>=' 3"), "1");
    assertEqual((await run("expr 5 '>=' 3")).exitCode, 0);
    assertEqual(await out("expr 3 = 4"), "0");
    assertEqual((await run("expr 3 = 4")).exitCode, 1);
    assertEqual(await out("expr 3 '!=' 4"), "1");
});

test("text compares as text, and | and & pick operands", async () => {
    assertEqual(await out("expr hello = hello"), "1");
    assertEqual(await out("expr 0 '|' 7"), "7");
    assertEqual(await out("expr 1 '&' 0"), "0");
});

test("syntax errors and division by zero exit with 2", async () => {
    assertEqual((await run("expr 1 +")).exitCode, 2);
    assertIncludes(await errOf("expr 1 +"), "syntax error");
    assertEqual((await run("expr 1 / 0")).exitCode, 2);
});

describe("every new command documents itself with --help");

for (const name of ["cut", "tee", "xargs", "seq", "basename", "dirname", "sleep", "du", "rev", "nl", "cal", "expr"]) {
    test(`${name} --help prints its usage line`, async () => {
        const r = await run(`${name} --help`);
        assertEqual(r.exitCode, 0);
        assertIncludes(r.stdout, "Usage syntax");
    });
}

describe("the self-test script (.script.sh) covers the new commands");

test("every new section of .script.sh passes", async () => {
    const r = await run("sh .script.sh");
    const start = r.stdout.indexOf("[TEST] cut");
    const end = r.stdout.indexOf("[TEST] Locked network recon commands");
    assert(start !== -1 && end !== -1 && end > start, "new sections should be present in the script output");
    const section = r.stdout.slice(start, end);
    assert(!section.includes("FAIL"), "a check in the new .script.sh sections failed:\n" + section);
    assertIncludes(section, "PASS: expr precedence");
    assertIncludes(section, "PASS: xargs -I substitution");
});

})();
