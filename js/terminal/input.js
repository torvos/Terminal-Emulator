/**
 * Keyboard/pointer input handling for TerminalEngine: binds all DOM event
 * listeners (focus management, key handling for normal input/pager/editor
 * shortcuts, paste handling), plus the Enter-key command dispatch, command
 * history navigation, and Tab autocompletion.
 */
Object.assign(TerminalEngine.prototype, {

    /**
     * Whether any text on the page is currently selected (highlighted)
     * with the mouse or keyboard. Used to tell "click to focus" from
     * "finished selecting", and Ctrl+C "copy" from Ctrl+C "interrupt".
     * @returns {boolean}
     */
    hasTextSelection() {
        const selection = typeof window.getSelection === "function"
            ? window.getSelection()
            : null;
        return !!selection && !selection.isCollapsed && selection.toString() !== "";
    },

    /**
     * Sets up all event listeners used by the terminal: viewport resize
     * handling (for mobile keyboards), click-to-focus behavior, the main
     * keydown handler for the hidden input field (which drives typing,
     * history, pager, and readline-style shortcuts), and paste handling.
     * Called once from the constructor.
     */
    bindEvents() {

        // Keeps a CSS variable in sync with the visual viewport height so
        // layout can react correctly when mobile on-screen keyboards appear.
        function updateVisualViewportHeight() {
            if (window.visualViewport) {
                const layoutHeight = window.visualViewport.height;
                document.documentElement.style.setProperty('--visual-vh', `${layoutHeight}px`);
            }
        }

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateVisualViewportHeight);
            window.visualViewport.addEventListener('scroll', updateVisualViewportHeight);
        }

        window.addEventListener('DOMContentLoaded', updateVisualViewportHeight);

        // Recompute how many lines fit on screen (for the pager) on window resize
        window.addEventListener("resize", () => {
            this.pager.pageSize = this.getPageSize();
        });

        // Clicking anywhere in the page should refocus whichever input
        // surface is currently active (the hidden text input for normal
        // shell use, or the editor textarea when the full-screen editor is
        // open). A single document-level listener covers clicks inside
        // #output too, since it bubbles up from there - no separate
        // listener needed on #output itself.
        //
        // The one exception is when the click is the end of a text
        // selection (a drag, or a double-click on a word): focusing an
        // input clears the page's selection, which would make it
        // impossible to select and copy anything from the output. The
        // input is left unfocused in that case; the document-level
        // keydown listener further down brings focus back as soon as a
        // key is pressed.
        const focusActiveInput = () => {
            if (this.inputMode === INPUT_EDITOR) {
                this.editorEl.focus();
            } else {
                this.hiddenInput.focus();
            }
        };

        document.addEventListener("click", () => {
            if (this.hasTextSelection()) {
                return;
            }
            focusActiveInput();
        });

        document.addEventListener("pointerdown", () => {
            focusActiveInput();
        });

        // On mobile, when the on-screen keyboard opens/closes the visual
        // viewport resizes; keep the page scrolled to the bottom so input stays visible.
        if (window.visualViewport) {
            visualViewport.addEventListener("resize", () => {
                window.scrollTo(0, document.body.scrollHeight);
            });
        }

        // Keydown handler used while the full-screen editor is active
        // (wired up separately in editor.js when the editor opens).
        this.editorKeyHandler = (event) => {

            // Ctrl+S: save the file being edited
            if (event.ctrlKey && event.key.toLowerCase() === "s") {
                event.preventDefault();
                this.saveEditor();
                return;
            }

            // Ctrl+X: save and exit the editor
            if (event.ctrlKey && event.key.toLowerCase() === "x") {
                event.preventDefault();
                this.closeEditor(true);
                return;
            }

            // Escape: exit the editor without saving. If there are unsaved
            // changes the first press only asks, and a second press
            // confirms - see closeEditor() in editor.js.
            if (event.key === "Escape") {
                event.preventDefault();
                this.closeEditor(false);
                return;
            }

            // A modifier key on its own (e.g. the Ctrl of a coming Ctrl+S)
            // is not an answer to anything.
            if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"].includes(event.key)) {
                return;
            }

            // Any other key means "keep editing": it withdraws a pending
            // "press Esc again to discard" question.
            this.resumeEditing();
            this.editor.modified = true;
        };

        // Text arriving in the editor without a usable keydown (touch
        // keyboards, dictation, paste from a menu) also means "keep
        // editing". Attached/detached alongside editorKeyHandler in
        // editor.js.
        this.editorInputHandler = () => {
            this.resumeEditing();
            this.editor.modified = true;
        };

        // Main keydown handler for normal shell input (also handles pager
        // keys). Kept as a named function because two listeners feed it:
        // the hidden input's own keydown, and the document-level one
        // below for keys pressed while the hidden input isn't focused.
        //
        // Browser shortcuts: a key combination is only taken away from the
        // browser (preventDefault) when the terminal actually does
        // something with it. Everything else - Ctrl+R reload, Ctrl+F
        // find, Ctrl+plus/minus zoom, Ctrl+P print, F5, F12 and so on -
        // is left alone.
        this.handleKeyDown = (e) => {

            // Ctrl+C with text selected means "copy", as in most modern
            // terminals: leave it to the browser and don't treat it as an
            // interrupt. With nothing selected it keeps its terminal
            // meaning (stop the running command / clear the typed line).
            const isCtrlC = e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c";
            if (isCtrlC && this.hasTextSelection()) {
                return;
            }
            const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

            // While the pager ("--More--") is showing, only space/enter (advance)
            // and 'q' (quit paging) are meaningful; swallow every other
            // plain key (browser shortcuts still work).
            if (this.pager.active) {
                // Ctrl+C at a "--More--" prompt stops the command outright
                // (requestInterrupt() also closes the prompt).
                if (isCtrlC) {
                    e.preventDefault();
                    this.requestInterrupt();
                    return;
                }
                if (hasModifier) {
                    return;
                }
                e.preventDefault();

                if (e.key === " " || e.key === "Enter") {
                    this.output.lastChild.remove(); // remove the "--More--" line
                    this.pager.active = false;
                    this.pager.linesPrinted = 0;
                    this.pager.resolver();
                }

                if (e.key === "q") {
                    this.output.lastChild.remove();
                    this.pager.active = false;
                    this.pager.linesPrinted = 0;
                    this.pager.resolver(false); // signal "quit early" to the pager consumer
                }
                return;
            }

            // While an IME/predictive-text composition is in progress (common
            // on Android keyboards, and required for CJK input methods), let
            // it finish uninterrupted. The composed result will show up via
            // the "input" listener below rather than being built here from
            // individual keydown events, which mobile keyboards often don't
            // fire in a usable form (e.key === "Unidentified", etc.).
            if (e.isComposing || e.keyCode === 229) {
                return;
            }

            // Readline-style Ctrl+<key> shortcuts (Ctrl+C, Ctrl+L, Ctrl+A, etc.)
            // A command is still running. Ctrl+C stops it; every other key
            // is ignored until it finishes, so nothing typed in the
            // meantime can pile up or start a second command on top of
            // the first. (Browser shortcuts - anything with Ctrl, Cmd or
            // Alt held - are left alone.)
            if (this.busy) {
                if (isCtrlC) {
                    e.preventDefault();
                    this.requestInterrupt();
                    return;
                }
                if (!hasModifier) {
                    e.preventDefault();
                }
                return;
            }

            if (e.ctrlKey && !e.metaKey && !e.altKey) {
                switch (e.key.toLowerCase()) {
                    case "c": // Ctrl+C: cancel the current input line
                        e.preventDefault();
                        this.cancelCommand();
                        this.syncHiddenInput();
                        this.renderInput();
                        return;

                    case "l": // Ctrl+L: clear the screen
                        e.preventDefault();
                        this.clearScreen();
                        this.renderInput();
                        return;

                    case "v": // Ctrl+V: let the browser's native paste event handle it
                        return;

                    case "a": // Ctrl+A: move cursor to start of line
                        e.preventDefault();
                        this.cursorPos = 0;
                        this.syncHiddenInput();
                        this.renderInput();
                        return;

                    case "e": // Ctrl+E: move cursor to end of line
                        e.preventDefault();
                        this.cursorPos = this.currentInput.length;
                        this.syncHiddenInput();
                        this.renderInput();
                        return;

                    case "u": // Ctrl+U: delete from cursor to start of line
                        e.preventDefault();
                        this.currentInput = this.currentInput.slice(this.cursorPos);
                        this.cursorPos = 0;
                        this.syncHiddenInput();
                        this.renderInput();
                        return;

                    case "k": // Ctrl+K: delete from cursor to end of line
                        e.preventDefault();
                        this.currentInput = this.currentInput.slice(0, this.cursorPos);
                        this.syncHiddenInput();
                        this.renderInput();
                        return;

                    case "w": { // Ctrl+W: delete the word immediately before the cursor
                        e.preventDefault();
                        const before = this.currentInput.slice(0, this.cursorPos);
                        const after = this.currentInput.slice(this.cursorPos);
                        // Strip trailing whitespace, then strip the trailing "word"
                        const trimmedBefore = before.replace(/\s+$/, "").replace(/\S+$/, "");
                        this.currentInput = trimmedBefore + after;
                        this.cursorPos = trimmedBefore.length;
                        this.syncHiddenInput();
                        this.renderInput();
                        return;
                    }

                    default:
                        // Not a terminal shortcut: leave it to the browser
                        // (reload, find, zoom, print, ...). Returning here
                        // also keeps the letter from being typed.
                        return;
                }
            }

            switch (e.key) {

                case "Enter":
                    this.handleEnter();
                    break;

                case "Backspace":
                    e.preventDefault();
                    if (this.cursorPos === 0) break;
                    this.currentInput =
                        this.currentInput.slice(0, this.cursorPos - 1) +
                        this.currentInput.slice(this.cursorPos);
                    this.cursorPos--;
                    break;                    

                case "ArrowUp":
                    this.historyUp();
                    break;

                case "ArrowDown":
                    this.historyDown();
                    break;

                case "ArrowLeft":
                    this.cursorPos = Math.max(0, this.cursorPos - 1);
                    break;

                case "ArrowRight":
                    this.cursorPos = Math.min(this.currentInput.length, this.cursorPos + 1);
                    break;

                case "Tab":
                    e.preventDefault();
                    this.autocomplete();
                    break;

                default:
                    // While waiting for a password, ignore printable keys entirely
                    // (password input isn't echoed/stored by this handler).
                    if (this.inputMode === INPUT_WAIT_FOR_PASSWORD){break;}

                    // Any single printable character (no modifier keys) gets
                    // inserted into currentInput at the cursor position.
                    // Recognized here means a normal physical-keyboard keydown
                    // reported a real, single-character e.key; anything else
                    // (predictive text, swipe-typing, autocorrect, IME
                    // composition - common on mobile keyboards, where e.key is
                    // often "Unidentified" or the event doesn't fire per
                    // character) is left for the "input" listener below to
                    // pick up from the native input value instead.
                    if (e.key.length === 1 &&
                        !e.metaKey &&
                        !e.altKey &&
                        !e.ctrlKey) {
                            e.preventDefault();
                            this.currentInput =
                                this.currentInput.slice(0, this.cursorPos) +
                                e.key +
                                this.currentInput.slice(this.cursorPos);
                            this.cursorPos++;
                        }
                    break;
            }
            // Keep the native hidden input's value/caret aligned with
            // whatever we just did above (including Arrow-key cursor moves,
            // which the browser also moves natively but we treat our own
            // tracking as the source of truth for consistency).
            this.syncHiddenInput();
            this.renderInput();
        };

        this.hiddenInput.addEventListener("keydown", this.handleKeyDown);

        // Keys pressed while the hidden input does NOT have focus. That
        // happens after selecting text in the output with the mouse (see
        // the click listener above, which deliberately leaves the input
        // unfocused then). Typing should simply work again, so focus goes
        // back to the hidden input and the key is handled as usual -
        // except for keys that act on the selection itself, which must
        // not move focus (moving it clears the selection):
        //   - a modifier key on its own (the "Ctrl" of a coming Ctrl+C)
        //   - anything with Cmd held (Cmd+C / Cmd+A on macOS)
        //   - Ctrl+C / Ctrl+Insert / Ctrl+A with text selected
        //   - Shift+arrows (extend the selection) and the scrolling keys
        const SELECTION_KEYS = new Set([
            "Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "ContextMenu",
            "PageUp", "PageDown", "Home", "End"
        ]);
        document.addEventListener("keydown", (e) => {
            if (e.target === this.hiddenInput || this.inputMode === INPUT_EDITOR) {
                return; // the hidden input's / the editor's own listener has it
            }
            if (SELECTION_KEYS.has(e.key) || e.metaKey) {
                return;
            }
            if (e.shiftKey && e.key.startsWith("Arrow")) {
                return;
            }
            if (e.ctrlKey && this.hasTextSelection() &&
                ["c", "a", "insert"].includes(e.key.toLowerCase())) {
                return;
            }
            this.hiddenInput.focus();
            this.handleKeyDown(e);
        });

        // Handles pasting text into the shell: strips newlines (collapsing
        // multi-line paste into a single line, like a real terminal would
        // otherwise try to "run" each line) and inserts it at the cursor.
        this.hiddenInput.addEventListener("paste", (e) => {
            if (this.busy) {
                // Nothing can be typed while a command is running
                e.preventDefault();
                return;
            }
            if (this.inputMode !== INPUT_NORMAL || this.pager.active) {
                return;
            }
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData("text");
            if (!text) {
                return;
            }
            const clean = text.replace(/\r\n?/g, "\n").replace(/\n/g, " ");
            this.currentInput =
                this.currentInput.slice(0, this.cursorPos) +
                clean +
                this.currentInput.slice(this.cursorPos);
            this.cursorPos += clean.length;
            this.syncHiddenInput();
            this.renderInput();
        });

        // Fallback for content a mobile keyboard commits without a usable
        // keydown (autocorrect replacements, swipe-typing whole words, IME
        // composition results). The native input's value/caret is the
        // source of truth here since keydown's e.key can't be trusted for
        // these cases - by the time this fires, our preventDefault() calls
        // above mean it only runs for edits WE didn't already apply.
        this.hiddenInput.addEventListener("input", () => {
            if (this.busy) {
                // Text that arrives this way while a command is running
                // (mobile keyboards, dictation) is thrown away, the same
                // as key presses are.
                this.hiddenInput.value = "";
                return;
            }
            if (this.inputMode === INPUT_WAIT_FOR_PASSWORD ||
                this.inputMode === INPUT_EDITOR ||
                this.pager.active) {
                return;
            }
            this.currentInput = this.hiddenInput.value;
            this.cursorPos = this.hiddenInput.selectionStart ?? this.currentInput.length;
            this.renderInput();
        });

        // On-screen Tab/Esc buttons (touch devices only - see terminal.css).
        // mousedown is prevented so tapping the button doesn't blur/steal
        // focus away from whichever input surface is currently active.
        const mobileTabBtn = document.getElementById("mobile-tab-btn");
        if (mobileTabBtn) {
            mobileTabBtn.addEventListener("mousedown", (e) => e.preventDefault());
            mobileTabBtn.addEventListener("click", () => {
                if (this.inputMode !== INPUT_NORMAL || this.busy) return;
                this.autocomplete();
                this.syncHiddenInput();
                this.renderInput();
                this.hiddenInput.focus();
            });
        }

        // Touch keyboards have no Ctrl key, so this button is the only way
        // to stop a running command on a phone. Only shown while a
        // command is running (see body.command-running in terminal.css).
        const mobileStopBtn = document.getElementById("mobile-stop-btn");
        if (mobileStopBtn) {
            mobileStopBtn.addEventListener("mousedown", (e) => e.preventDefault());
            mobileStopBtn.addEventListener("click", () => {
                this.requestInterrupt();
                this.hiddenInput.focus();
            });
        }

        // Editor buttons for touch devices, which have no Ctrl or Esc
        // key: Save (Ctrl+S), Save & Exit (Ctrl+X) and Esc. Only shown
        // while the editor is open (see body.editor-mode in terminal.css).
        // mousedown is cancelled on each so that tapping a button doesn't
        // take focus (and the on-screen keyboard) away from the editor.
        const mobileEditorButtons = {
            "mobile-save-btn": () => this.saveEditor(),
            "mobile-save-exit-btn": () => this.closeEditor(true),
            // Esc: with unsaved changes the first tap only asks (the
            // button then reads "Discard changes"); a second tap confirms.
            "mobile-esc-btn": () => this.closeEditor(false)
        };
        for (const [id, action] of Object.entries(mobileEditorButtons)) {
            const button = document.getElementById(id);
            if (!button) continue;
            button.addEventListener("mousedown", (e) => e.preventDefault());
            button.addEventListener("click", action);
        }
    },

    // Keeps the (invisible) native #hidden-input element's value and caret
    // position in sync with our own currentInput/cursorPos tracking.
    // Needed whenever we edit currentInput ourselves rather than letting the
    // browser apply its own native edit: setting .value alone resets the
    // native caret to the end of the string, so without this, the next
    // native edit a mobile keyboard makes (autocorrect, swipe-typing, IME)
    // would start from the wrong position - and the "input" event fallback
    // listener needs an accurate baseline to read from.
    syncHiddenInput() {
        this.hiddenInput.value = this.currentInput;
        this.hiddenInput.setSelectionRange(this.cursorPos, this.cursorPos);
    },

    /**
     * Handles the Enter key across all input modes: executing a shell
     * command in normal mode, or advancing the username/password login
     * prompt flow. Also persists settings and re-focuses input afterward.
     */
    /**
     * Expands "!!" (the previous command) and "!N" (history entry N,
     * 1-indexed to match how `history` displays it) anywhere they appear
     * in `input`, matching real bash's basic history expansion. Runs
     * BEFORE the expanded line is recorded into history or echoed to the
     * screen, so both reflect the actual command that's about to run
     * rather than the literal "!!"/"!N" text - and so a reference never
     * points at itself.
     *
     * Deliberately QUOTE-BLIND, matching real bash: history expansion
     * happens at the readline layer before the shell has any concept of
     * quoting, so `echo '!!'` and `echo "!!"` both still expand in a real
     * interactive bash - this is the well-known gotcha behind e.g.
     * `git commit -m "fix the bug!"` failing with `bash: !": event not
     * found`. The ONLY thing that suppresses expansion, in bash or here,
     * is a backslash immediately before the "!" - which this consumes
     * (removes) as part of expansion, same as bash does, regardless of
     * whether that backslash sits inside quotes or not (history expansion
     * can't see quotes to begin with, so it can't treat a backslash
     * inside them any differently).
     * @param {string} input - Raw input line, not yet recorded in history.
     * @returns {{text: string}|{error: string}} The expanded line, or the
     *   specific "!..." reference that couldn't be resolved.
     */
    expandHistoryReferences(input) {
        let error = null;
        let result = "";

        for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (ch === "\\" && input[i + 1] === "!") {
                // Backslash-escaped "!" - not a history reference at all;
                // consume the backslash (bash does too) and keep the "!" literal.
                result += "!";
                i++;
                continue;
            }

            if (!error && ch === "!") {
                const rest = input.slice(i + 1);
                const numMatch = rest.match(/^\d+/);

                if (rest[0] === "!") {
                    if (this.history.length === 0) {
                        error = "!!";
                        result += ch;
                        continue;
                    }
                    result += this.history[this.history.length - 1];
                    i += 1; // also consumed the second "!"
                    continue;
                }

                if (numMatch) {
                    const n = parseInt(numMatch[0], 10);
                    if (n < 1 || n > this.history.length) {
                        error = `!${numMatch[0]}`;
                        result += ch;
                        continue;
                    }
                    result += this.history[n - 1];
                    i += numMatch[0].length;
                    continue;
                }
            }

            result += ch;
        }

        return error ? { error } : { text: result };
    },

    async handleEnter() {
        // One command at a time: Enter does nothing while the previous
        // command is still running.
        if (this.busy) {
            return;
        }
        let input = this.currentInput.trim();

        switch (this.inputMode) {
            case INPUT_NORMAL:
                if (!input){
                    // Empty line: just print a fresh prompt, nothing to run
                    this.write(`${DEFAULT_USER}@${HOSTNAME}:${this.cwd}$`);
                    document.getElementById("scroll-anchor").scrollIntoView({block: "end"});
                    return;
                }
                if (input === "reset"){
                    // Special-cased hard reset: wipe saved state and reload the page
                    localStorage.removeItem(STORAGE_KEY_SETTINGS);
                    localStorage.removeItem(STORAGE_KEY_FILESYSTEM);
                    location.reload();
                    return;
                } 

                // History expansion ("!!", "!N") - resolved before this
                // line is recorded into history or echoed, so both show
                // the actual command rather than the literal reference.
                let historyExpansionFailed = false;
                if (input.includes("!")) {
                    const expansion = this.expandHistoryReferences(input);
                    if (expansion.error) {
                        historyExpansionFailed = true;
                        this.write(`${DEFAULT_USER}@${HOSTNAME}:${this.cwd}$ ${input}`);
                        this.write(this.formatErrorLine(`${expansion.error}: event not found`));
                    } else {
                        input = expansion.text;
                    }
                }

                if (!historyExpansionFailed) {
                    // Record the command in history (capped to MAX_HISTORY
                    // entries - see constants.js). Very long lines (e.g. a
                    // huge paste) still run, but aren't remembered, so
                    // history can't fill up browser storage.
                    if (input.length <= MAX_HISTORY_ENTRY_CHARS) {
                        this.history.push(input);
                    }
                    if (this.history.length > MAX_HISTORY) {
                        this.history.shift();
                    }
                    this.historyIndex = this.history.length;
                    this.write(`${DEFAULT_USER}@${HOSTNAME}:${this.cwd}$ ${input}`);

                    // Hide the live input line while the command runs, then
                    // restore it. `busy` blocks typing and Enter for the
                    // same period (see the keydown handler above).
                    document.getElementById("input-line").classList.add("hidden");
                    document.body?.classList.add("command-running");
                    this.busy = true;
                    this.interruptRequested = false;
                    try {
                        await this.execute(input);
                    } catch (err) {
                        if (err instanceof TerminalInterrupt) {
                            // Ctrl+C: the command has stopped
                            this.write("^C");
                            this.lastExitCode = EXIT_INTERRUPTED;
                        } else {
                            // A bug in a command or in the shell itself.
                            // Report it and carry on, rather than leaving
                            // the terminal stuck half-way through a command.
                            console.error("Torvos: command failed unexpectedly", err);
                            this.write(this.formatErrorLine(`shell: internal error: ${err?.message ?? err}`));
                            this.lastExitCode = EXIT_FAILURE;
                        }
                    } finally {
                        this.busy = false;
                        this.interruptRequested = false;
                        document.body?.classList.remove("command-running");
                        document.getElementById("input-line").classList.remove("hidden");
                    }
                }

                this.hiddenInput.focus();
                this.currentInput = "";
                this.renderInput();
                break;
            case INPUT_WAIT_FOR_USERNAME:
                // Username entered (value itself isn't checked); move on to password prompt
                this.currentInput = "";
                this.renderInput();
                this.inputMode = INPUT_WAIT_FOR_PASSWORD;
                this.promptEl.textContent = "password:";
                this.setInputLabel("Password (what you type is not shown)");
                break;
            case INPUT_WAIT_FOR_PASSWORD:
                // This demo login flow always fails after a password attempt
                this.write("Login incorrect")
                this.currentInput = "";
                this.renderInput();
                this.inputMode = INPUT_NORMAL;
                this.renderPrompt();
                break;
        }
        document.getElementById("hidden-input").value = "";
        this.cursorPos = 0;
        this.saveSettings();
        this.scrollToBottom();
    },

    // Handles Ctrl+C: prints "^C" and discards the current input line.
    cancelCommand() {
        this.write("^C");
        this.currentInput = "";
        this.renderInput();
    },

    // Moves backward (older) through command history, like pressing Up in a real shell.
    historyUp() {
        if (this.history.length === 0) return;
        if (this.historyIndex > 0) {
            this.historyIndex--;
        }
        this.currentInput = this.history[this.historyIndex] || "";
        this.cursorPos = this.currentInput.length;
        this.syncHiddenInput();
        this.renderInput();
    },

    // Moves forward (newer) through command history; past the newest entry clears the line.
    historyDown() {
        if (this.history.length === 0) return;
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.currentInput = this.history[this.historyIndex];
        } else {
            this.currentInput = "";
        }
        this.cursorPos = this.currentInput.length;
        this.syncHiddenInput();
        this.renderInput();
    },

    /**
     * Handles Tab-key autocompletion for the word at the cursor - not
     * necessarily the last word on the line, so completing an earlier
     * argument doesn't disturb anything typed after it. That word spans
     * from the nearest whitespace before the cursor to the nearest
     * whitespace after it (so completing mid-word replaces the whole
     * word, not just the part before the cursor).
     *
     * If the word is the very first one on the line and doesn't already
     * look like a path (no "/"), it's completed against known command and
     * alias names; otherwise it's completed as a filesystem path relative
     * to cwd. Then, like bash:
     *   - no match: nothing changes
     *   - one match: the word is completed
     *   - several matches: the word is completed as far as they all
     *     agree (their longest common prefix); if that adds nothing, the
     *     candidates are listed under the prompt instead, and the typed
     *     line is left as it was
     */
    autocomplete() {
        if (this.inputMode !== INPUT_NORMAL) return;
        if (!this.currentInput.trim()) return;

        const input = this.currentInput;
        const before = input.slice(0, this.cursorPos);
        const after = input.slice(this.cursorPos);

        const wordStart = before.search(/\S*$/);
        const wordEnd = this.cursorPos + after.match(/^\S*/)[0].length;

        const partial = before.slice(wordStart);      // text to match, up to the cursor
        const linePrefix = input.slice(0, wordStart);  // everything before this word
        const lineSuffix = input.slice(wordEnd);       // everything after this word

        // Nothing but whitespace before this word -> it's the first word
        // on the line (a command name), unless it already looks like a path.
        const isFirstWord = linePrefix.trim() === "";

        let matches;
        if (isFirstWord && !partial.includes(ROOT)) {
            const names = new Set([
                ...Object.keys(window.Commands),
                ...Object.keys(this.aliases)
            ]);
            matches = [...names].filter(name => name.startsWith(partial)).sort();
        } else {
            matches = this.findPathMatches(partial).sort();
        }

        if (matches.length === 0) {
            return;
        }

        // The longest text every candidate starts with. With a single
        // candidate that is the candidate itself.
        let completion = matches[0];
        for (const match of matches) {
            let shared = 0;
            while (shared < completion.length && completion[shared] === match[shared]) {
                shared++;
            }
            completion = completion.slice(0, shared);
        }

        if (matches.length > 1 && completion.length <= partial.length) {
            // Several candidates and nothing more to fill in: show them.
            // For paths only the last segment is shown ("docs/" rather
            // than "/home/guest/docs/"), as in a real shell.
            const MAX_LISTED = 100;
            const labels = matches.slice(0, MAX_LISTED).map(match => {
                const trimmed = match.endsWith(ROOT) ? match.slice(0, -1) : match;
                return match.slice(trimmed.lastIndexOf(ROOT) + 1);
            });
            if (matches.length > MAX_LISTED) {
                labels.push(`... and ${matches.length - MAX_LISTED} more`);
            }
            this.write(`${DEFAULT_USER}@${HOSTNAME}:${this.cwd}$ ${input}`);
            // Laid out in equal-width columns that fit the screen, so a
            // name is never broken across two lines on a narrow screen.
            const columnWidth = Math.max(...labels.map(label => label.length)) + 2;
            const perRow = Math.max(1, Math.floor(this.getColumns() / columnWidth));
            for (let i = 0; i < labels.length; i += perRow) {
                const row = labels.slice(i, i + perRow)
                    .map(label => label.padEnd(columnWidth))
                    .join("")
                    .trimEnd();
                this.write(row, { color: COLOR_STDOUT });
            }
            return;
        }

        this.currentInput = linePrefix + completion + lineSuffix;
        this.cursorPos = (linePrefix + completion).length;
        this.syncHiddenInput();
        this.renderInput();
    },

    /**
     * Finds filesystem entries under the appropriate directory whose name
     * starts with the given partial path's final segment, used for path
     * autocompletion. Handles both absolute-ish partials containing "/"
     * and bare names relative to the current working directory.
     * @param {string} partial - The partial path typed by the user so far.
     * @returns {string[]} Matching completions, each with a trailing "/"
     *   if the match is itself a directory.
     */
    findPathMatches(partial) {

        let directory;
        let prefix;

        if (partial.includes(ROOT)) {
            // Split off everything after the last "/" as the prefix to match,
            // and resolve the directory portion before it.
            const split = partial.split(ROOT);
            prefix = split.pop();

            directory = split.join(ROOT);

            if (directory === "") {
                directory = ROOT;
            } else {
                directory = this.fs.getFullPath(directory, this.cwd);
            }

        } else {
            // No "/" in the partial - match against entries in the current directory
            directory = this.cwd;
            prefix = partial;
        }

        const node = this.fs.getNode(directory);

        if (!node || !this.fs.isDirectory(node)) {
            return [];
        }

        return Object.keys(node.children)
            .filter(name => name.startsWith(prefix))
            // Like a real shell, hidden (dot) files are only offered once
            // the user has typed the leading "."
            .filter(name => prefix.startsWith(".") || !name.startsWith("."))
            .map(name => {
                const child = node.children[name];

                // Preserve the directory portion of the original partial as a prefix
                // on each completion result.
                const base = partial.includes(ROOT)
                    ? partial.substring(0, partial.lastIndexOf(ROOT) + 1)
                    : "";

                return base + name + (this.fs.isDirectory(child) ? ROOT : "");
            });
    }

});
