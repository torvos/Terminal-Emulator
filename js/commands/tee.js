/**
 * `tee` command.
 * Copies piped stdin to stdout and into each named file. Overwrites the
 * files by default; -a appends instead.
 */
registerCommand("tee", {
    name: "Read from stdin and write to stdout and files.",
    synopsis: "tee [OPTION]... [FILE]...",
    description: "is a built-in utility that passes its input through unchanged while also saving a copy to one or more files. It lets you watch the output of a pipeline and keep it at the same time.",
    // Tells the executor to persist the filesystem after this command runs
    mutatesFilesystem: true,
    options: [
        "-a  append to the given files instead of overwriting them"
    ],
    examples: [
        "ls | tee listing.txt",
        "echo second line | tee -a log.txt"
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
        const append = parsed.flags.has("a");

        if (stdin == null) {
            return {
                stdout: "",
                stderr: "tee: missing input (pipe something into tee)",
                exitCode: EXIT_FAILURE
            };
        }

        const errors = [];
        for (const target of parsed.args) {
            const result = terminal.writeRedirect(target, stdin, append);
            if (result !== true) {
                errors.push(`tee: ${target}: ${result}`);
            }
        }

        return {
            stdout: stdin,
            stderr: errors.join("\n"),
            exitCode: errors.length ? EXIT_FAILURE : EXIT_SUCCESS
        };
    }
});
