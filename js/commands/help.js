/**
 * `help` command.
 * Prints a static, formatted ASCII-art cheat sheet of common commands
 * (unlike `man`, this isn't per-command help - it's a fixed getting-started blurb).
 */
// What `help` lists. Each entry is [command, description, short
// description]; the short one is used by the compact (narrow-screen)
// layout and falls back to the full description when omitted.
const HELP_SECTIONS = [
    ["Navigation", [
        ["ls", "Lists directory contents", "List directory contents"],
        ["ls -l", "Lists directory contents with additional details", "List with details"],
        ["cd <dir>", "Change directory"],
        ["cd ..", "Go to the parent directory", "Go up one directory"]
    ]],
    ["Files", [
        ["cat <file>", "Display file contents, example cat readme.md", "Show a file"],
        ["edit <file>", "Edit file contents", "Edit a file"],
        ["more <file>", "Display file one screen at a time", "Show a file page by page"]
    ]],
    ["System", [
        ["man <command>", "Show help for a command", "Help for a command"],
        ["<command> --help", "Show help for a command", "Help for a command"],
        ["help", "Show this help message", "Show this message"],
        ["reset", "Reverts terminal to original settings", "Restore original settings"],
        ["clear", "Clear terminal display", "Clear the screen"]
    ]]
];

const HELP_INDENT = "    ";
const HELP_INNER_WIDTH = 68;                                   // text width between the box's side borders
const BOX_WIDTH = HELP_INDENT.length + HELP_INNER_WIDTH + 2;   // whole boxed line, borders included

// The full-width boxed layout.
function renderBoxed() {
    const rule = `${HELP_INDENT}+${"-".repeat(HELP_INNER_WIDTH)}+`;
    const row = (text) => `${HELP_INDENT}|${text.padEnd(HELP_INNER_WIDTH)}|`;
    const lines = [
        rule,
        row("  Welcome to Torvos.ca the following are some commands you can use"),
        row("  To view the contents of this site."),
        rule
    ];
    for (const [title, entries] of HELP_SECTIONS) {
        lines.push(row(`${title}:`));
        for (const [command, description] of entries) {
            lines.push(row(`  ${command.padEnd(17)}${description}`));
        }
        lines.push(rule);
    }
    return lines.join("\n");
}

// The compact layout for narrow screens: no box, shorter descriptions,
// at most 45 characters wide.
function renderCompact() {
    const lines = ["Welcome to Torvos.ca - commands you can use:"];
    for (const [title, entries] of HELP_SECTIONS) {
        lines.push("", `${title}:`);
        for (const [command, description, short] of entries) {
            lines.push(`  ${command.padEnd(18)}${short ?? description}`);
        }
    }
    return lines.join("\n");
}

registerCommand("help", {
    name: "Display basic commands summary.",
    synopsis : "help",
    description: "Displays a few basic commands for users to get started.",
    options: [],
    examples: [
        "help"
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
        // The boxed layout is BOX_WIDTH characters wide. On a screen too
        // narrow for it (a phone), every line would wrap and the box
        // would fall apart, so a compact layout with shorter wording and
        // no box is used there instead.
        const useBox = terminal.getColumns() >= BOX_WIDTH;
        return {
            stdout: useBox ? renderBoxed() : renderCompact(),
            stderr: "",
            exitCode: EXIT_SUCCESS
        };
    }
});