/**
 * `cut` command.
 * Prints selected fields (-f) or characters (-c) from each line of files or
 * piped stdin. Fields are split on -d (default TAB). A LIST is a comma-separated
 * set of numbers and ranges: 1,3 / 2-4 / -3 (1 through 3) / 5- (5 to the end).
 * Positions are numbered from 1.
 */
registerCommand("cut", {
    name: "Remove sections from each line of files.",
    synopsis: "cut OPTION... [FILE]...",
    description: "is a built-in utility that prints selected parts of each line of its input, either by field (fields are separated by a delimiter) or by character position. It is handy for pulling one column out of CSV or tab-separated data in a pipeline.",
    options: [
        "-f LIST   select only these fields",
        "-c LIST   select only these characters",
        "-d DELIM  use DELIM as the field delimiter (default: TAB)",
        "-s        skip lines that have no delimiter (with -f)"
    ],
    examples: [
        "cut -d , -f 1,3 data.csv",
        "echo hello | cut -c 1-3"
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

        const parsed = terminal.parseFlags(args, {f: true, c: true, d: true});
        const fieldSpec = parsed.options.f;
        const charSpec = parsed.options.c;
        const delim = parsed.options.d !== undefined ? parsed.options.d : "\t";
        const onlyDelimited = parsed.flags.has("s");

        const usageError = (message) => ({
            stdout: "",
            stderr: `cut: ${message}`,
            exitCode: EXIT_FAILURE
        });

        if (fieldSpec === undefined && charSpec === undefined) {
            return usageError("you must specify a list of bytes, characters, or fields");
        }
        if (fieldSpec !== undefined && charSpec !== undefined) {
            return usageError("only one type of list may be specified");
        }
        if (Array.from(delim).length !== 1) {
            return usageError("the delimiter must be a single character");
        }

        // Turns "1,3,5-7,-2,4-" into [{start,end}, ...]. Throws on bad input.
        function parseRanges(spec) {
            return spec.split(",").map(part => {
                const m = /^(\d*)(-(\d*))?$/.exec(part);
                const hasDash = m !== null && m[2] !== undefined;
                if (!m || (m[1] === "" && !hasDash) || (hasDash && m[1] === "" && m[3] === "")) {
                    throw new Error(`invalid range '${part}'`);
                }
                const start = m[1] === "" ? 1 : parseInt(m[1], 10);
                const end = !hasDash ? start : (m[3] === "" ? Infinity : parseInt(m[3], 10));
                if (start < 1) {
                    throw new Error("fields and positions are numbered from 1");
                }
                if (end < start) {
                    throw new Error(`invalid decreasing range '${part}'`);
                }
                return { start, end };
            });
        }

        let ranges;
        try {
            ranges = parseRanges(fieldSpec ?? charSpec);
        } catch (e) {
            return usageError(e.message);
        }
        const selected = (index) => ranges.some(r => index >= r.start && index <= r.end);

        // Returns the cut version of one line, or null to drop the line entirely.
        function cutLine(line) {
            if (charSpec !== undefined) {
                return Array.from(line).filter((_, i) => selected(i + 1)).join("");
            }
            if (!line.includes(delim)) {
                return onlyDelimited ? null : line;
            }
            return line.split(delim).filter((_, i) => selected(i + 1)).join(delim);
        }

        const input = window.readCommandInputs(terminal, parsed.args, stdin, "cut");
        if (input.content === null) {
            return { stdout: "", stderr: input.error, exitCode: EXIT_FAILURE };
        }

        // Keep the input's trailing newline, the same way cat does
        const trailing = input.content.endsWith("\n");
        const lines = input.content === "" ? [] : input.content.split("\n");
        if (trailing) {
            lines.pop();
        }
        const out = lines.map(cutLine).filter(line => line !== null);

        return {
            stdout: out.join("\n") + (trailing && out.length ? "\n" : ""),
            stderr: input.error,
            exitCode: input.error ? EXIT_FAILURE : EXIT_SUCCESS
        };
    }
});
