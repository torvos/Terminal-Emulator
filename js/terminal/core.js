/**
 * TerminalEngine
 * ---------------
 * The central class that owns all terminal state (DOM references, command
 * history, current working directory, environment variables, aliases,
 * the pager, and the full-screen editor) and coordinates boot-up,
 * persistence, and shared helper utilities used by other terminal/*.js
 * files (input.js, execute.js, parser.js, render.js, editor.js, bootstrap.js).
 */
/**
 * Thrown to stop whatever command is running when the user presses
 * Ctrl+C (see requestInterrupt()/checkInterrupt() below). It unwinds out
 * of the running command, through execute(), up to handleEnter() in
 * input.js, which is the one place that catches it. Anything in between
 * that catches errors must re-throw this one - see the catch blocks in
 * execute.js.
 */
class TerminalInterrupt extends Error {
    constructor() {
        super("Interrupted");
        this.name = "TerminalInterrupt";
    }
}

class TerminalEngine {

    constructor() {
        // Cache references to the DOM elements the terminal renders into/reads from.
        this.output = document.getElementById("output");
        this.promptEl = document.getElementById("prompt");
        this.commandEl = document.getElementById("command");
        this.cursorEl = document.getElementById("cursor");
        this.hiddenInput = document.getElementById("hidden-input"); // captures real keyboard input
        this.editorContainer = document.getElementById("editor-container");
        this.editorEl = document.getElementById("editor");

        // Current shell input line and command history state
        this.currentInput = "";
        this.history = [];
        this.historyIndex = -1;
        this.cursorPos = 0;

        // Tracks whether the boot sequence has already played (persisted across
        // reloads so returning users don't see the boot animation every time).
        this.hasbooted = 0;

        this.cwd = HOME;                  // current working directory
        this.lastExpansionEmpty = false;  // set by parser when a glob/expansion matched nothing
        this.lastExitCode = EXIT_SUCCESS; // exit status of the last executed command
        this.sessionStart = Date.now();

        // True from the moment Enter starts a command until that command
        // has completely finished. While it is set, typing is ignored and
        // Enter can't start a second command on top of the first - see
        // handleEnter() and the keydown handler in input.js.
        this.busy = false;
        // Set by Ctrl+C while a command is running; the command stops at
        // its next checkInterrupt()/sleep(). Cleared when it has stopped.
        this.interruptRequested = false;
        // Cancel functions for delays currently being waited on, so an
        // interrupt can end them immediately instead of waiting them out.
        this._pendingDelays = new Set();   // when this page/tab session began (used by `neofetch`'s Uptime)

        // Wire up keyboard/DOM event listeners (defined in js/terminal/input.js)
        this.bindEvents();

        this.version = TERMINAL_VERSION;

        // Set whenever something has actually changed the virtual
        // filesystem since it was last persisted (a mutating command ran,
        // an output redirect wrote to a file, the editor saved, ...).
        // saveSettings() only pays the cost of re-serializing the whole
        // FileSystem tree when this is true - see saveSettings() below
        // and the `mutatesFilesystem` flag on command definitions.
        this.fsDirty = false;

        // Tracks, per seed file path (resume.md, contact.md, etc.), the
        // last seedVersion reconciled for this profile - see
        // reconcileSeed() in filesystem.js. Populated from saved settings
        // (or left empty for a fresh profile) in init().
        this.seedSync = {};

        // State for the `more`/`less`-style pager used by commands with long output
        this.pager = {
            active: false,
            linesPrinted: 0,
            pageSize: 0,
            resolver: null // Promise resolver used to pause execution until the user pages through
        };

        // State for the full-screen text editor (see js/terminal/editor.js)
        this.editor = {
            active: false,
            node: null,
            path: "",
            content: "",
            cursor: 0,
            modified: false
        };

        // Default environment variables, mirroring a typical Unix shell
        this.env = {
            HOME: HOME,
            USER: DEFAULT_USER,
            HOSTNAME: HOSTNAME,
            PWD: HOME,
            OLDPWD: HOME,
            SHELL: "/bin/bash",
            PATH: "/bin:/usr/bin",
            EDITOR: "edit",
            SCRIPTDEBUG: "false"
        };

        // Built-in default aliases; user-defined ones merge in on top during init()
        this.aliases = { ...DEFAULT_ALIASES };

        // Reference to the virtual filesystem API (see js/filesystem.js)
        this.fs = FileSystemAPI;
    }

    /**
     * Boots the terminal: restores any saved session/filesystem from
     * localStorage, plays (or skips) the boot animation, prints the
     * welcome banner, optionally auto-runs a command from the URL query
     * string, and finally renders the prompt so the user can start typing.
     */
    async init() {
        this.inputMode = INPUT_NORMAL;

        // Attempt to restore previous session settings (history, cwd, env, aliases)
        const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
        let settingsWereCorrupted = false;
        if (savedSettings) {
            let settings = null;
            try {
                settings = JSON.parse(savedSettings);
            } catch (err) {
                // Corrupted/invalid JSON (e.g. manual edit, partial write) —
                // wipe it out and fall back to defaults rather than throwing
                // and leaving the terminal unable to boot at all.
                localStorage.removeItem(STORAGE_KEY_SETTINGS);
                localStorage.removeItem(STORAGE_KEY_FILESYSTEM);
                settingsWereCorrupted = true;
            }

            // Valid JSON isn't necessarily a valid settings object (e.g.
            // `null`, a number, an array) - treat that as corrupted too.
            if (!settingsWereCorrupted &&
                (typeof settings !== "object" || settings === null || Array.isArray(settings))) {
                localStorage.removeItem(STORAGE_KEY_SETTINGS);
                settings = null;
                settingsWereCorrupted = true;
            }

            if (settings) {
                // Note: there's no version check/wipe here anymore. A
                // saved session from an older TERMINAL_VERSION is merged
                // on top of today's defaults, and any seed CONTENT that
                // changed between versions is reconciled file-by-file
                // below via reconcileSeed().
                //
                // Nothing read from storage is trusted as-is: every field
                // is type-checked by sanitizeSettings() first, and a field
                // that fails falls back to its default.
                const clean = this.sanitizeSettings(settings);
                this.history = clean.history;
                this.historyIndex = clean.historyIndex;
                this.hasbooted = clean.hasbooted;
                this.cwd = clean.cwd;
                this.seedSync = clean.seedSync;

                // Merge saved env/aliases on top of the defaults so new default
                // keys introduced in later versions still show up.
                this.env = { ...this.env, ...clean.env };
                this.aliases = { ...this.aliases, ...clean.aliases };
            }
        }

        // Attempt to restore the saved virtual filesystem
        const savedFileSystem = localStorage.getItem(STORAGE_KEY_FILESYSTEM);
        let filesystemWasCorrupted = false;
        if (savedFileSystem) {
            const restored = FileSystemAPI.restore(savedFileSystem);
            if (!restored) {
                // Restore failed (e.g. corrupted/invalid JSON) — fall back to defaults
                localStorage.removeItem(STORAGE_KEY_FILESYSTEM);
                filesystemWasCorrupted = true;
            }
        }

        // Bring the starter seed files (resume.md, contact.md, etc.) up to
        // date with whatever this version of the code ships, without
        // touching anything else in the user's filesystem - see
        // reconcileSeed()'s own docs in filesystem.js for the exact rules
        // (missing/outdated files are (re)written from the current seed
        // content whenever their seedVersion moves forward, even if the
        // user had edited or deleted them; everything else is untouched).
        const { seedSync, changes: seedChanges } = FileSystemAPI.reconcileSeed(this.seedSync);
        this.seedSync = seedSync;

        // The saved working directory has to still exist as a directory in
        // the filesystem that was actually restored (the two are saved
        // separately, so they can disagree). If it doesn't, start from
        // home - or from / if home itself was deleted.
        if (!this.fs.isDirectory(this.cwd, ROOT)) {
            this.cwd = this.fs.isDirectory(HOME, ROOT) ? HOME : ROOT;
        }
        this.env.PWD = this.cwd;

        const params = new URLSearchParams(window.location.search);
        await this.write(`Torvos v${this.version}`, {color: "#c707ce"});
        if (settingsWereCorrupted) {
            await this.write(`[WARN] Saved session settings were corrupted, restored defaults..[FAIL]`, {color: COLOR_WARNING});
        }
        if (filesystemWasCorrupted) {
            await this.write(`[WARN] Saved filesystem was corrupted, restored defaults..[FAIL]`, {color: COLOR_WARNING});
        }
        for (const change of seedChanges) {
            const verb = change.action === "added" ? "added" : "updated";
            await this.write(`[INFO] ${change.path} was ${verb} by the developer.......[ OK ]`, {color: COLOR_STDOUT});
        }

        // `?quickboot` query param lets you skip straight to a "resumed session" state
        if (params.has("quickboot")){
            this.hasbooted = 1;
        }

        if (this.hasbooted === 1){
            // Returning session: skip the animated boot sequence
            await this.write(`[INFO] Resuming previous session.................[ OK ]`, {color: COLOR_STDOUT});
        } else if (this.hasbooted === 0) {
            // First-ever boot: play the animated "typing" boot sequence
            await this.typeItOut(`Initializing kernel................ [ OK ]`);
            await this.typeItOut(`Mounting virtual filesystem........ [ OK ]`);
            await this.typeItOut(`Starting network stack............. [ OK ]`);
            await this.typeItOut(`Loading user profile............... [ OK ]`);
            await this.typeItOut(`Establishing secure session........ [ OK ]`);
            this.hasbooted = 1;
        }

        // Seed the virtual filesystem with standard /bin and /dev entries
        createVirtualBin();
        createVirtualDev();

        // Print the ASCII-art welcome banner
        await this.write(`+------------------------------------------------------+`, {color: COLOR_STDOUT});
        await this.write(`| ████████╗ ██████╗ ██████╗ ██╗   ██╗ ██████╗ ███████╗ |`, {color: COLOR_STDOUT});
        await this.write(`| ╚══██╔══╝██╔═══██╗██╔══██╗██║   ██║██╔═══██╗██╔════╝ |`, {color: COLOR_STDOUT});
        await this.write(`|    ██║   ██║   ██║██████╔╝██║   ██║██║   ██║███████╗ |`, {color: COLOR_STDOUT});
        await this.write(`|    ██║   ██║   ██║██╔══██╗╚██╗ ██╔╝██║   ██║╚════██║ |`, {color: COLOR_STDOUT});
        await this.write(`|    ██║   ╚██████╔╝██║  ██║ ╚████╔╝ ╚██████╔╝███████║ |`, {color: COLOR_STDOUT});
        await this.write(`|    ╚═╝    ╚═════╝ ╚═╝  ╚═╝  ╚═══╝   ╚═════╝ ╚══════╝ |`, {color: COLOR_STDOUT});
        await this.write(`|                Welcome to Torvos.ca                  |`, {color: COLOR_STDOUT});
        await this.write(`+------------------------------------------------------+`, {color: COLOR_STDOUT});

        // Short getting-started message: how to interact + the quick-look aliases
        // (defined in DEFAULT_ALIASES in constants.js).
        await this.write(``, {color: COLOR_STDOUT});
        await this.write(`This is an interactive terminal: type a command and`, {color: COLOR_STDOUT});
        await this.write(`press Enter. Tab completes names. Try these:`, {color: COLOR_STDOUT});
        await this.write([
            {text: `  resume   `, color: COLOR_HEADING},
            {text: `read my resume`, color: COLOR_STDOUT}
        ]);
        await this.write([
            {text: `  about    `, color: COLOR_HEADING},
            {text: `about this site`, color: COLOR_STDOUT}
        ]);
        await this.write([
            {text: `  contact  `, color: COLOR_HEADING},
            {text: `how to reach me`, color: COLOR_STDOUT}
        ]);
        await this.write(`Type 'help' for more commands.`, {color: COLOR_STDOUT});
        await this.write(``, {color: COLOR_STDOUT});

        // Compute how many output lines fit on screen, used by the pager
        const style = getComputedStyle(document.documentElement);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(getComputedStyle(document.body).lineHeight);
        this.pager.pageSize = Math.floor(document.getElementById("terminal").clientHeight / lineHeight) - 1;
        
        this.renderPrompt();     
        this.renderInput();   
        // Boot-time save: always persist the filesystem here, since seed
        // reconciliation above may have added/updated files even on a
        // returning session where nothing else would otherwise mark
        // fsDirty this turn.
        this.saveSettings({ forceFs: true });
        this.hiddenInput.focus();

        // `?run=<command>` lets a URL auto-type and auto-execute a command
        // on load. This is deliberately the LAST step of booting, and is
        // awaited: the command runs exactly as if it had been typed at the
        // finished prompt, with the pager size, prompt and boot-time save
        // above already in place, and init() only resolves once the
        // command has finished (handleEnter() does its own save then).
        if (params.has("run")) {
            const command = params.get("run");
            this.currentInput = command;
            this.cursorPos = command.length;
            this.renderInput();
            await this.handleEnter();
        }
    }

    /**
     * Turns whatever was parsed out of the saved-settings JSON into a
     * settings object that is safe to use: every field is checked for the
     * right type and a sensible size, and anything that fails is replaced
     * by its default (or, inside a list/map, just that one entry is
     * dropped). Never throws, whatever it is given.
     *
     * The settings come from localStorage, which the visitor - or any
     * script that ever ran on this origin - can edit freely, so they are
     * treated as untrusted input, the same way FileSystemAPI.restore()
     * treats the saved filesystem.
     *
     * Note: `cwd` is only checked for being a plausible path here. Whether
     * it actually exists is checked in init(), once the filesystem has
     * been restored.
     *
     * @param {*} raw - The parsed JSON value.
     * @returns {{history: string[], historyIndex: number, hasbooted: number,
     *   cwd: string, seedSync: Object, env: Object, aliases: Object}}
     */
    sanitizeSettings(raw) {
        const isPlainObject = (value) =>
            typeof value === "object" && value !== null && !Array.isArray(value);
        const source = isPlainObject(raw) ? raw : {};

        // Names that must never become keys of env/aliases/seedSync.
        const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

        // Keeps only string -> string entries with safe, reasonably sized
        // keys and values (used for both env and aliases).
        const cleanStringMap = (value) => {
            const result = {};
            if (!isPlainObject(value)) return result;
            let kept = 0;
            for (const [key, entry] of Object.entries(value)) {
                if (kept >= MAX_SETTINGS_ENTRIES) break;
                if (key === "" || key.length > FS_MAX_NAME_LENGTH || UNSAFE_KEYS.has(key)) continue;
                if (typeof entry !== "string" || entry.length > MAX_SETTINGS_VALUE_CHARS) continue;
                result[key] = entry;
                kept++;
            }
            return result;
        };

        const history = Array.isArray(source.history)
            ? source.history
                .filter(entry => typeof entry === "string" && entry !== "" && entry.length <= MAX_HISTORY_ENTRY_CHARS)
                .slice(-MAX_HISTORY)
            : [];

        const historyIndex =
            Number.isInteger(source.historyIndex) &&
            source.historyIndex >= -1 &&
            source.historyIndex <= history.length
                ? source.historyIndex
                : history.length;

        const cwd =
            typeof source.cwd === "string" && source.cwd.startsWith(ROOT) && source.cwd.length <= 4096
                ? source.cwd
                : HOME;

        const seedSync = {};
        if (isPlainObject(source.seedSync)) {
            for (const [path, version] of Object.entries(source.seedSync)) {
                if (UNSAFE_KEYS.has(path) || !path.startsWith(ROOT)) continue;
                if (!Number.isFinite(version)) continue;
                seedSync[path] = version;
            }
        }

        return {
            history,
            historyIndex,
            hasbooted: source.hasbooted === 1 ? 1 : 0,
            cwd,
            seedSync,
            env: cleanStringMap(source.env),
            aliases: cleanStringMap(source.aliases)
        };
    }

    /**
     * Persists terminal session state (history, cwd, env, aliases, etc.)
     * to localStorage, and - only when needed - the virtual filesystem
     * too, so both survive page reloads.
     *
     * The session settings are cheap (a small object) and are always
     * saved. Serializing the FileSystem tree is comparatively expensive
     * and grows with however much the user has created/edited, so it's
     * only done when `this.fsDirty` is set (or `forceFs` is passed) -
     * otherwise this would re-serialize and rewrite the entire virtual
     * filesystem after every single command, including plain reads like
     * `ls` or `cat` that never touched it.
     * @param {Object} [options]
     * @param {boolean} [options.forceFs=false] - Save the filesystem even
     *   if `fsDirty` is false (used at boot, right after seed reconciliation
     *   may have changed it).
     */
    saveSettings({ forceFs = false } = {}){
        const terminalSettings = {
            history: this.history,
            historyIndex: this.historyIndex,
            cursorPos: this.cursorPos,
            hasbooted: this.hasbooted,
            version: this.version,
            cwd: this.cwd,
            env: this.env,
            aliases: this.aliases,
            seedSync: this.seedSync
        };

        // localStorage.setItem can throw (quota exceeded, private-browsing
        // mode, storage disabled, etc.) — catch it so a save failure just
        // means "this session isn't persisted", not "the terminal breaks".
        try {
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(terminalSettings));
            if (forceFs || this.fsDirty) {
                localStorage.setItem(STORAGE_KEY_FILESYSTEM, FileSystemAPI.serialize());
                this.fsDirty = false;
            }
        } catch (err) {
            console.error("Torvos: failed to save session to localStorage", err);
            if (!this._storageWriteWarned) {
                this._storageWriteWarned = true;
                this.write(
                    `[WARN] Unable to save session (storage full or unavailable) - your changes won't persist across reloads.`,
                    {color: COLOR_WARNING}
                );
            }
        }
    }

    /**
     * Parses a command's argument array into long/short flags, options with
     * values, and remaining positional arguments — similar to a lightweight
     * getopt. Supports:
     *   - `--` to stop flag parsing and treat the rest as positional args
     *   - `--name=value` and `--name value` long options
     *   - `-x` short boolean flags, including clustered flags like `-la`
     *   - `-xVALUE` / `-x VALUE` short options that take a value
     *
     * @param {string[]} args - Raw argument tokens (command name excluded).
     * @param {Object} [flagSpec] - Map of flag/option name -> true if it expects
     *   a value (e.g. `{n: true}` for `-n <num>`), or omitted/false for a
     *   plain boolean flag.
     * @returns {{flags: Set<string>, options: Object, args: string[]}}
     *   flags: boolean flags that were present (without leading dashes)
     *   options: flag name -> string value, for flags that take a value
     *   args: remaining non-flag positional arguments
     */
    parseFlags(args, flagSpec = {}) {
        const flags = new Set();
        const options = {};
        const remaining = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            // `--` ends flag parsing; everything after is positional
            if (arg === "--") {
                remaining.push(...args.slice(i + 1));
                break;
            }

            if (arg.startsWith("--")) {
                // Long option, e.g. --color or --color=auto
                const eq = arg.indexOf("=");
                if (eq !== -1) {
                    const name = arg.substring(2, eq);
                    const value = arg.substring(eq + 1);
                    if (flagSpec[name] === true) {
                        options[name] = value;
                    } else {
                        flags.add(name);
                    }
                } else {
                    const name = arg.substring(2);
                    if (flagSpec[name] === true) {
                        // Expects a value from the next argument
                        if (i + 1 >= args.length) {
                            throw new Error(`Missing value for --${name}`);
                        }
                        options[name] = args[++i];
                    } else {
                        flags.add(name);
                    }
                }
                continue;
            }

            // Not a flag at all (bare "-" or doesn't start with "-") -> positional arg
            if (arg === "-" || !arg.startsWith("-")) {
                remaining.push(arg);
                continue;
            }

            // Short flag or cluster of short flags, e.g. -l, -la, -n5
            const wholeFlag = arg.substring(1);

            if (flagSpec.hasOwnProperty(wholeFlag)) {
                // The whole thing after "-" matches a single known flag/option name
                if (flagSpec[wholeFlag] === true) {
                    if (i + 1 >= args.length) {
                        throw new Error(`Missing value for -${wholeFlag}`);
                    }
                    options[wholeFlag] = args[++i];
                } else {
                    flags.add(wholeFlag);
                }
                continue;
            }

            // Otherwise treat it as a cluster of single-character flags (e.g. -la = -l -a)
            const cluster = wholeFlag;
            for (let j = 0; j < cluster.length; j++) {
                const flag = cluster[j];
                if (flagSpec[flag] === true) {
                    if (j < cluster.length - 1) {
                        // Remainder of the cluster is treated as this flag's inline value,
                        // e.g. -n5 -> flag "n" with value "5"
                        options[flag] = cluster.substring(j + 1);
                        break;
                    }
                    // Value-taking flag was the last char in the cluster -> take next arg
                    if (i + 1 >= args.length) {
                        throw new Error(`Missing value for -${flag}`);
                    }
                    options[flag] = args[++i];
                    break;
                } else {
                    flags.add(flag);
                }
            }
        }

        return {
            flags,
            options,
            args: remaining
        };
    }

    /**
     * Returns a Promise that resolves after the given delay.
     * Used to animate boot text / simulate latency for commands like ping.
     * Ends early, by throwing TerminalInterrupt, if Ctrl+C is pressed
     * while a command is running.
     * @param {number} ms - Milliseconds to wait.
     */
    sleep(ms) {
        return this.interruptibleDelay(ms);
    }

    /**
     * The real implementation behind sleep(). Kept separate so the `sleep`
     * command can call it directly: the test harness replaces sleep() with
     * a no-op to skip animation delays, which must not turn `sleep 2`
     * itself into a no-op.
     * @param {number} ms - Milliseconds to wait.
     * @returns {Promise<void>} Resolves after the delay; rejects with
     *   TerminalInterrupt if the running command is interrupted first.
     */
    interruptibleDelay(ms) {
        if (this.interruptRequested) {
            return Promise.reject(new TerminalInterrupt());
        }
        return new Promise((resolve, reject) => {
            const cancel = () => {
                clearTimeout(timer);
                this._pendingDelays.delete(cancel);
                reject(new TerminalInterrupt());
            };
            const timer = setTimeout(() => {
                this._pendingDelays.delete(cancel);
                resolve();
            }, ms);
            this._pendingDelays.add(cancel);
        });
    }

    /**
     * Stops the running command if Ctrl+C has been pressed, by throwing
     * TerminalInterrupt. Called at the points where it is safe to stop:
     * before each command in a pipeline, before each printed line, and on
     * every loop iteration of a script. Does nothing otherwise.
     */
    checkInterrupt() {
        if (this.interruptRequested) {
            throw new TerminalInterrupt();
        }
    }

    /**
     * Asks the running command to stop (Ctrl+C). Ends any delay it is
     * waiting on and closes a "--More--" pager prompt if one is open, so
     * the command reaches a checkInterrupt() right away.
     * @returns {boolean} true if a command was running, false if there
     *   was nothing to interrupt.
     */
    requestInterrupt() {
        if (!this.busy) {
            return false;
        }
        this.interruptRequested = true;
        for (const cancel of [...this._pendingDelays]) {
            cancel();
        }
        if (this.pager.active) {
            this.output.lastChild?.remove(); // the "--More--" line
            this.pager.active = false;
            this.pager.linesPrinted = 0;
            this.pager.resolver(false);
        }
        return true;
    }

    /**
     * Calculates how many text lines currently fit in the visible terminal
     * area, used by the pager to decide when to pause output ("--More--").
     * @returns {number} Number of lines that fit on screen (minus one for the prompt).
     */
    getPageSize() {
        const terminal = document.getElementById("terminal");
        const lineHeight = parseFloat(getComputedStyle(document.body).lineHeight);

        return Math.floor(terminal.clientHeight / lineHeight) - 1;
    }
}
