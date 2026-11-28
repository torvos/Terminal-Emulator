/**
 * `open` command.
 * Opens a link from the keyboard. Links in the output are clickable, but
 * the Tab key belongs to the terminal (it completes names, and never
 * moves focus out of the terminal), so there is no way to reach a link
 * with the keyboard alone. This is that way:
 *
 *   open           list the links currently on screen, numbered
 *   open 2         open link number 2 from that list
 *   open URL       open a web address or email address directly
 *
 * Only http(s) and email links can be opened - the same ones the
 * terminal turns into clickable links (see findLinks() in render.js).
 */
registerCommand("open", {
    name: "Open a link from the keyboard.",
    synopsis: "open [NUMBER | URL | EMAIL]",
    description: "opens a link without using the mouse. With no argument it lists the links currently shown on screen, numbered; give it one of those numbers, or a web or email address, to open it. Web links open in a new tab; email addresses open your mail program.",
    options: [],
    examples: [
        "open",
        "open 2",
        "open https://example.com",
        "open someone@example.com"
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

        const fail = (message) => ({ stdout: "", stderr: `open: ${message}`, exitCode: EXIT_FAILURE });
        const links = terminal.listLinks();

        // No argument: show what can be opened.
        if (args.length === 0) {
            if (links.length === 0) {
                return fail("there are no links on screen (try 'contact')");
            }
            const width = String(links.length).length;
            const rows = links.map((link, index) => `  ${String(index + 1).padStart(width)}  ${link.text}`);
            rows.push("Type 'open NUMBER' to open one.");
            return { stdout: rows.join("\n"), stderr: "", exitCode: EXIT_SUCCESS };
        }
        if (args.length > 1) {
            return fail("give one link number or address");
        }

        // Work out which link is meant.
        const target = args[0];
        let link;
        if (/^\d+$/.test(target)) {
            const number = parseInt(target, 10);
            if (links.length === 0) {
                return fail("there are no links on screen (try 'contact')");
            }
            if (number < 1 || number > links.length) {
                return fail(`no link number ${target} (there ${links.length === 1 ? "is 1" : `are ${links.length}`} on screen)`);
            }
            link = links[number - 1];
        } else {
            // A typed address must be exactly one web or email address,
            // by the same rules that make output clickable.
            const parts = terminal.findLinks(target);
            if (parts.length !== 1 || parts[0].type === "text") {
                return fail(`not a web or email address: ${target}`);
            }
            link = { text: parts[0].text, href: parts[0].href, type: parts[0].type };
        }

        // Browsers only let a page open something as the direct result
        // of the person doing something (a key press or click). When
        // `open` runs without one - from a script that slept first, or
        // from a `?run=` link as the page loads - it is refused here,
        // rather than opening things nobody asked for.
        const activation = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
        if (activation && !activation.isActive) {
            return fail("can only open a link right after you press Enter");
        }

        terminal.openLink(link.href, link.type === "url");
        return { stdout: `Opening ${link.text}`, stderr: "", exitCode: EXIT_SUCCESS };
    }
});
