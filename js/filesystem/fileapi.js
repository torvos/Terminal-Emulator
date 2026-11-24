/**
 * Virtual filesystem module for the terminal: path resolution, mode
 * parsing/formatting, node creation, wildcard expansion, and the public
 * window.FileSystemAPI facade built on top of them.
 *
 * Wrapped in an IIFE so `FileSystem` (the actual tree of files/directories)
 * and all the helper functions above stay private; only window.FileSystemAPI
 * is exposed globally.
 *
 * Each node in the tree is a plain object with a `type` of "dir", "file",
 * "symlink", or "device", plus standard Unix-like metadata (mode, owner,
 * group, created/modified/accessed timestamps) and either `children`
 * (for dirs), `content` (for files), or `target` (for symlinks).
 *
 * The default seed tree `FileSystem` starts out as (what a fresh session
 * starts with, and what `reset` restores) lives in filesystem-seed.js -
 * see the comment on `let FileSystem = ...` just below. The /dev/* device
 * file handlers (window.FileDevices) live in their own filedevices.js,
 * since they're fully self-contained and don't need access to the tree.
 */
(function() {
    // Seed data lives in filesystem-seed.js (loaded just before this file)
    // as a temporary global - pull it into our own private `FileSystem`
    // variable and remove the global immediately so nothing outside this
    // closure can reach the raw tree afterward.
    let FileSystem = window.__DEFAULT_FILESYSTEM_SEED__;
    delete window.__DEFAULT_FILESYSTEM_SEED__;

    /**
     * Makes every directory's `children` table in a tree a "bare" object
     * (one with no prototype), in place, and returns the tree.
     *
     * Why: `children` is looked up by file name all over the codebase
     * (`node.children[name]`), and names come from the user. On an
     * ordinary object, names such as "constructor", "toString" or
     * "__proto__" would find JavaScript's own built-in properties instead
     * of "no such file" - so `cat constructor` would "find" something,
     * and `touch __proto__` would write onto the prototype every object
     * shares. A bare object has no built-in properties, so a name is
     * only ever found if a file by that name was really created.
     *
     * Objects made by JSON.parse(), structuredClone() or an object
     * literal are ordinary ones, so this must be applied to any tree
     * that comes from one of those before it joins the filesystem - see
     * the call sites below and normalizeTree() in the public API.
     */
    function bareChildren(root) {
        const pending = [root];
        while (pending.length > 0) {
            const node = pending.pop();
            if (node && typeof node.children === "object" && node.children !== null) {
                Object.setPrototypeOf(node.children, null);
                for (const name of Object.keys(node.children)) {
                    pending.push(node.children[name]);
                }
            }
        }
        return root;
    }
    bareChildren(FileSystem[ROOT]);

    // How many levels a node and everything under it span: 1 for a file
    // or an empty directory, 2 for a directory holding files, and so on.
    function treeHeight(root) {
        let height = 0;
        const pending = [[root, 1]];
        while (pending.length > 0) {
            const [node, level] = pending.pop();
            if (level > height) height = level;
            if (node && node.children) {
                for (const name of Object.keys(node.children)) {
                    pending.push([node.children[name], level + 1]);
                }
            }
        }
        return height;
    }

    // How many levels below "/" a node that is already in the tree sits
    // (0 for "/" itself), or -1 if it isn't in the tree.
    function depthOf(target) {
        const pending = [[FileSystem[ROOT], 0]];
        while (pending.length > 0) {
            const [node, depth] = pending.pop();
            if (node === target) return depth;
            if (node && node.children) {
                for (const name of Object.keys(node.children)) {
                    pending.push([node.children[name], depth + 1]);
                }
            }
        }
        return -1;
    }

    // Same pattern as the seed data above: mode.js/format.js/nodes.js each
    // load just before this file and expose their functions as a temporary
    // global, which is pulled into local scope here and immediately deleted -
    // so, just like before those files existed, nothing beyond
    // window.FileSystemAPI is left reachable once this module has loaded.
    // (See the comment at the top of each of those files for why they're
    // safe to split out: none of them touch the `FileSystem` variable above.)
    const { numericToMode, symbolicToMode } = window.__FS_MODE_HELPERS__;
    delete window.__FS_MODE_HELPERS__;
    const { formatSize, getDirectorySize, getSize, formatDate, getLinkCount, formatLongEntry } = window.__FS_FORMAT_HELPERS__;
    delete window.__FS_FORMAT_HELPERS__;
    const { walkSeedNodes, createLink, createFile, createDirectory } = window.__FS_NODE_HELPERS__;
    delete window.__FS_NODE_HELPERS__;

    // Snapshot of the default tree (as JSON) kept around so the filesystem
    // can be restored to factory defaults (via `reset` or a corrupted save).
    const DEFAULT_FILESYSTEM_JSON = JSON.stringify(FileSystem);

    // ---------------------------------------------------------------------
    // Structural validation for a restored (JSON.parse()'d) filesystem
    // tree - see restore() below, which is the only place these are used.
    // A tree can be syntactically valid JSON yet not something the rest of
    // this module can safely walk (hand-edited localStorage, a partial/
    // truncated write, a future save format this version doesn't
    // understand, ...) - letting that through would just crash later, in
    // a far more confusing place (resolvePath, ls, ...) than right here at
    // load time.
    // ---------------------------------------------------------------------

    const VALID_NODE_TYPES = new Set(["dir", "file", "symlink", "device"]);
    // 9-character symbolic mode, e.g. "rwxr-xr-x" - each of the 9
    // positions is either a dash or the one specific letter valid there.
    const MODE_PATTERN = /^[-r][-w][-x][-r][-w][-x][-r][-w][-x]$/;
    // Property names that could shadow/pollute the object prototype chain
    // if let through as a child (file/directory) name from untrusted saved
    // data - JSON.parse itself produces safe own-properties even for a key
    // literally named "__proto__", but nothing downstream should have to
    // rely on that; reject them as invalid data instead.
    const UNSAFE_CHILD_NAMES = new Set(["__proto__", "constructor", "prototype"]);
    // (Creating an entry with one of these names is refused up front by
    // checkName() below, so a tree made through the terminal never
    // contains them.)
    // Sanity cap on how deeply nested the tree is allowed to be while
    // validating it - not a realistic limit for any real filesystem, just
    // a guard against a maliciously/corruptly deep JSON payload blowing
    // the stack while isValidNode() walks it recursively.
    // It must stay comfortably above FS_MAX_DEPTH (constants.js), the
    // depth the terminal lets anyone actually create - see the comment
    // there for what goes wrong otherwise.
    const MAX_TREE_DEPTH = 200;

    function isPlainObject(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    /**
     * Recursively validates that `node` (and, for a directory, everything
     * beneath it) is a structurally sound filesystem node: a real object
     * with a recognized `type`, well-formed standard metadata (mode/
     * owner/group/created/modified), and whatever shape that particular
     * `type` requires - a directory needs a `children` object of further
     * valid nodes, a file/device needs string `content`, a symlink needs a
     * non-empty string `target`. This is a STRUCTURAL check only - it
     * doesn't, for example, verify a symlink's target actually resolves to
     * something (dangling symlinks are perfectly legitimate), only that
     * the node has the shape the rest of this module assumes it does.
     * @param {*} node
     * @param {number} [depth=0] - Current recursion depth (see MAX_TREE_DEPTH).
     * @returns {boolean}
     */
    function isValidNode(node, depth = 0) {
        if (depth > MAX_TREE_DEPTH) return false;
        if (!isPlainObject(node)) return false;
        if (!VALID_NODE_TYPES.has(node.type)) return false;
        if (typeof node.mode !== "string" || !MODE_PATTERN.test(node.mode)) return false;
        if (typeof node.owner !== "string" || node.owner === "") return false;
        if (typeof node.group !== "string" || node.group === "") return false;
        if (!Number.isFinite(node.created)) return false;
        if (!Number.isFinite(node.modified)) return false;
        // A handful of fields are present on most, but not all, node kinds
        // (e.g. the symlinks createLink() makes have no `accessed`/`hidden`
        // field at all) - only check the shape of ones that are actually there.
        if ("accessed" in node && !Number.isFinite(node.accessed)) return false;
        if ("hidden" in node && typeof node.hidden !== "boolean") return false;
        if ("protected" in node && typeof node.protected !== "boolean") return false;
        if ("seedVersion" in node && !Number.isFinite(node.seedVersion)) return false;

        switch (node.type) {
            case "dir":
                if (!isPlainObject(node.children)) return false;
                for (const [name, child] of Object.entries(node.children)) {
                    if (UNSAFE_CHILD_NAMES.has(name)) return false;
                    if (!isValidNode(child, depth + 1)) return false;
                }
                return true;
            case "file":
            case "device":
                return typeof node.content === "string";
            case "symlink":
                return typeof node.target === "string" && node.target !== "";
            default:
                return false; // unreachable - VALID_NODE_TYPES already checked above
        }
    }

    /**
     * Validates an entire parsed filesystem tree (the shape produced by
     * JSON.parse()-ing serialize()'s output): a plain object with a root
     * entry under ROOT ("/") that's itself a valid directory node, and
     * every node beneath it structurally sound - see isValidNode(). Used
     * by restore() to reject a saved tree that's valid JSON but not
     * actually a usable filesystem.
     * @param {*} tree
     * @returns {boolean}
     */
    /**
     * Measures how much of the filesystem's size budget a node uses
     * (including everything under it, for a directory):
     *   chars - content of every file, target of every symlink, and the
     *           name of every child entry
     *   nodes - the node itself plus every node under it
     * See the FS_MAX_* constants in constants.js for what these are
     * compared against.
     */
    function measureNode(node, totals = { chars: 0, nodes: 0 }) {
        if (!node) return totals;
        totals.nodes++;
        if (typeof node.content === "string") totals.chars += node.content.length;
        if (typeof node.target === "string") totals.chars += node.target.length;
        if (node.children) {
            for (const name of Object.keys(node.children)) {
                totals.chars += name.length;
                measureNode(node.children[name], totals);
            }
        }
        return totals;
    }

    function isValidFileSystemTree(tree) {
        if (!isPlainObject(tree)) return false;
        const root = tree[ROOT];
        if (!isPlainObject(root) || root.type !== "dir") return false;
        return isValidNode(root, 0);
    }

    /**
     * Walks an absolute path (already normalized, no "." or "..") down from
     * root, resolving through any symlinks encountered along the way.
     * @param {string} path - Absolute path to resolve.
     * @param {number} [depth=0] - Symlink-following recursion depth guard.
     * @returns {{node: Object, path: string}|null} The resolved node and its
     *   final (post-symlink) path, or null if any segment doesn't exist or
     *   symlinks recurse too deep (possible loop).
     */
    function resolvePath(path, depth = 0) {
        if (depth > 20) {return null;} // guards against symlink loops
        // `path` is always an absolute path by this point (every caller
        // goes through resolveRelativePath() first, which is what turns a
        // leading "~" or "~/" into the home directory). A "~" anywhere
        // else is just an ordinary character in a file name, e.g.
        // "notes.txt~", and must be left alone.
        const parts = path.split(ROOT).filter(Boolean);
        let node = FileSystem[ROOT];
        let currentPath = ROOT;
        for (const part of parts) {
            if (!node.children || !node.children[part]) {return null;}
            node = node.children[part];
            currentPath = currentPath === ROOT
                ? ROOT + part
                : currentPath + ROOT + part;
            while (node.type === "symlink") {
                const linkTarget = node.target.startsWith(ROOT)
                    ? node.target
                    : resolveRelativePath(
                        currentPath.substring(0, currentPath.lastIndexOf(ROOT)),
                        node.target
                    );
                const result = resolvePath(linkTarget, depth + 1);
                if (!result) {
                    return null;
                }
                node = result.node;
                currentPath = result.path;
            }
        }
        return {
            node,
            path: currentPath
        };
    }

    /**
     * Resolves a possibly-relative, possibly "~"-prefixed path into a
     * normalized absolute path (no "." or ".." segments), relative to `cwd`.
     * @param {string} cwd - Current working directory (absolute path).
     * @param {string} path - Path to resolve; may be relative, absolute,
     *   ".", "~", or "~/...".
     * @returns {string} Normalized absolute path.
     */
    function resolveRelativePath(cwd, path) {
        // Collapses "." and ".." segments and re-joins into an absolute path
        function normalizePath(path) {
            const parts = [];
            for (const part of path.split(ROOT)) {
                if (!part || part === ".") {continue;}
                if (part === "..") {
                    if (parts.length > 0) {
                        parts.pop();
                    }
                    continue;
                }
                parts.push(part);
            }
            return ROOT + parts.join(ROOT);
        }
        if (!path || path === ".") {return cwd;}
        if (path === "~") {return HOME;}
        if (path.startsWith("~/")) {path = HOME + path.slice(1);}
        if (path.startsWith(ROOT)) {return normalizePath(path);}
        return normalizePath(`${cwd}/${path}`);
    }

    /**
     * Walks `fullPath` (already normalized/absolute) segment by segment
     * from root, returning true as soon as it encounters a node flagged
     * `protected: true` - either root itself, some ancestor directory
     * along the way (e.g. /bin or /dev), or the final node. Stops (and
     * returns false) as soon as a segment doesn't exist, which correctly
     * handles not-yet-created targets too: e.g. for "mkdir /bin/new",
     * the walk reaches the existing, protected "bin" node and returns
     * true immediately, before ever needing "new" to exist.
     * @param {string} fullPath
     * @returns {boolean}
     */
    function isProtectedPath(fullPath) {
        let node = FileSystem[ROOT];
        if (node.protected) return true;
        for (const part of fullPath.split(ROOT).filter(Boolean)) {
            if (!node.children || !node.children[part]) return false;
            node = node.children[part];
            if (node.protected) return true;
        }
        return false;
    }

    /**
     * Finds the parent directory node of an absolute path, without
     * resolving symlinks along the way for the final segment.
     * @param {string} path - Absolute path.
     * @returns {{parent: Object, name: string}|null} The parent directory
     *   node and the final path segment's name, or null if any ancestor
     *   directory doesn't exist.
     */
    function getParentDirectory(path) {
        const parts = path.split(ROOT).filter(Boolean);
        if (parts.length === 0) {return null;}
        const name = parts.pop();
        let parent = FileSystem[ROOT];
        for (const part of parts) {
            if (!parent.children || !parent.children[part]) {return null;}
            parent = parent.children[part];
            if (parent.type !== "dir") {return null;}
        }
        return {parent,name};
    }

    /**
     * Expands a glob-style argument containing "*" and/or "?" wildcards
     * into all matching absolute paths in the filesystem, walking segment
     * by segment (so wildcards can appear in any path component, not just
     * the final one, e.g. "/home/*\/*.txt").
     * @param {string} arg - The raw argument, possibly containing wildcards.
     * @param {string} [cwd="/"] - Current working directory for relative resolution.
     * @returns {string[]} All matching paths. If `arg` contains no
     *   wildcard characters at all, it's returned unchanged as a single-
     *   element array (`[arg]`) - there's nothing to expand. An empty
     *   array specifically means `arg` DID look like a glob but matched
     *   nothing; callers (see execute.js, sh.js) treat that case as "fall
     *   back to the literal pattern", matching a real shell's default
     *   behavior for an unmatched glob.
     */
    function expandWildcards(arg, cwd = "/") {
        if (!arg.includes("*") && !arg.includes("?")) {
            return [arg];
        }
        const results = [];
        const pattern = arg.startsWith("/")
            ? arg
            : resolveRelativePath(cwd, arg);
        const parts = pattern.split("/");

        // Recursively walks the tree one path segment at a time, matching
        // literal segments exactly and wildcard segments via regex.
        function walk(node, index, currentPath) {
            if (index >= parts.length) {
                results.push(currentPath || "/");
                return;
            }
            const part = parts[index];
            if (part === "") {
                walk(node, index + 1, currentPath);
                return;
            }
            if (!node || !node.children) {
                return;
            }
            if (part.includes("*") || part.includes("?")) {
                const regex = new RegExp(
                    "^" +
                    part
                        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                        .replace(/\*/g, ".*")
                        .replace(/\?/g, ".")
                    +
                    "$"
                );
                // A bare "*"/"?" pattern shouldn't match hidden dotfiles -
                // real shells only do that if the pattern itself starts
                // with a literal "." (bash's `dotglob` is off by default).
                // Without this, something like `rm *` would silently sweep
                // up .script.sh along with everything else, which is both
                // surprising and not how any real shell behaves.
                const matchesHidden = part.startsWith(".");
                for (const name of Object.keys(node.children)) {
                    if (!matchesHidden && name.startsWith(".")) {
                        continue;
                    }
                    const child = node.children[name];
                    if (regex.test(name)) {
                        walk(
                            child,
                            index + 1,
                            currentPath + "/" + name
                        );
                    }
                }
            }
            else {
                const child = node.children[part];
                if (child) {
                    walk(
                        child,
                        index + 1,
                        currentPath + "/" + part
                    );
                }
            }
        }
        let startNode = FileSystem[ROOT];
        walk(
            startNode,
            0,
            ""
        );
        return results;
    }

    /**
     * Public filesystem API exposed globally. All path-taking methods
     * accept relative or absolute paths (resolved against `cwd`) unless
     * noted otherwise. Commands (js/commands/*.js) interact with the
     * virtual filesystem exclusively through this object.
     */
    window.FileSystemAPI = {

        // Returns the resolved node at `path` (following symlinks), or null if not found.
        get(path, cwd = "/") {
            const fullPath = resolveRelativePath(cwd, path);
            const result = resolvePath(fullPath);

            if (!result || !result.node) {
                return null;
            }

            return result.node;
        },    

        // Normalizes `path` (relative or absolute) into an absolute path string.
        getFullPath(path, cwd = "/") {
            const fullPath = resolveRelativePath(cwd, path);
            if (!fullPath) {
                return null;
            }
            return fullPath;
        },

        /**
         * True if `path` (or any ancestor directory containing it) is
         * flagged as a protected system location - currently /bin and
         * /dev, see bootstrap.js, which mounts each with `protected: true`.
         *
         * This intentionally isn't a hardcoded path-prefix check (that
         * was the old isInBin(), which only ever covered "/bin/" and
         * quietly left /dev completely unprotected). Protection now lives
         * as data on the node itself, so any future protected directory
         * just needs that one flag set when it's created/mounted, and
         * everything nested under it - including things added to it
         * later - is automatically covered without touching every
         * command in js/commands/ again.
         *
         * Callers that want files under a protected directory to remain
         * genuinely usable (e.g. /dev/null, /dev/random) rather than
         * fully locked away should combine this with isDevice(): block
         * when isProtected() is true AND the node ISN'T a device, so
         * reading/writing a device's simulated content still works
         * exactly as designed, while renaming/deleting/chmod'ing it (or
         * creating brand-new entries in /bin or /dev) stays blocked.
         *
         * Known limitation (shared with the old isInBin()): this checks
         * the path as typed, without following intermediate symlinks -
         * a symlink INTO a protected directory isn't itself caught here.
         * @param {string} path
         * @param {string} [cwd="/"]
         * @returns {boolean}
         */
        isProtected(path, cwd = "/") {
            const fullPath = resolveRelativePath(cwd, path);
            return isProtectedPath(fullPath);
        },

        // Accepts either a path string or an already-resolved node.
        isDirectory(pathOrNode, cwd = "/") {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, cwd)
                : pathOrNode;

            return node?.type === "dir";
        },

        // Accepts either a path string or an already-resolved node.
        isFile(pathOrNode, cwd = "/") {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, cwd)
                : pathOrNode;

            return node?.type === "file";
        },

        // Accepts either a path string or an already-resolved node. Note:
        // since get() already follows symlinks, this is mainly useful when
        // passed an already-fetched raw node (e.g. from getNode()).
        isSymlink(pathOrNode, cwd = "/") {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, cwd)
                : pathOrNode;

            return node?.type === "symlink";
        },

        // Accepts either a path string or an already-resolved node. True for
        // the virtual device files under /dev (null, zero, random, etc).
        isDevice(pathOrNode, cwd = "/") {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, cwd)
                : pathOrNode;

            return node?.type === "device";
        },

        /**
         * Returns the readable content of a file OR device node. Regular
         * files return their stored `content` as usual; device nodes (e.g.
         * /dev/random) delegate to that device's read() handler in
         * window.FileDevices, generating their content on the fly instead
         * of reading a static string. This is the one method every command
         * should use to read a file's bytes, so device files "just work"
         * anywhere a regular file would.
         * @param {string|Object} pathOrNode - Path string or resolved node.
         * @param {string} [cwd] - Working directory to resolve a path against.
         * @returns {string} The content, or "" if the node/device is missing.
         */
        readContent(pathOrNode, cwd = "/") {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, cwd)
                : pathOrNode;

            if (!node) return "";

            if (node.type === "device") {
                const device = window.FileDevices?.[node.device];
                return device ? device.read() : "";
            }

            return node.content ?? "";
        },

        /**
         * Writes (or appends) content to a file OR device node. Regular
         * files store the text in `content` as usual; device nodes delegate
         * to that device's write() handler in window.FileDevices (which may
         * discard the data, as /dev/null does, or refuse it, as /dev/full
         * does) rather than actually storing it.
         * @param {string|Object} pathOrNode - Path string or resolved node.
         * @param {string} data - Text to write.
         * @param {Object} [options]
         * @param {boolean} [options.append=false] - Append instead of overwrite (files only).
         * @param {string} [options.cwd="/"] - Working directory, when pathOrNode is a path string.
         * @returns {boolean} true on success, false if the node is missing,
         *   the device refused the write (e.g. /dev/full), or the write
         *   would grow the file past the size limits in constants.js.
         */
        writeContent(pathOrNode, data, options = {}) {
            const node = typeof pathOrNode === "string"
                ? this.get(pathOrNode, options.cwd ?? "/")
                : pathOrNode;

            if (!node) return false;

            if (node.type === "device") {
                const device = window.FileDevices?.[node.device];
                const ok = device ? device.write(data ?? "") : false;
                if (ok) node.modified = Date.now();
                return ok;
            }

            let next;
            if (options.append) {
                // A real shell's `>>` writes a command's ACTUAL stdout bytes
                // - trailing newline included, since that's just part of
                // what the command printed (e.g. echo always ends its own
                // output with "\n"). This codebase's captured stdout
                // doesn't carry that trailing newline itself (multi-line
                // output within one command is instead reconstructed by
                // joining separate write() calls with "\n" - see
                // execute()'s capturedOut), so appending it here as raw
                // text would otherwise run straight into whatever was
                // already in the file with no separator at all, turning
                // two `echo ... >> file` calls into one run-on line
                // instead of two. Insert the newline a real append would
                // have carried along, whenever there's existing content
                // that doesn't already end with one and something new is
                // actually being added.
                const existing = node.content ?? "";
                const addition = data ?? "";
                next = existing && addition && !existing.endsWith("\n")
                    ? existing + "\n" + addition
                    : existing + addition;
            } else {
                next = String(data ?? "");
            }

            // Size limits (see FS_MAX_* in constants.js). A write that
            // leaves the file the same size or smaller is always allowed,
            // so a full filesystem can still be emptied out.
            const previousLength = (node.content ?? "").length;
            if (next.length > previousLength) {
                if (next.length > FS_MAX_FILE_CHARS) return false;
                const used = measureNode(FileSystem[ROOT]).chars;
                if (used - previousLength + next.length > FS_MAX_TOTAL_CHARS) return false;
            }
            node.content = next;
            node.modified = Date.now();
            return true;
        },

        // Resolves `path` and returns the full {node, path} result (symlinks followed).
        resolve(path, cwd = "/") {
            const fullPath = resolveRelativePath(cwd, path);
            return resolvePath(fullPath);
        },
        
        // Returns {parent, name} for the parent directory node/basename of `path`.
        getParent(path, cwd = "/") {
            const fullPath = resolveRelativePath(cwd, path);
            return getParentDirectory(fullPath);
        },

        createFile(hidden = false) {
            return createFile(hidden);
        },

        createDirectory(hidden = false) {
            return createDirectory(hidden);
        },

        createLink(target) {
            return createLink(target);
        },

        getDirectorySize(node) {
            return getDirectorySize(node);
        },

        getSize(node) {
            return getSize(node);
        },

        getLinkCount(node) {
            return getLinkCount(node);
        },

        formatLongEntry(name, node) {
            return formatLongEntry(name, node);
        },

        formatDate(timestamp) {
            return formatDate(timestamp);
        },

        formatSize(bytes) {
            return formatSize(bytes);
        },

        numericToMode(value) {
            return numericToMode(value);
        },

        symbolicToMode(current, operation) {
            return symbolicToMode(current, operation);
        },

        expandWildcards(arg, cwd = "/") {
            return expandWildcards(arg, cwd);
        },
        
        // Looks up a node by absolute (or cwd-relative-to-root) path WITHOUT
        // following symlinks - returns the raw node as stored in the tree.
        getNode(path) {
            if (!path.startsWith(ROOT))
                path = resolveRelativePath(ROOT, path);

            let node = FileSystem[ROOT];
            const parts = path.split(ROOT).filter(Boolean);

            for (const part of parts) {
                if (!node.children || !node.children[part]) {
                    return null;
                }
                node = node.children[part];
            }
            return node;
        },

        /**
         * Current size of the whole filesystem, in the units the FS_MAX_*
         * limits in constants.js use.
         * @returns {{chars: number, nodes: number}}
         */
        usage() {
            return measureNode(FileSystem[ROOT]);
        },

        /**
         * Checks that a name is short enough to be used for a new entry.
         * @param {string} name - The entry's name (last path segment).
         * @returns {string|null} null if fine, otherwise an error message.
         */
        checkName(name) {
            name = String(name);
            if (name.length > FS_MAX_NAME_LENGTH) {
                return "File name too long";
            }
            // Names the saved-filesystem validator rejects (see
            // UNSAFE_CHILD_NAMES above). Allowing one to be created would
            // make the whole saved filesystem fail validation - and be
            // thrown away - on the next visit.
            if (UNSAFE_CHILD_NAMES.has(name)) {
                return "Invalid file name";
            }
            return null;
        },

        /**
         * Checks that putting `node` (and everything under it) directly
         * inside the directory `parent` would not nest deeper than
         * FS_MAX_DEPTH levels below "/".
         * @param {Object} parent - The directory node it would go into.
         * @param {Object} [node] - The node being added or moved. Omit
         *   for a new empty file or directory.
         * @returns {string|null} null if fine, otherwise an error message.
         */
        checkDepth(parent, node = null) {
            const parentDepth = depthOf(parent);
            if (parentDepth < 0) {
                return null; // not in the tree - nothing to measure against
            }
            const height = node ? treeHeight(node) : 1;
            return parentDepth + height > FS_MAX_DEPTH
                ? "Directory nesting too deep"
                : null;
        },

        /**
         * Checks whether an EXISTING entry can be moved or renamed to
         * `name` inside the directory `parent`. A move adds nothing new,
         * so only the new name and the resulting depth are checked.
         * @param {string} name - The entry's new name (last path segment).
         * @param {Object} node - The node being moved.
         * @param {Object} parent - The directory node it is moving into.
         * @returns {string|null} null if fine, otherwise an error message.
         */
        checkMove(name, node, parent) {
            return this.checkName(name) ?? this.checkDepth(parent, node);
        },

        /**
         * Prepares a tree that was built or copied outside this module
         * (e.g. by structuredClone() in `cp`) to be attached to the
         * filesystem. See bareChildren() at the top of this file.
         * @param {Object} node - Root of the tree to prepare.
         * @returns {Object} The same node.
         */
        normalizeTree(node) {
            return bareChildren(node);
        },

        /**
         * Checks whether a NEW entry called `name` holding `node` (a file,
         * link, or a whole directory tree, e.g. from `cp -r`) can be added
         * without going over the filesystem's size limits. Call this
         * BEFORE attaching the node to its parent's `children`.
         * @param {string} name - The new entry's name (last path segment).
         * @param {Object} [node] - The node about to be added. Omit for a
         *   new empty file or directory.
         * @param {Object} [parent] - The directory node it is going into.
         *   When given, the nesting depth is checked too.
         * @returns {string|null} null if it fits, otherwise an error
         *   message ("File name too long" / "Invalid file name" /
         *   "Directory nesting too deep" / "No space left on device").
         */
        checkSpace(name, node = null, parent = null) {
            const nameError = this.checkName(name);
            if (nameError) return nameError;
            if (parent) {
                const depthError = this.checkDepth(parent, node);
                if (depthError) return depthError;
            }
            const used = measureNode(FileSystem[ROOT]);
            const added = node ? measureNode(node) : { chars: 0, nodes: 1 };
            if (used.nodes + added.nodes > FS_MAX_NODES ||
                used.chars + added.chars + String(name).length > FS_MAX_TOTAL_CHARS) {
                return "No space left on device";
            }
            return null;
        },

        // Attaches `node` as a new top-level child of root under `name`
        // (used by bootstrap.js to mount /bin and /dev).
        mount(name, node) {
            FileSystem[ROOT].children[name] = bareChildren(node);
        },

        // Serializes the entire filesystem tree to a JSON string (for localStorage).
        serialize() {
            return JSON.stringify(FileSystem);
        },

        /**
         * Replaces the in-memory filesystem with the parsed contents of
         * `json` (a previously-serialized tree). Falls back to the default
         * filesystem if parsing fails OR the parsed data doesn't pass
         * isValidFileSystemTree() - syntactically valid JSON that isn't a
         * structurally sound tree (hand-edited localStorage, a partial/
         * truncated write, a save from some future/incompatible format,
         * ...) is treated exactly like invalid JSON: rejected up front here
         * rather than accepted and left to crash something later, in a far
         * more confusing place, the first time e.g. a directory with no
         * `children` gets walked.
         * @returns {boolean} true if restore succeeded, false if the JSON
         *   was invalid (or structurally unsound) and defaults were used instead.
         */
        restore(json) {
            try {
                const parsed = JSON.parse(json);
                if (!isValidFileSystemTree(parsed)) {
                    throw new Error("saved filesystem failed structural validation");
                }
                FileSystem = parsed;
                bareChildren(FileSystem[ROOT]);
                return true;
            } catch (e) {
                FileSystem = JSON.parse(DEFAULT_FILESYSTEM_JSON);
                bareChildren(FileSystem[ROOT]);
                return false;
            }
        },

        // Discards all changes and restores the original seed filesystem (used by `reset`).
        resetToDefault() {
            FileSystem = JSON.parse(DEFAULT_FILESYSTEM_JSON);
            bareChildren(FileSystem[ROOT]);
        },

        /**
         * Brings the small set of "seed content" files (currently the
         * starter files under /home/guest - resume.md, contact.md, etc.)
         * up to date with whatever the CURRENT code ships, without
         * touching anything else the user has created, moved, or edited
         * elsewhere in their filesystem.
         *
         * This replaces the old approach of wiping localStorage entirely
         * whenever TERMINAL_VERSION changed: that was a blunt instrument
         * for what's really a narrow problem ("I fixed a typo in
         * readme.md, existing users should get the fix") and it cost
         * users everything else they'd done in their session to deliver
         * it. Instead, each seed file carries its own `seedVersion` in
         * filesystem.js, bumped by hand only when that file's *content*
         * changes, and this reconciles against it, version by version:
         *
         *   - Locally at or past the shipped seedVersion already -> left
         *     alone completely (this is the common case on every boot).
         *   - Locally behind the shipped seedVersion (whether because the
         *     file is missing, was deleted, or was edited - reconcileSeed
         *     doesn't distinguish those, on purpose) -> replaced outright
         *     with the shipped content. These four files are meant to
         *     always reflect what ships in the code once you bump their
         *     version, not a permanent user sandbox - if you want a file
         *     users can edit and keep, don't give it a `seedVersion`.
         *
         * @param {Object.<string, number>} seedSync - Map of seed file
         *   path -> the last seedVersion reconciled for it, persisted in
         *   terminalSettings across reloads. Pass {} for a first run.
         * @returns {{seedSync: Object.<string, number>, changes: {path: string, action: "added"|"updated"}[]}}
         *   The updated map to persist back, plus a list of what changed
         *   (so the caller can let the user know, if it wants to).
         */
        reconcileSeed(seedSync = {}) {
            const updatedSync = { ...seedSync };
            const changes = [];
            const freshTree = JSON.parse(DEFAULT_FILESYSTEM_JSON);

            walkSeedNodes(freshTree[ROOT], ROOT, (freshNode, path) => {
                const result = getParentDirectory(path);
                if (!result) {
                    return; // shouldn't happen for a well-formed seed path
                }
                const { parent, name } = result;
                const localNode = parent.children[name];
                const lastSynced = updatedSync[path];

                if (localNode && lastSynced === undefined) {
                    // First time this path has ever been reconciled (e.g.
                    // a profile created before this feature existed, or a
                    // brand new profile) - there's nothing to "update" to,
                    // the file already reflects whatever the code shipped
                    // when it was created. Just establish the baseline so
                    // future version bumps have something to compare
                    // against, without firing a spurious change here.
                    updatedSync[path] = freshNode.seedVersion;
                    return;
                }

                if (localNode && lastSynced >= freshNode.seedVersion) {
                    // Already at (or past) the shipped version - nothing to do.
                    return;
                }

                // Missing, or behind the shipped version - (re)write it
                // from the fresh seed content, regardless of whether it's
                // missing because it was never here, was deleted, or was
                // edited. structuredClone since it'll be mutated in-place
                // going forward (accessed/modified timestamps etc.) and
                // shouldn't share references with freshTree.
                const isNew = !localNode;
                parent.children[name] = bareChildren(structuredClone(freshNode));
                parent.modified = Date.now();
                updatedSync[path] = freshNode.seedVersion;
                changes.push({ path, action: isNew ? "added" : "updated" });
            });

            return { seedSync: updatedSync, changes };
        }

    };
})();
