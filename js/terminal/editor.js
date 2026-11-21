/**
 * Full-screen text editor overlay (used by the `edit` command), letting
 * the user view and modify a file's contents in a dedicated textarea
 * instead of the normal line-based shell input.
 */
Object.assign(TerminalEngine.prototype, {

    /**
     * Opens the full-screen editor for a given filesystem node, hiding the
     * normal terminal input/output and showing the editor textarea
     * pre-filled with the file's current content.
     * @param {Object} node - The filesystem file node to edit.
     * @param {string} path - Display path shown in the editor header.
     */
    openEditor(node, path) {
        this.editor.active = true;
        this.editor.node = node;
        this.editor.path = path;
        this.editor.modified = false;
        this.editor.confirmingDiscard = false;
        this.inputMode = INPUT_EDITOR;
        document.getElementById("input-line").style.display = "none";
        document.getElementById("output").style.display = "none";
        document.body?.classList.add("editor-mode");
        this.editorEl.addEventListener("keydown", this.editorKeyHandler);
        this.editorEl.addEventListener("input", this.editorInputHandler);
        this.editorContainer.style.display = "flex";
        this.editorEl.value = node.content ?? "";

        // Wait a frame before focusing/placing the cursor so the textarea
        // is visible and laid out first.
        requestAnimationFrame(() => {
            this.editorEl.focus();
            this.editorEl.setSelectionRange(
                this.editorEl.value.length,
                this.editorEl.value.length
            );
        });
        this.setEditorNotice(null);
    },

    /**
     * Whether the text in the editor differs from what is stored in the
     * file - i.e. whether closing now would lose something. Compares the
     * actual text, so moving the cursor around, or typing something and
     * deleting it again, doesn't count as a change.
     * @returns {boolean}
     */
    isEditorDirty() {
        return this.editor.active &&
            this.editorEl.value !== (this.editor.node?.content ?? "");
    },

    /**
     * Sets the editor's one-line header, and keeps the touch toolbar's
     * exit button label in step with it.
     * @param {"saved"|"save-failed"|"confirm-discard"|null} notice - What
     *   to tell the user, or null for the normal header (key hints only).
     */
    setEditorNotice(notice) {
        const path = this.editor.path;
        const keys = "Ctrl+S Save | Ctrl+X Save & Exit | Esc Exit";
        let text;
        switch (notice) {
            case "saved":
                text = `Editing: ${path} | Saved | ${keys}`;
                break;
            case "save-failed":
                // Too big for the filesystem's size limits (see FS_MAX_*
                // in constants.js).
                text = `Editing: ${path} | NOT SAVED: No space left on device - shorten the file and save again | Esc Exit without saving`;
                break;
            case "confirm-discard":
                text = `Editing: ${path} | UNSAVED CHANGES - press Esc again to discard them | Ctrl+X Save & Exit | any other key keeps editing`;
                break;
            default:
                text = `Editing: ${path} | ${keys}`;
        }
        this.editor.notice = notice;
        document.getElementById("editor-header").textContent = text;

        // On touch devices the exit button says what a tap will do next.
        const escBtn = document.getElementById("mobile-esc-btn");
        if (escBtn) {
            const confirming = notice === "confirm-discard";
            escBtn.textContent = confirming ? "Discard changes" : "Esc";
            // The spoken label follows the visible one.
            escBtn.setAttribute(
                "aria-label",
                confirming ? "Discard changes and exit the editor" : "Exit the editor without saving"
            );
        }
    },

    /**
     * Called when the user carries on editing (a key press or typed
     * text): withdraws a pending "press Esc again to discard" question
     * and clears a "Saved" / "NOT SAVED" message, since both describe a
     * moment that has passed.
     */
    resumeEditing() {
        this.editor.confirmingDiscard = false;
        if (this.editor.notice) {
            this.setEditorNotice(null);
        }
    },

    /**
     * Writes the editor textarea's current contents back to the file node
     * and persists the updated filesystem, without closing the editor.
     * @returns {boolean|undefined} false if the file was too large to
     *   save, true if it was saved, undefined if the editor isn't open.
     */
    saveEditor() {
        if (!this.editor.active){
            return;
        }
        this.editor.confirmingDiscard = false;
        const wrote = this.fs.writeContent(this.editor.node, this.editorEl.value);
        if (!wrote) {
            // Nothing was written; the text stays in the editor so it can
            // be shortened and saved again.
            this.setEditorNotice("save-failed");
            return false;
        }
        this.setEditorNotice("saved");
        this.fsDirty = true;
        this.saveSettings();
        this.editor.modified = false;
        return true;
    },

    /**
     * Closes the editor overlay and restores normal terminal input/output.
     *
     * Closing WITHOUT saving while there are unsaved changes takes two
     * steps: the first call only asks (the header shows "press Esc again
     * to discard"), and the editor stays open; a second call straight
     * after it discards the changes and closes. Anything else the user
     * does in between (typing, saving) withdraws the question - see
     * resumeEditing().
     * @param {boolean} [save=false] - If true, saves changes before closing.
     * @returns {boolean|undefined} true if the editor closed, false if it
     *   stayed open (save failed, or waiting for the discard to be
     *   confirmed), undefined if it wasn't open.
     */
    closeEditor(save = false) {
        if (!this.editor.active){
            return;
        }
        if (save && this.saveEditor() === false){
            // The save failed - stay in the editor rather than closing
            // and losing the text.
            return false;
        }
        if (!save && this.isEditorDirty() && !this.editor.confirmingDiscard) {
            this.editor.confirmingDiscard = true;
            this.setEditorNotice("confirm-discard");
            return false;
        }
        this.editor.confirmingDiscard = false;
        this.setEditorNotice(null); // also resets the touch exit button's label
        this.editor.active = false;
        this.editor.node = null;
        this.editorContainer.style.display = "none";
        this.editorEl.removeEventListener("keydown",this.editorKeyHandler);
        this.editorEl.removeEventListener("input", this.editorInputHandler);
        document.body?.classList.remove("editor-mode");
        document.getElementById("input-line").style.display = "";
        document.getElementById("output").style.display = "";
        this.inputMode = INPUT_NORMAL;
        this.hiddenInput.focus();
        this.renderPrompt();
        // #output was `display: none` while the editor was open, so the
        // #terminal container's scroll position wasn't maintained against
        // it - without this, re-showing it leaves the view sitting near
        // the top instead of back where the user was (the bottom, same as
        // every other place that writes to the terminal).
        this.scrollToBottom();
        return true;
    }

});
