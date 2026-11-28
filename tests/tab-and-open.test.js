(function () {
"use strict";

const { describe, test, run, assert, assertEqual, assertIncludes, makeFile, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

if (typeof requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (fn) => fn();
}

// A minimal stand-in for a KeyboardEvent.
function key(name, modifiers = {}) {
    return {
        key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...modifiers
    };
}
// Opens the real editor on a fresh file, always closing it again.
function withEditor(content, fn) {
    const node = makeFile("tab-me.txt", content);
    terminal.openEditor(node, "/home/guest/tab-me.txt");
    try {
        return fn(node);
    } finally {
        if (terminal.editor.active) {
            terminal.editorEl.value = node.content;
            terminal.closeEditor(false);
        }
        terminal.inputMode = INPUT_NORMAL;
    }
}
// Runs fn with a fixed list of "links on screen" and records what `open`
// asks the browser to open, without opening anything.
async function withLinks(links, fn) {
    const originalList = terminal.listLinks;
    const originalOpen = terminal.openLink;
    const opened = [];
    terminal.listLinks = () => links;
    terminal.openLink = (href, newTab) => { opened.push({ href, newTab }); };
    try {
        await fn(opened);
    } finally {
        terminal.listLinks = originalList;
        terminal.openLink = originalOpen;
    }
    return opened;
}
const SCREEN_LINKS = [
    { text: "contact@torvos.ca", href: "mailto:contact@torvos.ca", type: "email" },
    { text: "https://github.com/torvos", href: "https://github.com/torvos", type: "url" }
];

describe("Tab in the editor indents instead of leaving the editor");

test("Tab is kept from the browser and inserts a tab at the cursor", async () => {
    withEditor("ab", () => {
        terminal.editorEl.value = "ab";
        if (typeof terminal.editorEl.setSelectionRange === "function") {
            terminal.editorEl.setSelectionRange(1, 1);
        }
        const e = key("Tab");
        terminal.editorKeyHandler(e);
        assertEqual(e.prevented, true);
        assert(terminal.editorEl.value.includes("\t"), "a tab character should have been inserted");
        assertEqual(terminal.editorEl.value.replace("\t", ""), "ab");
        assertEqual(terminal.editor.active, true);
        assertEqual(terminal.isEditorDirty(), true);
    });
});

test("Shift+Tab is also kept from the browser, and changes nothing", async () => {
    withEditor("ab", () => {
        const e = key("Tab", { shiftKey: true });
        terminal.editorKeyHandler(e);
        assertEqual(e.prevented, true);
        assertEqual(terminal.editorEl.value, "ab");
    });
});

test("Tab withdraws a pending 'discard changes?' question like any other typing", async () => {
    withEditor("ab", () => {
        terminal.editorEl.value = "abc";
        terminal.editorKeyHandler(key("Escape"));
        assertEqual(terminal.editor.notice, "confirm-discard");
        terminal.editorKeyHandler(key("Tab"));
        assertEqual(terminal.editor.notice, null);
    });
});

describe("Tab at the prompt is always kept from the browser");

test("Tab and Shift+Tab never reach the browser, whatever the prompt is doing", async () => {
    const originalWrite = terminal.write;
    terminal.write = () => {};
    try {
        for (const mode of [INPUT_NORMAL, INPUT_WAIT_FOR_USERNAME, INPUT_WAIT_FOR_PASSWORD]) {
            terminal.inputMode = mode;
            for (const text of ["", "c", "zzz-no-match"]) {
                terminal.currentInput = text;
                terminal.cursorPos = text.length;
                for (const modifiers of [{}, { shiftKey: true }]) {
                    const e = key("Tab", modifiers);
                    terminal.handleKeyDown(e);
                    assertEqual(e.prevented, true);
                }
            }
        }
    } finally {
        terminal.write = originalWrite;
        terminal.inputMode = INPUT_NORMAL;
        terminal.currentInput = "";
        terminal.cursorPos = 0;
    }
});

describe("open: reaching links from the keyboard");

test("with no argument it lists the links on screen, numbered", async () => {
    await withLinks(SCREEN_LINKS, async (opened) => {
        const r = await run("open");
        assertEqual(r.exitCode, 0);
        assertIncludes(r.stdout, "1  contact@torvos.ca");
        assertIncludes(r.stdout, "2  https://github.com/torvos");
        assertEqual(opened.length, 0);
    });
});

test("a number opens that link: web pages in a new tab, email not", async () => {
    await withLinks(SCREEN_LINKS, async (opened) => {
        assertEqual((await run("open 2")).stdout, "Opening https://github.com/torvos");
        assertEqual((await run("open 1")).stdout, "Opening contact@torvos.ca");
        assertEqual(opened.length, 2);
        assertEqual(opened[0].href, "https://github.com/torvos");
        assertEqual(opened[0].newTab, true);
        assertEqual(opened[1].href, "mailto:contact@torvos.ca");
        assertEqual(opened[1].newTab, false);
    });
});

test("a number that isn't in the list is an error and opens nothing", async () => {
    await withLinks(SCREEN_LINKS, async (opened) => {
        for (const n of ["0", "3", "99"]) {
            const r = await run(`open ${n}`);
            assertEqual(r.exitCode, 1);
            assertIncludes(r.stdout, `no link number ${n}`);
        }
        assertEqual(opened.length, 0);
    });
    await withLinks([], async (opened) => {
        assertIncludes((await run("open")).stdout, "no links on screen");
        assertIncludes((await run("open 1")).stdout, "no links on screen");
        assertEqual(opened.length, 0);
    });
});

test("a typed web or email address is opened directly", async () => {
    await withLinks([], async (opened) => {
        await run("open https://example.com/page");
        await run("open someone@example.com");
        assertEqual(opened[0].href, "https://example.com/page");
        assertEqual(opened[0].newTab, true);
        assertEqual(opened[1].href, "mailto:someone@example.com");
        assertEqual(opened[1].newTab, false);
    });
});

test("anything that is not an http(s) or email address is refused", async () => {
    await withLinks(SCREEN_LINKS, async (opened) => {
        for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://example.com",
                           "example.com", "resume.md", "'https://example.com extra'", "//example.com"]) {
            const r = await run(`open ${bad}`);
            assertEqual(r.exitCode, 1);
        }
        assertEqual((await run("open 1 2")).exitCode, 1);
        assertEqual(opened.length, 0);
    });
});

test("it refuses to open anything when no key press led to it", async () => {
    const hadNavigator = typeof navigator !== "undefined";
    const original = hadNavigator ? Object.getOwnPropertyDescriptor(navigator, "userActivation") : undefined;
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } });
    try {
        await withLinks(SCREEN_LINKS, async (opened) => {
            const r = await run("open 2");
            assertEqual(r.exitCode, 1);
            assertIncludes(r.stdout, "right after you press Enter");
            assertEqual(opened.length, 0);
            // listing is still allowed - it opens nothing
            assertEqual((await run("open")).exitCode, 0);
        });
    } finally {
        if (original) {
            Object.defineProperty(navigator, "userActivation", original);
        } else {
            delete navigator.userActivation;
        }
    }
});

test("open is a real command: listed by help, has a manual page, completes with Tab", async () => {
    assertIncludes((await run("help")).stdout, "open");
    assertIncludes((await run("man open")).stdout, "open [NUMBER | URL | EMAIL]");
    assertEqual((await run("which open")).stdout, "/bin/open");
    terminal.currentInput = "ope";
    terminal.cursorPos = 3;
    terminal.autocomplete();
    assertEqual(terminal.currentInput, "open");
    terminal.currentInput = "";
    terminal.cursorPos = 0;
});

})();
