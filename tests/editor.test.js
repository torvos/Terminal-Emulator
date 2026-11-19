(function () {
"use strict";

const { describe, test, assert, assertEqual, makeFile, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Node has no requestAnimationFrame; openEditor() only uses it to place
// the cursor once the textarea is visible.
if (typeof requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (fn) => fn();
}

// Opens the real editor on a fresh file and always closes it again, so a
// failing assertion can't leave the terminal stuck in editor mode for the
// tests that follow.
function withEditor(content, fn) {
    const node = makeFile("edit-me.txt", content);
    terminal.openEditor(node, "/home/guest/edit-me.txt");
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
// A minimal stand-in for a KeyboardEvent, sent to the editor's key handler.
function editorKey(key, modifiers = {}) {
    const event = { key, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...modifiers };
    terminal.editorKeyHandler(event);
    return event;
}

describe("editor: leaving without saving asks first when there are unsaved changes");

test("Esc with no changes closes straight away", async () => {
    withEditor("hello", () => {
        editorKey("Escape");
        assertEqual(terminal.editor.active, false);
    });
});

test("Esc with unsaved changes asks first, and a second Esc discards", async () => {
    withEditor("hello", (node) => {
        terminal.editorEl.value = "hello world";
        editorKey("Escape");
        assertEqual(terminal.editor.active, true);
        assertEqual(terminal.editor.notice, "confirm-discard");
        editorKey("Escape");
        assertEqual(terminal.editor.active, false);
        assertEqual(node.content, "hello"); // the changes were discarded
    });
});

test("any other key withdraws the question, so the next Esc asks again", async () => {
    withEditor("hello", () => {
        terminal.editorEl.value = "hello world";
        editorKey("Escape");
        assertEqual(terminal.editor.notice, "confirm-discard");
        editorKey("x");
        assertEqual(terminal.editor.notice, null);
        editorKey("Escape");
        assertEqual(terminal.editor.active, true);
        assertEqual(terminal.editor.notice, "confirm-discard");
    });
});

test("a modifier key on its own does not withdraw the question", async () => {
    withEditor("hello", () => {
        terminal.editorEl.value = "changed";
        editorKey("Escape");
        editorKey("Control");
        editorKey("Shift");
        assertEqual(terminal.editor.notice, "confirm-discard");
    });
});

test("text typed without a keydown (touch keyboards) also withdraws the question", async () => {
    withEditor("hello", () => {
        terminal.editorEl.value = "changed";
        editorKey("Escape");
        terminal.editorInputHandler();
        assertEqual(terminal.editor.notice, null);
        assertEqual(terminal.editor.confirmingDiscard, false);
    });
});

test("Ctrl+X after the question saves and exits", async () => {
    withEditor("hello", (node) => {
        terminal.editorEl.value = "kept";
        editorKey("Escape");
        editorKey("x", { ctrlKey: true });
        assertEqual(terminal.editor.active, false);
        assertEqual(node.content, "kept");
    });
});

test("Ctrl+S after the question saves, and Esc then closes without asking", async () => {
    withEditor("hello", (node) => {
        terminal.editorEl.value = "kept";
        editorKey("Escape");
        editorKey("s", { ctrlKey: true });
        assertEqual(node.content, "kept");
        assertEqual(terminal.editor.notice, "saved");
        assertEqual(terminal.editor.active, true);
        editorKey("Escape");
        assertEqual(terminal.editor.active, false);
    });
});

test("typing something and deleting it again is not an unsaved change", async () => {
    withEditor("hello", () => {
        terminal.editorEl.value = "hello!";
        editorKey("!");
        terminal.editorEl.value = "hello";
        editorKey("Backspace");
        assertEqual(terminal.isEditorDirty(), false);
        editorKey("Escape");
        assertEqual(terminal.editor.active, false);
    });
});

describe("editor: the actions behind the touch Save / Save & Exit / Esc buttons");

test("Save writes the file, reports it, and keeps the editor open", async () => {
    withEditor("", (node) => {
        terminal.editorEl.value = "typed on a phone";
        assertEqual(terminal.saveEditor(), true);
        assertEqual(node.content, "typed on a phone");
        assertEqual(terminal.editor.notice, "saved");
        assertEqual(terminal.editor.active, true);
        assertEqual(terminal.isEditorDirty(), false);
    });
});

test("Save & Exit writes the file and closes", async () => {
    withEditor("", (node) => {
        terminal.editorEl.value = "typed on a phone";
        assertEqual(terminal.closeEditor(true), true);
        assertEqual(node.content, "typed on a phone");
        assertEqual(terminal.editor.active, false);
    });
});

test("the 'Saved' message goes away once editing continues", async () => {
    withEditor("", () => {
        terminal.editorEl.value = "a";
        terminal.saveEditor();
        terminal.editorEl.value = "ab";
        terminal.editorInputHandler();
        assertEqual(terminal.editor.notice, null);
        assertEqual(terminal.isEditorDirty(), true);
    });
});

test("a failed save still needs the discard confirmed before Esc closes", async () => {
    withEditor("small", (node) => {
        terminal.editorEl.value = "q".repeat(FS_MAX_FILE_CHARS + 1);
        assertEqual(terminal.closeEditor(true), false);
        assertEqual(terminal.editor.notice, "save-failed");
        assertEqual(terminal.closeEditor(false), false);
        assertEqual(terminal.editor.notice, "confirm-discard");
        assertEqual(terminal.closeEditor(false), true);
        assertEqual(node.content, "small");
    });
});

})();
