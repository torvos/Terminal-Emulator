/**
 * `dirname` command.
 * Prints the directory part of each path (everything before the last slash).
 */
registerCommand("dirname", {
    name: "Strip the last component from a file name.",
    synopsis: "dirname NAME...",
    description: "is a built-in utility that prints the directory portion of each path, the opposite of basename. A bare name with no slash gives '.' (the current directory).",
    options: [],
    examples: [
        "dirname /home/guest/resume.md",
        "dirname notes.txt"
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
            return { stdout: "", stderr: "dirname: missing operand", exitCode: EXIT_FAILURE };
        }

        const dirOf = (path) => {
            const stripped = path.replace(/\/+$/, "");
            if (stripped === "") return "/";
            const slash = stripped.lastIndexOf("/");
            if (slash === -1) return ".";
            const dir = stripped.slice(0, slash).replace(/\/+$/, "");
            return dir === "" ? "/" : dir;
        };

        return {
            stdout: operands.map(dirOf).join("\n"),
            stderr: "",
            exitCode: EXIT_SUCCESS
        };
    }
});
