/**
 * `sleep` command.
 * Pauses for the given time. Accepts a number with an optional unit suffix
 * (s, m, h, d; seconds by default). Several arguments are added together.
 * Capped at 60 seconds so a single command can't leave the terminal hanging.
 */
registerCommand("sleep", {
    name: "Delay for a specified amount of time.",
    synopsis: "sleep NUMBER[SUFFIX]...",
    description: "is a built-in utility that waits for the given amount of time before finishing. Suffixes are s (seconds, the default), m (minutes), h (hours) and d (days).",
    options: [],
    examples: [
        "sleep 2",
        "sleep 1m"
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

        const MAX_SECONDS = 60;
        const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };
        const operands = args.filter(a => a !== "--help");

        if (operands.length === 0) {
            return { stdout: "", stderr: "sleep: missing operand", exitCode: EXIT_FAILURE };
        }

        let seconds = 0;
        for (const operand of operands) {
            const m = /^(\d+(\.\d+)?)([smhd]?)$/.exec(operand);
            if (!m) {
                return {
                    stdout: "",
                    stderr: `sleep: invalid time interval '${operand}'`,
                    exitCode: EXIT_FAILURE
                };
            }
            seconds += parseFloat(m[1]) * UNIT_SECONDS[m[3] || "s"];
        }

        if (seconds > MAX_SECONDS) {
            return {
                stdout: "",
                stderr: `sleep: interval too long (the browser allows at most ${MAX_SECONDS} seconds)`,
                exitCode: EXIT_FAILURE
            };
        }

        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        return { stdout: "", stderr: "", exitCode: EXIT_SUCCESS };
    }
});
