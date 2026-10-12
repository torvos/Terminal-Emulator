/**
 * `expr` command.
 * Evaluates an expression given as separate arguments, e.g. `expr 2 + 3 '*' 4`.
 * Supports | & = != < <= > >= + - * / % and parentheses, with the usual
 * precedence. Exit status is 1 when the result is 0 or empty, 0 otherwise,
 * and 2 for a syntax error or a bad argument.
 */
registerCommand("expr", {
    name: "Evaluate expressions.",
    synopsis: "expr EXPRESSION",
    description: "is a built-in utility that evaluates arithmetic and comparison expressions. Each operator and operand is its own argument, so quote operators such as '*' and '(' to keep the shell from interpreting them.",
    options: [],
    examples: [
        "expr 2 + 3",
        "expr 7 / 2",
        "expr '(' 2 + 3 ')' '*' 2"
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

        if (args.length === 0) {
            return { stdout: "", stderr: "expr: missing operand", exitCode: EXIT_SYNTAX_ERROR };
        }

        class ExprError extends Error {}
        const fail = (message) => { throw new ExprError(message); };

        const tokens = args;
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];

        const isInt = (v) => /^-?\d+$/.test(v);
        const truthy = (v) => v !== "" && v !== "0";
        const asInt = (v) => {
            if (!isInt(v)) fail("non-integer argument");
            return parseInt(v, 10);
        };
        const compare = (op, a, b) => {
            // Compare as numbers when both sides are integers, otherwise as text
            const [x, y] = isInt(a) && isInt(b) ? [Number(a), Number(b)] : [a, b];
            switch (op) {
                case "=": return x === y;
                case "!=": return x !== y;
                case "<": return x < y;
                case "<=": return x <= y;
                case ">": return x > y;
                case ">=": return x >= y;
            }
        };

        // Grammar, lowest precedence first: | , & , comparisons, + -, * / %, atoms
        function parseOr() {
            let left = parseAnd();
            while (peek() === "|") {
                next();
                const right = parseAnd();
                left = truthy(left) ? left : right;
            }
            return left;
        }
        function parseAnd() {
            let left = parseCmp();
            while (peek() === "&") {
                next();
                const right = parseCmp();
                left = truthy(left) && truthy(right) ? left : "0";
            }
            return left;
        }
        function parseCmp() {
            let left = parseAdd();
            while (["=", "!=", "<", "<=", ">", ">="].includes(peek())) {
                const op = next();
                const right = parseAdd();
                left = compare(op, left, right) ? "1" : "0";
            }
            return left;
        }
        function parseAdd() {
            let left = parseMul();
            while (peek() === "+" || peek() === "-") {
                const op = next();
                const right = parseMul();
                left = String(op === "+" ? asInt(left) + asInt(right) : asInt(left) - asInt(right));
            }
            return left;
        }
        function parseMul() {
            let left = parseAtom();
            while (peek() === "*" || peek() === "/" || peek() === "%") {
                const op = next();
                const right = parseAtom();
                const a = asInt(left);
                const b = asInt(right);
                if ((op === "/" || op === "%") && b === 0) fail("division by zero");
                left = String(op === "*" ? a * b : op === "/" ? Math.trunc(a / b) : a % b);
            }
            return left;
        }
        function parseAtom() {
            const token = next();
            if (token === undefined) fail("syntax error");
            if (token === "(") {
                const value = parseOr();
                if (next() !== ")") fail("syntax error: missing ')'");
                return value;
            }
            const operators = ["|", "&", "=", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", ")"];
            if (operators.includes(token)) fail("syntax error");
            return token;
        }

        try {
            const result = parseOr();
            if (pos < tokens.length) fail("syntax error");
            const exitCode = result === "" || result === "0" ? EXIT_FAILURE : EXIT_SUCCESS;
            return { stdout: result, stderr: "", exitCode };
        } catch (e) {
            if (e instanceof ExprError) {
                return { stdout: "", stderr: `expr: ${e.message}`, exitCode: EXIT_SYNTAX_ERROR };
            }
            throw e;
        }
    }
});
