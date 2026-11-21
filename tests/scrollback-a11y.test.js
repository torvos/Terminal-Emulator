(function () {
"use strict";

const { describe, test, run, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Swaps the terminal's output pane for a small stand-in for one test, so
// the test can count exactly what was added and removed. Works the same
// in Node (which has no real page) and in the browser.
function withFakeOutput(fn) {
    const original = terminal.output;
    const fake = {
        children: [],
        appendChild(node) {
            this.children.push(node);
            // what a real element's remove() would do
            node.remove = () => { this.children.splice(this.children.indexOf(node), 1); };
        },
        get childElementCount() { return this.children.length; },
        get firstElementChild() { return this.children[0]; },
        get lastChild() { return this.children[this.children.length - 1]; },
    };
    terminal.output = fake;
    try {
        return fn(fake);
    } finally {
        terminal.output = original;
    }
}
// The harness wraps terminal.write to record output; these tests need the
// real one, which is on the prototype.
const realWrite = (text, options) => TerminalEngine.prototype.write.call(terminal, text, options);

describe("scrollback: the page keeps at most MAX_SCROLLBACK_LINES lines of output");

test("lines up to the limit are all kept", async () => {
    withFakeOutput((out) => {
        for (let i = 0; i < 50; i++) realWrite(`line ${i}`);
        assertEqual(out.children.length, 50);
    });
});

test("past the limit, the oldest lines are removed and the newest kept", async () => {
    withFakeOutput((out) => {
        const marks = [];
        const originalAppend = out.appendChild.bind(out);
        let n = 0;
        out.appendChild = (node) => { node.__n = n++; originalAppend(node); };
        for (let i = 0; i < MAX_SCROLLBACK_LINES + 25; i++) realWrite(`line ${i}`);
        assertEqual(out.children.length, MAX_SCROLLBACK_LINES);
        assertEqual(out.children[0].__n, 25);
        assertEqual(out.children[out.children.length - 1].__n, MAX_SCROLLBACK_LINES + 24);
    });
});

test("a command with more output than the buffer only puts the last lines on the page", async () => {
    const shown = [];
    const originalWrite = terminal.write;
    terminal.write = (text) => { shown.push(String(text)); };
    try {
        await terminal.execute(`seq ${MAX_SCROLLBACK_LINES + 1000}`);
    } finally {
        terminal.write = originalWrite;
    }
    assertEqual(shown.length, MAX_SCROLLBACK_LINES);
    assertEqual(shown[0], "1001");
    assertEqual(shown[shown.length - 1], String(MAX_SCROLLBACK_LINES + 1000));
});

test("piping and redirecting still see all of the output", async () => {
    // The first line never reaches the page for output this long, but a
    // pipe must still receive it.
    const r = await run(`seq ${MAX_SCROLLBACK_LINES + 1000} | head -n 1`);
    assertEqual(r.stdout.trim(), "1");
    await run(`seq ${MAX_SCROLLBACK_LINES + 1000} > all.txt`);
    const first = await run("head -n 1 all.txt");
    assertEqual(first.stdout.trim(), "1");
});

describe("screen readers: decorative output is hidden and has a text equivalent");

// Records setAttribute calls and class names on the elements write() makes.
function collectLines(fn) {
    return withFakeOutput((out) => {
        fn();
        return out.children;
    });
}

test("write() marks a line aria-hidden only when asked to", async () => {
    const originalCreate = document.createElement;
    const made = [];
    document.createElement = function (tag) {
        const el = originalCreate.call(document, tag);
        if (tag === "div") {
            const record = { el, attrs: {} };
            made.push(record);
            const originalSet = el.setAttribute;
            el.setAttribute = function (name, value) {
                record.attrs[name] = value;
                return typeof originalSet === "function" ? originalSet.call(el, name, value) : undefined;
            };
        }
        return el;
    };
    try {
        collectLines(() => {
            realWrite("ordinary line");
            realWrite("block art", { ariaHidden: true });
        });
    } finally {
        document.createElement = originalCreate;
    }
    assertEqual(made.length, 2);
    assertEqual(made[0].attrs["aria-hidden"], undefined);
    assertEqual(made[1].attrs["aria-hidden"], "true");
});

test("writeForScreenReaders() adds an invisible line carrying the text", async () => {
    const lines = collectLines(() => terminal.writeForScreenReaders("Welcome to Torvos.ca"));
    assertEqual(lines.length, 1);
    assertEqual(lines[0].className, "sr-only");
    assertEqual(lines[0].textContent, "Welcome to Torvos.ca");
});

test("the input's spoken label follows the prompt", async () => {
    const labels = [];
    const original = terminal.setInputLabel;
    terminal.setInputLabel = (label) => { labels.push(label); };
    const originalWrite = terminal.write;
    terminal.write = () => {};
    try {
        terminal.currentInput = "login";
        await terminal.handleEnter();           // -> "user:" prompt
        terminal.currentInput = "someone";
        await terminal.handleEnter();           // -> "password:" prompt
        terminal.currentInput = "";
        await terminal.handleEnter();           // -> back to the shell prompt
    } finally {
        terminal.write = originalWrite;
        terminal.setInputLabel = original;
        terminal.inputMode = INPUT_NORMAL;
    }
    assert(labels.includes("User name"), "label for the user prompt");
    assert(labels.some((l) => l.startsWith("Password")), "label for the password prompt");
    assertEqual(labels[labels.length - 1], "Terminal command input");
});

})();
