/**
 * `seq` command.
 * Prints a sequence of numbers: `seq LAST`, `seq FIRST LAST`, or
 * `seq FIRST INCREMENT LAST`. Decimal values are supported.
 */
registerCommand("seq", {
    name: "Print a sequence of numbers.",
    synopsis: "seq [OPTION]... LAST | FIRST LAST | FIRST INCREMENT LAST",
    description: "is a built-in utility that prints a range of numbers, one per line by default. It is useful for loops in shell scripts and for generating test data.",
    options: [
        "-s STR  use STR to separate numbers (default: newline)",
        "-w      pad every number to the same width with leading zeros"
    ],
    examples: [
        "seq 5",
        "seq 0 2 10",
        "seq -s , 1 4"
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

        // Parsed by hand rather than with parseFlags, which would read a
        // negative number like "-2" as a flag. Only -s and -w are options.
        let sep = "\n";
        let equalWidth = false;
        const operands = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === "-s") {
                sep = args[++i] ?? "";
            } else if (arg.startsWith("-s") && arg.length > 2) {
                sep = arg.slice(2);
            } else if (arg === "-w") {
                equalWidth = true;
            } else {
                operands.push(arg);
            }
        }

        const fail = (message) => ({ stdout: "", stderr: `seq: ${message}`, exitCode: EXIT_FAILURE });

        if (operands.length < 1) {
            return fail("missing operand");
        }
        if (operands.length > 3) {
            return fail(`extra operand '${operands[3]}'`);
        }
        for (const op of operands) {
            if (!/^-?\d+(\.\d+)?$/.test(op)) {
                return fail(`invalid floating point argument: '${op}'`);
            }
        }

        // Missing pieces default to FIRST=1 and INCREMENT=1
        const [first, increment, last] = operands.length === 1
            ? [1, 1, Number(operands[0])]
            : operands.length === 2
                ? [Number(operands[0]), 1, Number(operands[1])]
                : [Number(operands[0]), Number(operands[1]), Number(operands[2])];

        if (increment === 0) {
            return fail(`invalid Zero increment value: '${operands[1]}'`);
        }

        // Decimal places to print: the most any operand uses
        const decimals = Math.max(...operands.map(op => (op.split(".")[1] || "").length));

        const count = Math.floor((last - first) / increment + 1e-9) + 1;
        if (count > 100000) {
            return fail("too many values (the browser limit is 100000)");
        }

        const values = [];
        for (let i = 0; i < count; i++) {
            values.push((first + i * increment).toFixed(decimals));
        }

        if (equalWidth) {
            const width = Math.max(0, ...values.map(v => v.length));
            for (let i = 0; i < values.length; i++) {
                const negative = values[i].startsWith("-");
                const digits = negative ? values[i].slice(1) : values[i];
                values[i] = (negative ? "-" : "") + digits.padStart(width - (negative ? 1 : 0), "0");
            }
        }

        return { stdout: values.join(sep), stderr: "", exitCode: EXIT_SUCCESS };
    }
});
