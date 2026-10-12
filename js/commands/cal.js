/**
 * `cal` command.
 * Prints a month calendar (Sunday-first) for the current month, or for the
 * month and year given as `cal MONTH YEAR`.
 */
registerCommand("cal", {
    name: "Display a calendar.",
    synopsis: "cal [MONTH YEAR]",
    description: "is a built-in utility that prints a calendar for one month. With no arguments it shows the current month; with a month number and a year it shows that month instead.",
    options: [],
    examples: [
        "cal",
        "cal 12 2026"
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

        const MONTHS = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const WIDTH = 20;

        const now = new Date();
        let month = now.getMonth() + 1;
        let year = now.getFullYear();

        if (args.length === 2) {
            month = /^\d+$/.test(args[0]) ? parseInt(args[0], 10) : NaN;
            year = /^\d+$/.test(args[1]) ? parseInt(args[1], 10) : NaN;
        } else if (args.length !== 0) {
            return { stdout: "", stderr: "cal: usage: cal [MONTH YEAR]", exitCode: EXIT_FAILURE };
        }

        if (!(month >= 1 && month <= 12) || !(year >= 1 && year <= 9999)) {
            return { stdout: "", stderr: "cal: invalid month or year", exitCode: EXIT_FAILURE };
        }

        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

        // Day of week of the 1st, computed in UTC so local time zones can't shift it
        const firstDate = new Date(0);
        firstDate.setUTCFullYear(year, month - 1, 1);
        const firstWeekday = firstDate.getUTCDay();

        const title = `${MONTHS[month - 1]} ${year}`;
        const header = " ".repeat(Math.floor((WIDTH - title.length) / 2)) + title;

        // Leading blanks line the 1st up under its weekday, then one cell per day
        const cells = Array(firstWeekday).fill("  ");
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push(String(day).padStart(2, " "));
        }

        const rows = [];
        for (let i = 0; i < cells.length; i += 7) {
            rows.push(cells.slice(i, i + 7).join(" "));
        }

        return {
            stdout: [header, "Su Mo Tu We Th Fr Sa", ...rows].join("\n"),
            stderr: "",
            exitCode: EXIT_SUCCESS
        };
    }
});
