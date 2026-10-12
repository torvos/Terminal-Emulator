/**
 * `du` command.
 * Estimates disk usage of files and directories, in 1 KiB units by default
 * (or human readable with -h). Sizes are rounded up to 4 KiB blocks, the same
 * way a real filesystem allocates space. -s prints only a total per argument.
 */
registerCommand("du", {
    name: "Estimate file space usage.",
    synopsis: "du [OPTION]... [FILE]...",
    description: "is a built-in utility that reports how much space files and directories take up. Each directory's total includes everything under it, and nested directories are listed too unless you ask for summaries with -s.",
    options: [
        "-s  display only a total for each argument",
        "-h  print sizes in human readable format (e.g., 4.0K, 1.2M)"
    ],
    examples: [
        "du -sh .",
        "du -h projects"
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
        const summarize = parsed.flags.has("s");
        const human = parsed.flags.has("h");
        const targets = parsed.args.length ? parsed.args : ["."];
        const BLOCK = 4096;

        // Real disk usage rounds each file up to whole blocks; empty files take none
        function allocated(bytes) {
            return bytes === 0 ? 0 : Math.ceil(bytes / BLOCK) * BLOCK;
        }

        function formatSize(bytes) {
            if (!human) {
                return String(Math.ceil(bytes / 1024));
            }
            const units = ["B", "K", "M", "G"];
            let value = bytes;
            let i = 0;
            while (value >= 1024 && i < units.length - 1) {
                value /= 1024;
                i++;
            }
            const shown = (i === 0 || value >= 10) ? String(Math.round(value)) : value.toFixed(1);
            return shown + units[i];
        }

        const lines = [];
        const errors = [];

        // Returns the total size of `node`. Directories are emitted after their
        // children (post-order), like real du, when `emit` is true.
        function walk(node, display, emit) {
            // Links and devices don't take space of their own here
            if (terminal.fs.isSymlink(node) || terminal.fs.isDevice(node)) {
                return 0;
            }
            if (!terminal.fs.isDirectory(node)) {
                const bytes = new TextEncoder().encode(terminal.fs.readContent(node)).length;
                return allocated(bytes);
            }

            let total = BLOCK;
            for (const [name, child] of Object.entries(node.children ?? {})) {
                const childPath = display.endsWith("/") ? display + name : `${display}/${name}`;
                total += walk(child, childPath, emit);
            }
            if (emit) {
                lines.push(`${formatSize(total)}\t${display}`);
            }
            return total;
        }

        for (const target of targets) {
            const node = terminal.fs.get(target, terminal.cwd);
            if (!node) {
                errors.push(`du: cannot access '${target}': No such file or directory`);
                continue;
            }
            const isDir = terminal.fs.isDirectory(node);
            const total = walk(node, target, !summarize);
            // Files and -s summaries print one line for the argument itself
            if (!isDir || summarize) {
                lines.push(`${formatSize(total)}\t${target}`);
            }
        }

        return {
            stdout: lines.join("\n"),
            stderr: errors.join("\n"),
            exitCode: errors.length ? EXIT_FAILURE : EXIT_SUCCESS
        };
    }
});
