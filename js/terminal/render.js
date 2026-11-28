/**
 * Rendering-related methods for TerminalEngine: writing lines to the
 * output pane, drawing the prompt/input line with a blinking cursor,
 * animated "typewriter" text, and the pager's "--More--" break.
 */
Object.assign(TerminalEngine.prototype, {

    // Scrolls the terminal output container to the bottom (used after
    // any new content is appended so the latest line stays in view).
    scrollToBottom() {
        const terminal = document.getElementById("terminal");
        terminal.scrollTop = terminal.scrollHeight;
    },

    // Redraws the shell prompt text (user@host:cwd$ ) based on current state.
    renderPrompt() {
        this.promptEl.textContent =
            `${DEFAULT_USER}@${HOSTNAME}:${this.cwd}$ `;
        this.setInputLabel("Terminal command input");
    },

    /**
     * Sets the name screen readers announce for the (invisible) input
     * the user actually types into. The visible prompt next to it is
     * decorative as far as assistive technology is concerned (it is
     * aria-hidden in index.html), so whenever the prompt changes meaning
     * - the shell prompt, "user:", "password:" - this has to say so.
     * @param {string} label
     */
    setInputLabel(label) {
        this.hiddenInput.setAttribute("aria-label", label);
    },

    /**
     * Lists the links currently shown in the output, in the order they
     * first appear, each once. Used by the `open` command so links can
     * be chosen by number from the keyboard.
     * @returns {Array<{text: string, href: string, type: "url"|"email"}>}
     */
    listLinks() {
        const seen = new Set();
        const links = [];
        for (const anchor of this.output.querySelectorAll("a")) {
            const href = anchor.getAttribute("href");
            if (!href || seen.has(href)) continue;
            seen.add(href);
            links.push({
                text: anchor.textContent,
                href,
                type: href.startsWith("mailto:") ? "email" : "url"
            });
        }
        return links;
    },

    /**
     * Opens a link exactly as clicking it would: by activating a real
     * (invisible, temporary) <a> element, so the browser applies its
     * normal rules for links and pop-ups.
     * @param {string} href - The address. Callers only pass http(s) and
     *   mailto addresses produced by findLinks().
     * @param {boolean} newTab - true for web pages; false for email
     *   addresses, which hand over to the mail program instead.
     */
    openLink(href, newTab) {
        const anchor = document.createElement("a");
        anchor.href = href;
        if (newTab) {
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
        }
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    },

    /**
     * Takes the box off boxed output when the box is too wide for the
     * screen.
     *
     * Some output is drawn inside a box of "+", "-" and "|" characters
     * (contact.md, for example). On a screen narrower than the box,
     * every row would wrap and the box would fall apart into stray
     * fragments. When that would happen, the border rows are dropped and
     * the side bars are removed from the rows in between, leaving the
     * text. Output whose boxes fit - and output with no box at all - is
     * returned unchanged.
     *
     * Pure text in, text out; only used for what is shown on screen.
     * Pipes and redirects always get a command's original output.
     *
     * @param {string[]} lines - The output, one entry per line.
     * @param {number} columns - Characters that fit on one line.
     * @returns {string[]} The lines to display.
     */
    fitBoxes(lines, columns) {
        const isBorder = (line) => /^\s*\+[-=+]{2,}\+\s*$/.test(line);
        const rowPattern = /^\s*\|(.*)\|\s*$/;
        const tooWide = lines.some(line => isBorder(line) && line.trimEnd().length > columns);
        // Only a real box counts: a border AND at least one row between
        // bars. A lone border line (say, the first line of a box cut off
        // by `head -n 1`) is left alone rather than shown as nothing.
        if (!tooWide || !lines.some(line => rowPattern.test(line))) {
            return lines;
        }
        const result = [];
        for (const line of lines) {
            if (isBorder(line)) {
                continue;
            }
            const row = line.match(rowPattern);
            // Drop the one space of padding after the left bar, keep any
            // further indentation, and drop the padding before the right bar.
            result.push(row ? row[1].replace(/^ /, "").trimEnd() : line);
        }
        return result;
    },

    /**
     * Removes the oldest lines of output once there are more than
     * MAX_SCROLLBACK_LINES (see constants.js). Called after every line
     * is added, so normally it removes at most one.
     */
    trimScrollback() {
        while (this.output.childElementCount > MAX_SCROLLBACK_LINES) {
            this.output.firstElementChild.remove();
        }
    },

    /**
     * Adds a line that only screen readers get: it takes up no space and
     * is invisible on screen. Used to give a text equivalent for output
     * that is purely visual (e.g. the block-art banner, which is hidden
     * from screen readers with write()'s ariaHidden option).
     * @param {string} text
     */
    writeForScreenReaders(text) {
        const div = document.createElement("div");
        div.className = "sr-only";
        div.textContent = text;
        this.output.appendChild(div);
        this.trimScrollback();
    },

    // Redraws the current input line, splitting it into "before cursor" /
    // cursor block / "after cursor" spans so the cursor can be rendered
    // as a solid block at the correct position.
    renderInput() {
        const before = this.currentInput.slice(0, this.cursorPos);
        const after = this.currentInput.slice(this.cursorPos);

        const beforeSpan = document.createElement("span");
        beforeSpan.textContent = before;

        const cursorSpan = document.createElement("span");
        cursorSpan.id = "cursor";
        cursorSpan.textContent = "█";

        const afterSpan = document.createElement("span");
        afterSpan.textContent = after;

        this.commandEl.replaceChildren(beforeSpan, cursorSpan, afterSpan);

        // A long command wraps onto extra rows; keep the row being typed
        // on in view. Only done when the text or cursor actually changed,
        // so a key that edits nothing can't drag the view back down while
        // someone is scrolled up reading.
        const state = `${this.cursorPos}:${this.currentInput}`;
        if (state !== this._lastRenderedInput) {
            this._lastRenderedInput = state;
            this.scrollToBottom();
        }
    },

    // Clears all terminal output (used by the `clear`/`reset` commands).
    clearScreen() {
        this.output.replaceChildren();
    },

    /**
     * Finds the http(s) URLs and email addresses in a piece of plain text
     * and splits it into an ordered list of parts:
     *   { type: "text",  text }
     *   { type: "url",   text, href }
     *   { type: "email", text, href }
     * Joining every part's `text` back together always reproduces the
     * input exactly - nothing is added, dropped, or escaped here.
     *
     * This is pure string work with no DOM access, so it is safe to call
     * anywhere (and to unit-test in Node). It never produces markup:
     * write() turns the parts into real DOM nodes, so the text of a link
     * can never be parsed as HTML no matter what it contains.
     *
     * Rules:
     *   - URLs and emails are found in ONE left-to-right pass, so an
     *     address inside a URL ("https://user@example.com/") stays part
     *     of that URL instead of being linked a second time.
     *   - Only http: and https: URLs that the browser's own URL parser
     *     accepts become links. Anything else stays plain text.
     *   - Sentence punctuation right after a URL ("see https://x.com.")
     *     and a closing bracket/quote that was opened BEFORE the URL
     *     ("(https://x.com)") are left out of the link. A bracket that
     *     is balanced inside the URL ("/wiki/Rust_(language)") is kept.
     *
     * @param {string} text - Plain text to scan.
     * @returns {Array<{type: string, text: string, href?: string}>}
     */
    findLinks(text) {
        const source = String(text ?? "");
        const parts = [];
        const pushText = (str) => {
            if (!str) return;
            const last = parts[parts.length - 1];
            if (last && last.type === "text") {
                last.text += str;
            } else {
                parts.push({ type: "text", text: str });
            }
        };

        // Group 1: a URL. Stops at whitespace and at the characters that
        // can't appear raw in a URL and usually delimit one in prose.
        // Group 2: an email address (same shape as before).
        const pattern = /\b(https?:\/\/[^\s<>"`]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9])/gi;

        const CLOSERS = { ")": "(", "]": "[", "}": "{" };
        const count = (str, ch) => str.split(ch).length - 1;

        // Removes trailing characters that belong to the surrounding
        // sentence rather than to the URL itself.
        const trimUrl = (url) => {
            let end = url.length;
            while (end > 0) {
                const ch = url[end - 1];
                // Sentence punctuation, plus the typographic ellipsis and
                // closing quotes word processors substitute for the
                // plain ones.
                if (".,;:!?'*\u2026\u201D\u2019\u00BB\u203A".includes(ch)) {
                    end--;
                    continue;
                }
                if (CLOSERS[ch]) {
                    const body = url.slice(0, end);
                    // Keep the closer only if it has a matching opener
                    // inside the URL.
                    if (count(body, ch) > count(body, CLOSERS[ch])) {
                        end--;
                        continue;
                    }
                }
                break;
            }
            return url.slice(0, end);
        };

        let cursor = 0;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            let linkText;
            let part = null;

            if (match[1] !== undefined) {
                linkText = trimUrl(match[1]);
                let parsed = null;
                try {
                    parsed = new URL(linkText);
                } catch {
                    parsed = null;
                }
                if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
                    // href is the browser-normalized form; the visible
                    // text stays exactly what was printed.
                    part = { type: "url", text: linkText, href: parsed.href };
                }
            } else {
                linkText = match[2];
                part = { type: "email", text: linkText, href: "mailto:" + encodeURI(linkText) };
            }

            pushText(source.slice(cursor, match.index));
            if (part) {
                parts.push(part);
            } else {
                pushText(linkText);
            }
            cursor = match.index + linkText.length;
            // Resume scanning right after what was consumed, so trimmed
            // punctuation is re-read as ordinary text.
            pattern.lastIndex = Math.max(cursor, match.index + 1);
        }
        pushText(source.slice(cursor));
        return parts;
    },

    /**
     * Appends a line of text to the terminal output.
     * URLs and email addresses in the text become clickable links (see
     * findLinks() above). Everything is inserted as DOM text nodes and
     * elements - never as an HTML string - so user/file content can't
     * inject markup.
     *
     * Supports two calling styles:
     *   - Whole-line color (legacy, still works exactly as before):
     *       terminal.write("disk not found", { color: "#ff6060" });
     *   - Multiple colors within a single line, by passing an array of
     *     { text, color } segments instead of a string. Segments with no
     *     color inherit the terminal's default text color:
     *       terminal.write([
     *           { text: "error: ", color: "#ff6060" },
     *           { text: "disk not found" }
     *       ]);
     *
     * @param {string|Array<{text: string, color?: string}>} text - The line
     *   to print, or an array of colored segments making up the line.
     * @param {Object} [options] - Optional rendering options.
     * @param {string} [options.color] - CSS color for the whole line, used
     *   only when `text` is a plain string.
     * @param {boolean} [options.scroll=true] - Pass false to skip scrolling
     *   to the bottom after this line.
     * @param {boolean} [options.ariaHidden=false] - Pass true for purely
     *   decorative lines (block art, box borders) so screen readers skip
     *   them; pair with writeForScreenReaders() if they carry meaning.
     */
    write(text, options = {}) {
        const div = document.createElement("div");
        if (options.ariaHidden) {
            div.setAttribute("aria-hidden", "true");
        }

        // Fills `span` with text nodes and <a> elements for one segment.
        const appendLinked = (span, str) => {
            for (const part of this.findLinks(str)) {
                if (part.type === "text") {
                    span.append(part.text);
                    continue;
                }
                const a = document.createElement("a");
                a.textContent = part.text;
                a.href = part.href;
                if (part.type === "url") {
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                }
                span.append(a);
            }
        };

        // Normalize the input into a list of segments so both calling
        // styles above are handled identically below.
        const segments = Array.isArray(text)
            ? text
            : [{ text: text ?? "", color: options.color }];

        let wroteContent = false;
        for (const segment of segments) {
            const segmentText = segment?.text ?? "";
            if (!segmentText) continue;
            wroteContent = true;

            const span = document.createElement("span");
            appendLinked(span, String(segmentText));
            // Set via the style property (not string-interpolated CSS) so a
            // segment's color can never break out of the element's markup.
            if (segment.color) {
                span.style.color = segment.color;
            }
            div.appendChild(span);
        }

        if (!wroteContent) {
            // No segments had any text: a non-breaking space keeps empty
            // lines from collapsing to zero height.
            div.textContent = "\u00A0";
        }

        this.output.appendChild(div);
        this.trimScrollback();
        // Scrolling forces the browser to lay the page out again, which
        // is slow when done after every line of a long output. Callers
        // printing many lines in a row pass scroll: false and scroll once
        // per batch themselves (see execute() in execute.js).
        if (options.scroll !== false) {
            this.scrollToBottom();
        }
    },

    /**
     * Splits a shell error line such as "cat: no such file: foo" (or
     * "command not found: ls-a") into a red "label: " prefix and the rest
     * of the message in the terminal's default text color, ready to hand
     * to write(). Falls back to coloring the whole line red if there's no
     * "label: " to split off.
     * @param {string} line - A raw stderr line (typically "cmd: message").
     * @returns {Array<{text: string, color?: string}>} Segments for write().
     */
    formatErrorLine(line) {
        const match = line.match(/^([^:]*:\s*)([\s\S]*)$/);
        if (!match) {
            return [{ text: line, color: COLOR_ERROR }];
        }
        const [, prefix, rest] = match;
        return [
            { text: prefix, color: COLOR_ERROR },
            { text: rest }
        ];
    },

    /**
     * Prints a line using an animated "typewriter" effect (one character
     * at a time). Used during the boot sequence for dramatic effect.
     * Accepts the same two calling styles as write(): a plain string with
     * an optional whole-line options.color, or an array of colored
     * { text, color } segments (typed out left to right, in order).
     * @param {string|Array<{text: string, color?: string}>} text - The line
     *   to type out, or an array of colored segments making up the line.
     * @param {Object} [options] - Optional rendering options (e.g. color).
     */
    async typeItOut(text, options = {}) {
        const div = document.createElement("div");
        // The output pane is a live region (see index.html), so a line
        // that grows one character at a time would be announced over and
        // over, a fragment at a time. The animated line is therefore
        // hidden from screen readers, and they get the whole line at once
        // from an invisible copy instead.
        div.setAttribute("aria-hidden", "true");
        this.output.appendChild(div);

        const segments = Array.isArray(text)
            ? text
            : [{ text: text ?? "", color: options.color }];
        this.writeForScreenReaders(segments.map(segment => segment?.text ?? "").join(""));

        for (const segment of segments) {
            const span = document.createElement("span");
            if (segment.color) {
                span.style.color = segment.color;
            }
            div.appendChild(span);
            await this.typeWrite(span, segment?.text ?? "");
        }

        this.scrollToBottom();
    },

    /**
     * Reveals `text` inside `div` one character at a time with a delay
     * between each character, awaiting completion before returning.
     * @param {HTMLElement} div - Target element to type text into.
     * @param {string} text - Text to reveal.
     * @param {number} [delay=15] - Milliseconds to wait between characters.
     */
    async typeWrite(div, text, delay = 15) {
        const safeText = text ?? "";
        if (this.prefersReducedMotion()) {
            // No typewriter effect: the whole text appears at once.
            div.textContent += safeText;
            return;
        }
        for (let i = 0; i < safeText.length; i++) {
            div.textContent += safeText[i];
            await this.sleep(delay);
        }
    },

    /**
     * Pauses long command output with a "--More--" prompt (like the Unix
     * `more` pager) and returns a Promise that resolves once the user
     * presses a key to continue (handled in input.js).
     */
    async pageBreak() {
        this.pager.active = true;

        this.write("--More--");

        return new Promise(resolve => {
            this.pager.resolver = resolve;
        });
    }

});
