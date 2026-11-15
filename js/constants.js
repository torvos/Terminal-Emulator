// Global configuration constants shared across the terminal engine and commands.

const TERMINAL_VERSION = "3.0.0";   // Displayed by commands like `man`/version banners
const ROOT = "/";                   // Filesystem root path
const HOME = "/home/guest";         // Default home directory for the guest user
const DEFAULT_USER = "guest";       // Username used when no login has occurred
const HOSTNAME = "torvos";          // Hostname shown in the prompt (e.g. guest@torvos)

// Input mode identifiers used by js/terminal/input.js to decide how to
// interpret keystrokes (normal shell input vs. full-screen editor vs.
// prompts collecting login credentials).
const INPUT_NORMAL = "normal";
const INPUT_EDITOR = "editor";
const INPUT_WAIT_FOR_USERNAME = "waitingUsername";
const INPUT_WAIT_FOR_PASSWORD = "waitingPassword";

// Shared colors for multi-color command output (ls/tree/find/grep/stat/man/etc).
// Kept in one place so entries, matches, and labels stay visually consistent
// across every command that colors part of its output.
const COLOR_STDOUT = "#ffffff";     // default color used for plain stdout text
const COLOR_ERROR = "#ff6060";      // matches the red used for stderr lines
const COLOR_DIRECTORY = "#66aaff";  // directory names in ls/tree/find
const COLOR_SYMLINK = "#5fd7ff";    // symlink names/targets in ls
const COLOR_DEVICE = "#ffcc66";     // device file names in ls (/dev/*)
const COLOR_MATCH = "#ffff66";      // grep's matched substring
const COLOR_LABEL = "#888888";      // dim field labels in stat/printenv
const COLOR_HEADING = "#66ff99";    // section headings in man
const COLOR_SUCCESS = "#66ff99";    // green used for success/PASS-style status text
const COLOR_MAGENTA = "#ff66ff";    // magenta, used by echo's ANSI color code support
const COLOR_WARNING = "#ff5555";    // boot-time warning messages (corrupted save data, storage full)

//Exit codes
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_SYNTAX_ERROR = 2;       // shell-level syntax error (e.g. an unterminated quote)
const EXIT_COMMAND_NOT_FOUND = 127;
const EXIT_NOT_EXECUTABLE = 126;    // found but not runnable (a directory, non-regular file, or missing the execute bit)

// Ownership - the two "users" any file/directory can be owned by in this
// virtual filesystem. DEFAULT_USER above is the interactive user; this is
// the system/admin owner used for protected paths like /bin and /dev.
const SYSTEM_USER = "root";

// Output timing (milliseconds), used by the "typewriter" animation effect
const LINE_PRINT_DELAY_MS = 50;     // delay between each printed line of command output
const PAGER_SCROLL_DELAY_MS = 20;   // delay between each line when less/more scroll

// localStorage keys used to persist a session across reloads - kept in one
// place so core.js (save/restore) and input.js (the `reset` command) can't
// drift out of sync with each other.
const STORAGE_KEY_SETTINGS = "terminalSettings";
const STORAGE_KEY_FILESYSTEM = "FileSystem";

// Size limits for the virtual filesystem. The whole tree is saved to
// localStorage as one JSON string, and browsers allow roughly 5 million
// characters per site there, so the filesystem has to stay well under
// that or saving stops working. Sizes are counted in JavaScript string
// characters (the unit localStorage itself counts in), not bytes. The
// total is kept low enough that even content made entirely of characters
// JSON has to write as six-character escapes still fits.
// Enforced by FileSystemAPI.writeContent() and FileSystemAPI.checkSpace()
// in js/filesystem/fileapi.js.
const FS_MAX_FILE_CHARS = 250000;   // one file's content
const FS_MAX_TOTAL_CHARS = 750000;  // all content + names + link targets together
const FS_MAX_NODES = 2000;          // files + directories + links + devices
const FS_MAX_NAME_LENGTH = 255;     // one file/directory name

// Limits applied to the saved session settings (history, env, aliases)
// when they are saved and when they are read back at boot - see
// sanitizeSettings() in js/terminal/core.js.
const MAX_HISTORY = 1000;               // number of remembered commands
const MAX_HISTORY_ENTRY_CHARS = 4096;   // longer commands still run, but aren't remembered
const MAX_SETTINGS_ENTRIES = 500;       // env variables / aliases restored from storage
const MAX_SETTINGS_VALUE_CHARS = 65536; // one env/alias value restored from storage

// Aliases every session starts with. The three site shortcuts use absolute
// paths so they work from any working directory. User-defined/saved aliases
// are merged on top of these at boot (see TerminalEngine.init() in core.js).
const DEFAULT_ALIASES = {
    "ll": "ls -la",
    "cd..": "cd ..",
    "resume": `cat ${HOME}/resume.md`,
    "about": `cat ${HOME}/readme.md`,
    "contact": `cat ${HOME}/contact.md`
};

// Private-Use-Area placeholders the tokenizer substitutes for a literal
// "*"/"?" that came from inside quotes (or via backslash-escape) - so a
// quoted glob character can pass all the way through wildcard expansion
// as inert text instead of being treated as a wildcard, then get
// swapped back to the real character right before a command sees it.
// See tokenize() in parser.js and the restoreGlobChars() call sites in
// execute.js for the two ends of this. Chosen from the Private Use Area
// specifically because real user input can never contain them.
const GLOB_STAR_PLACEHOLDER = "\uE000";
const GLOB_QUESTION_PLACEHOLDER = "\uE001";

// Private-Use-Area placeholders for characters that are syntactically
// significant to something DOWNSTREAM of expansion (tokenize(),
// splitTopLevel()/splitAndOr()'s statement/pipe/and-or splitting,
// parseCommand()'s redirect-operator detection) - used the exact same way
// as the two above, just for a different purpose: protecting the
// characters of an EXPANDED VALUE (a variable's stored value, or a
// command substitution's captured output) from being mistaken for real,
// user-typed syntax by any of those later stages. A value can contain
// ANY character - a quote, a pipe, a redirect arrow - and none of it
// should ever be re-interpreted as shell syntax, only the identical
// character actually typed by the user should be. See expandAll() and
// protectExpansionChars() in parser.js for where these get applied, and
// restoreGlobChars() for where they (along with the two above) get
// swapped back to the real character, right before a command actually
// runs.
const OPAQUE_DQUOTE_PLACEHOLDER = "\uE010";
const OPAQUE_SQUOTE_PLACEHOLDER = "\uE011";
const OPAQUE_BACKSLASH_PLACEHOLDER = "\uE012";
const OPAQUE_DOLLAR_PLACEHOLDER = "\uE013";
const OPAQUE_SEMICOLON_PLACEHOLDER = "\uE014";
const OPAQUE_PIPE_PLACEHOLDER = "\uE015";
const OPAQUE_AMP_PLACEHOLDER = "\uE016";
const OPAQUE_GT_PLACEHOLDER = "\uE017";
const OPAQUE_LT_PLACEHOLDER = "\uE018";