/**
 * `basename` command.
 * Strips the directory part from a path, and optionally a trailing suffix.
 */
registerCommand("basename", {
    name: "Strip directory and suffix from a file name.",
    synopsis: "basename NAME [SUFFIX]",
    description: "is a built-in utility that prints the last part of a path, dropping the directories before it. An optional SUFFIX (such as .txt) is removed from the end when it matches.",
    options: [],
    examples: [
        "basename /home/guest/resume.md",
        "basename notes.txt .txt"
    ],
    async execute(terminal, args, stdin) {
        // Print usage info and exit early when --help is passed
        if (args.includes("--help")) {
            return {
                stdout: `${this.name} Usage syntax: "${this.synopsis}"`,
                stderr: "",
                exitCode: EXIT_SUCCESS
            };
        }

        const operands = args.filter(a => a !== "--help");
        if (operands.length === 0) {
            return { stdout: "", stderr: "basename: missing operand", exitCode: EXIT_FAILURE };
        }

        // Trailing slashes don't count: "dir/" is the same as "dir"
        const stripped = operands[0].replace(/\/+$/, "");
        let base = stripped === "" ? "/" : stripped.slice(stripped.lastIndexOf("/") + 1);

        const suffix = operands[1];
        if (suffix && base !== suffix && base.endsWith(suffix)) {
            base = base.slice(0, -suffix.length);
        }

        return { stdout: base, stderr: "", exitCode: EXIT_SUCCESS };
    }
});
