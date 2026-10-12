/**
 * `rev` command.
 * Reverses the characters on each line of files or piped stdin. Line endings
 * are left exactly as they were.
 */
registerCommand("rev", {
    name: "Reverse the characters on each line.",
    synopsis: "rev [FILE]...",
    description: "is a built-in utility that writes each input line with its characters in reverse order. Handy for quick text tricks in a pipeline.",
    options: [],
    examples: [
        "echo hello | rev",
        "rev notes.txt"
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

        const parsed = terminal.parseFlags(args, {});
        const input = window.readCommandInputs(terminal, parsed.args, stdin, "rev");
        if (input.content === null) {
            return { stdout: "", stderr: input.error, exitCode: EXIT_FAILURE };
        }

        // Reverse each run of non-newline characters; "\r" and "\n" stay where they are
        const reversed = input.content.replace(/[^\r\n]+/g, run => Array.from(run).reverse().join(""));

        return {
            stdout: reversed,
            stderr: input.error,
            exitCode: input.error ? EXIT_FAILURE : EXIT_SUCCESS
        };
    }
});
