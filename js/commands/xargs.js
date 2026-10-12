/**
 * `xargs` command.
 * Reads whitespace-separated items from stdin and runs COMMAND with them as
 * arguments. -n limits how many items go on each run; -I runs the command once
 * per input line, replacing every occurrence of STR with that line.
 */
registerCommand("xargs", {
    name: "Build and run commands from standard input.",
    synopsis: "xargs [OPTION]... [COMMAND [INITIAL-ARGS]...]",
    description: "is a built-in utility that turns the output of one command into the arguments of another. It is the usual way to act on a list of files produced by a pipeline, for example `find . -name '*.txt' | xargs wc -l`.",
    // Whatever COMMAND does may change files, so persist after running
    mutatesFilesystem: true,
    options: [
        "-n N  use at most N items per command line",
        "-I STR  run once per input line, replacing STR in the command with it"
    ],
    examples: [
        "echo notes.txt | xargs cat",
        "printf 'a\\nb\\n' | xargs -I {} echo item {}"
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

        const parsed = terminal.parseFlags(args, {n: true, I: true});
        const perRun = parsed.options.n !== undefined ? parseInt(parsed.options.n, 10) : null;
        const replace = parsed.options.I;
        const command = parsed.args.length ? parsed.args : ["echo"];

        if (perRun !== null && (!Number.isFinite(perRun) || perRun < 1)) {
            return {
                stdout: "",
                stderr: `xargs: invalid number for -n: '${parsed.options.n}'`,
                exitCode: EXIT_FAILURE
            };
        }

        // Quote anything that isn't plain, so each item reaches the command as one argument
        const quote = (s) => /^[A-Za-z0-9_@%+=:,./-]+$/.test(s)
            ? s
            : `'${s.replace(/'/g, "'\\''")}'`;

        const text = stdin ?? "";
        const lines = [];

        if (replace !== undefined) {
            const inputLines = text.split("\n").filter(line => line.length > 0);
            for (const item of inputLines) {
                lines.push(command
                    .map(arg => arg.split(replace).join(item))
                    .map(quote)
                    .join(" "));
            }
        } else {
            const items = text.split(/\s+/).filter(Boolean);
            if (items.length === 0) {
                // Like GNU xargs: with no input, run the command once with no extra arguments
                lines.push(command.map(quote).join(" "));
            } else {
                const size = perRun ?? items.length;
                for (let i = 0; i < items.length; i += size) {
                    lines.push([...command, ...items.slice(i, i + size)].map(quote).join(" "));
                }
            }
        }

        let stdout = "";
        let stderr = "";
        let exitCode = EXIT_SUCCESS;
        for (const line of lines) {
            const result = await terminal.runCaptured(line);
            if (result.stdout) {
                stdout += (stdout && !stdout.endsWith("\n") ? "\n" : "") + result.stdout;
            }
            if (result.stderr) {
                stderr += (stderr && !stderr.endsWith("\n") ? "\n" : "") + result.stderr;
            }
            if (result.exitCode !== EXIT_SUCCESS) {
                exitCode = EXIT_FAILURE;
            }
        }

        return { stdout, stderr, exitCode };
    }
});
