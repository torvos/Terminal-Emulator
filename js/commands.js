// Global registry that maps command names (e.g. "ls", "cat") to their
// implementation objects/functions. Populated by each file in js/commands/.
window.Commands = {};

/**
 * Registers a command so the terminal's executor/parser can look it up by name.
 * @param {string} name - The command name as typed by the user (e.g. "grep").
 * @param {Function|Object} command - The command implementation (handler function
 *   or object with a run/execute method, depending on how commands/*.js define it).
 */
window.registerCommand = function(name, command) {
    // Warn (but still allow) if a command name is being overwritten,
    // to help catch accidental duplicate registrations during development.
    if (window.Commands[name]) {
        console.warn(`Command '${name}' is already registered.`);
    }

    window.Commands[name] = command;
};

/**
 * Shared input helper for commands that read either named files or piped
 * stdin (cut, rev, nl, ...). Returns { content, error }:
 *   - content is null when there is no input at all (no files and nothing piped)
 *   - error is a newline-joined list of per-file problems, or "" when clean
 * Unreadable files are reported and skipped, so one bad name doesn't hide the rest.
 */
window.readCommandInputs = function (terminal, targets, stdin, name) {
    if (targets.length === 0) {
        if (stdin == null) {
            return { content: null, error: `${name}: missing file operand` };
        }
        return { content: stdin, error: "" };
    }
    const parts = [];
    const errors = [];
    for (const target of targets) {
        if (target === "-") {
            parts.push(stdin ?? "");
            continue;
        }
        const node = terminal.fs.get(target, terminal.cwd);
        if (!node) {
            errors.push(`${name}: ${target}: No such file or directory`);
            continue;
        }
        if (terminal.fs.isDirectory(node)) {
            errors.push(`${name}: ${target}: Is a directory`);
            continue;
        }
        if (terminal.fs.isProtected(target, terminal.cwd) && !terminal.fs.isDevice(node)) {
            errors.push(`${name}: ${target}: Permission denied`);
            continue;
        }
        parts.push(terminal.fs.readContent(node));
    }
    return { content: parts.join(""), error: errors.join("\n") };
};
