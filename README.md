# Terminal Emulator

A Unix-style terminal that runs entirely in the browser. It powers
[torvos.ca](https://torvos.ca), where it serves as a personal site: visitors
land at a shell prompt and explore the résumé, contact details and other
content by typing commands such as `ls`, `cat resume.md` or `help`.

There is no backend, no build step and no dependencies. It is plain HTML, CSS
and JavaScript served as static files, with the session saved in the visitor's
own browser.

## Features

- **A real shell pipeline.** Pipes (`|`), `&&` / `||` / `;`, redirection
  (`>`, `>>`, `<`, `2>`, `2>>`), quoting and escaping, globbing (`*`, `?`),
  brace expansion (`file{1,2}.txt`), variables (`$VAR`, `${VAR}`, `$?`),
  command substitution (`$(...)`) and arithmetic (`$((...))`).
- **83 commands**, each with `--help` and a `man` page.
- **A virtual filesystem** with directories, files, symlinks, permissions and
  ownership, protected system paths (`/bin`, `/dev`) and working device files
  (`/dev/null`, `/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/full`).
- **Shell scripting** through `sh`: `if`/`elif`/`else`, `for` and `while`
  loops, `break`/`continue`, positional parameters and `[ ]` tests.
- **A built-in text editor** (`edit <file>`): Ctrl+S saves, Ctrl+X saves and
  exits, Esc exits without saving.
- **Readline-style input**: history with the arrow keys and `!!` / `!N`, Tab
  completion for commands and paths, and Ctrl+A / E / U / K / W / L / C.
- **Aliases and environment variables**, including the site shortcuts
  `resume`, `about` and `contact`.
- **Persistent sessions.** The filesystem, history, environment and aliases
  are saved to `localStorage` and restored on the next visit. `reset` returns
  everything to the defaults.
- **Mobile support**, with on-screen Tab and Esc buttons for touch keyboards.

## Commands

| Area | Commands |
| --- | --- |
| Navigation and files | `ls` `cd` `pwd` `tree` `find` `stat` `du` `df` `mkdir` `rmdir` `touch` `cp` `mv` `rm` `ln` `chmod` `basename` `dirname` |
| Viewing and editing | `cat` `head` `tail` `more` `less` `nl` `edit` |
| Text processing | `grep` `sed` `sort` `uniq` `cut` `tr` `wc` `rev` `diff` `tee` `xargs` `seq` `expr` `echo` `printf` `base64` `md5sum` `sha256sum` |
| Shell and environment | `sh` `alias` `unalias` `export` `unset` `env` `printenv` `history` `which` `true` `false` `sleep` `clear` `reset` |
| System information | `whoami` `id` `hostname` `uname` `uptime` `date` `cal` `ps` `free` `kill` `neofetch` |
| Help | `help` `man` |
| Simulated (always refused for the guest user) | `curl` `wget` `ping` `dig` `nslookup` `whois` `nmap` `finger` `sudo` `login` |
| Fun | `cowsay` `fortune` `sl` |

The network and privilege commands never make real requests. They exist so
the terminal answers in character.

## Running it locally

Serve the project root with any static file server and open it in a browser:

```bash
python3 -m http.server
```

Then visit `http://localhost:8000`. Add `?quickboot` to the URL to skip the
boot animation, or `?run=<command>` to run a command on load (for example
`?run=resume` to link someone straight to the résumé).

The live site is deployed with GitHub Pages straight from this repository;
`CNAME` sets the custom domain.

## How it works

`index.html` loads every script with a plain `<script>` tag, in dependency
order. There are no modules and no bundler; the pieces share a small set of
globals.

```
index.html              Page shell and script load order
css/                    Terminal styling and animations
js/
  constants.js          Version, colours, exit codes, storage keys, size limits, default aliases
  commands.js           Command registry (registerCommand) and shared input helper
  app.js                Entry point: creates the TerminalEngine and boots it
  commands/             One file per command
  filesystem/
    seed.js             Default filesystem tree, including the site's content
    fileapi.js          FileSystemAPI: path resolution, read/write, limits, save/restore
    nodes.js            Node constructors
    mode.js             Permission modes
    format.js           Formatting helpers
    devices.js          Handlers for the /dev files
  terminal/
    core.js             TerminalEngine: state, boot and welcome banner, persistence, flag parsing
    parser.js           Tokenising, quoting, expansions, redirect parsing, aliases
    arithmetic.js       Evaluator for $((...))
    execute.js          Pipeline: sequencing, pipes, redirects, command dispatch
    input.js            Keyboard handling, history, Tab completion
    render.js           Output, prompt, cursor, typewriter effect, pager
    editor.js           Full-screen editor
    bootstrap.js        Builds the virtual /bin from the registered commands
tests/                  Regression suite (see tests/README.md)
test.html               Browser test runner
```

A typed line travels through the engine like this:

1. `input.js` collects keystrokes and, on Enter, handles history expansion
   and passes the line to `execute()`.
2. `parser.js` expands aliases, braces and every `$` expansion, then splits
   the line into statements, and-or lists and pipeline stages.
3. `execute.js` opens each stage's redirects, expands wildcards, looks the
   command up in `window.Commands` and runs it, feeding each stage's output
   to the next.
4. The command returns `{ stdout, stderr, exitCode }`, which `render.js`
   prints or the pipeline passes on.
5. If anything changed, `core.js` saves the settings and filesystem to
   `localStorage`.

### Persistence and limits

The whole filesystem is stored as a single JSON string, so it is capped to
stay inside the browser's `localStorage` quota: 250,000 characters per file,
750,000 in total and 2,000 nodes. Saved data is validated when it is read
back, and a corrupted save falls back to the defaults instead of breaking the
page.

Files in `seed.js` that carry a `seedVersion` are refreshed for returning
visitors when that number is bumped, so content updates reach people who
already have a saved session without wiping the rest of their files.

## Adding a command

1. Create `js/commands/<name>.js`:

   ```js
   registerCommand("hello", {
       name: "Print a greeting.",
       synopsis: "hello [NAME]",
       description: "Greets NAME, or the world if no name is given.",
       options: [],
       examples: ["hello Ada"],
       async execute(terminal, args, stdin) {
           return {
               stdout: `Hello, ${args[0] || "world"}!`,
               stderr: "",
               exitCode: EXIT_SUCCESS
           };
       }
   });
   ```

2. Add a matching `<script src="js/commands/hello.js"></script>` tag to both
   `index.html` and `test.html`.
3. Set `mutatesFilesystem: true` on the command if it changes files, so the
   filesystem is saved after it runs.

The metadata fields feed `man` and `--help`.

## Making it your own

The engine is not tied to torvos.ca. To reuse it for your own site:

- Replace the content under `/home/guest` in `js/filesystem/seed.js`.
- Change `HOSTNAME`, `DEFAULT_USER` and `DEFAULT_ALIASES` in `js/constants.js`.
- Edit the welcome banner in `js/terminal/core.js` and the `help` text
  in `js/commands/help.js`.
- Update the page title in `index.html`, and replace or remove `CNAME`.

## Tests

The suite boots the real app and drives it through the actual command
pipeline. It needs only Node, with nothing to install:

```bash
node tests/run-tests.js
```

It can also run in a browser by opening `/test.html` from a local server,
which uses an isolated in-memory store so it never touches a saved session.
[tests/README.md](tests/README.md) covers how to add tests.

## License

Released under the [MIT License](LICENSE).
