/**
 * `nl` command.
 * Numbers lines of files or piped stdin. By default only non-empty lines are
 * numbered (-b t); -b a numbers every line, including blank ones.
 */
registerCommand("nl", {
    name: "Number lines of files.",
    synopsis: "nl [OPTION]... [FILE]...",
    description: "is a built-in utility that writes its input with a line number in front of each line. It is useful for referring to specific lines of a file or pipeline output.",
    options: [
        "-b STYLE  a: number all lines, t: number only non-empty lines (default)"
    ],
    examples: [
        "nl notes.txt",
        "cat script.sh | nl -b a"
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

        const parsed = terminal.parseFlags(args, {b: true});
        const style = parsed.options.b !== undefined ? parsed.options.b : "t";
        if (style !== "a" && style !== "t") {
            return {
                stdout: "",
                stderr: `nl: invalid body numbering style: '${style}'`,
                exitCode: EXIT_FAILURE
            };
        }

        const input = window.readCommandInputs(terminal, parsed.args, stdin, "nl");
        if (input.content === null) {
            return { stdout: "", stderr: input.error, exitCode: EXIT_FAILURE };
        }

        const trailing = input.content.endsWith("\n");
        const lines = input.content === "" ? [] : input.content.split("\n");
        if (trailing) {
            lines.pop();
        }

        let number = 0;
        const out = lines.map(line => {
            const numbered = style === "a" || line !== "";
            if (!numbered) {
                // Unnumbered lines keep the number column blank so text still lines up
                return " ".repeat(6) + "\t" + line;
            }
            number++;
            return String(number).padStart(6, " ") + "\t" + line;
        });

        return {
            stdout: out.join("\n") + (trailing && out.length ? "\n" : ""),
            stderr: input.error,
            exitCode: input.error ? EXIT_FAILURE : EXIT_SUCCESS
        };
    }
});
