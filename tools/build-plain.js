#!/usr/bin/env node
/**
 * Generates plain.html: an ordinary, static HTML version of the site's
 * content (about, resume, contact) for anyone - or anything - that can't
 * use the interactive terminal: browsers with JavaScript turned off,
 * search engines and other crawlers, link previews, reader modes, and
 * printing.
 *
 * The content is NOT written here. It is read from the same seed files
 * the terminal ships (readme.md, resume.md and contact.md in
 * js/filesystem/seed.js), so there is only one place to edit it.
 *
 *   node tools/build-plain.js           rewrite plain.html
 *   node tools/build-plain.js --check   exit 1 if plain.html is out of date
 *
 * Run it after changing any of those three seed files. The test suite
 * (tests/plain-page.test.js) fails if you forget.
 *
 * No dependencies: it boots the real app through the test harness, the
 * same way `node tests/run-tests.js` does, and uses the app's own link
 * detection so links here match the ones the terminal shows.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT_DIR, "plain.html");

// Page title and one-line summary, shared with index.html's <head> by
// hand (see the comment there).
const SITE_NAME = "Torvos.ca";

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Converts one of the seed text files into HTML. The files are plain
 * text with a few light conventions, which map onto real elements:
 *
 *   ----------- Title -----------     ->  <h3>
 *    - item                           ->  <li> (consecutive items form a <ul>)
 *   A line directly above a list      ->  <h4> (e.g. a job title)
 *   Other lines                       ->  <p> (consecutive lines are one paragraph)
 *   +-----+ / | ... | box drawing     ->  removed; the text inside is kept
 *
 * @param {string} text - The seed file's content.
 * @param {(text: string) => Array} findLinks - The app's link finder.
 */
function textToHtml(text, findLinks) {
    const inline = (str) => findLinks(str).map((part) => {
        if (part.type === "text") return escapeHtml(part.text);
        return `<a href="${escapeHtml(part.href)}">${escapeHtml(part.text)}</a>`;
    }).join("");

    // Strip box drawing: drop "+-----+" rules, unwrap "| text |" rows.
    const lines = text.split(/\r?\n/)
        .filter((line) => !/^\s*\+-+\+\s*$/.test(line))
        .map((line) => {
            const boxed = line.match(/^\s*\|(.*)\|\s*$/);
            return boxed ? boxed[1].trim() : line;
        });

    const isBullet = (line) => /^\s*-\s+\S/.test(line ?? "");
    const out = [];
    let paragraph = [];
    let listOpen = false;

    const closeParagraph = () => {
        if (paragraph.length) {
            out.push(`<p>${inline(paragraph.join(" "))}</p>`);
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listOpen) {
            out.push("</ul>");
            listOpen = false;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line === "") {
            closeParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^-{3,}\s*(.+?)\s*-{3,}$/);
        if (heading) {
            closeParagraph();
            closeList();
            out.push(`<h3>${inline(heading[1])}</h3>`);
            continue;
        }

        if (isBullet(line)) {
            closeParagraph();
            if (!listOpen) {
                out.push("<ul>");
                listOpen = true;
            }
            out.push(`  <li>${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
            continue;
        }

        closeList();
        if (paragraph.length === 0 && isBullet(lines[i + 1])) {
            out.push(`<h4>${inline(line)}</h4>`);
            continue;
        }
        paragraph.push(line);
    }
    closeParagraph();
    closeList();
    return out.join("\n");
}

function build() {
    // Boots the real app (seed filesystem included) in Node.
    const { terminal, FileSystemAPI } = require(path.join(ROOT_DIR, "tests", "harness.js"));
    FileSystemAPI.resetToDefault();

    const read = (name) => {
        const node = FileSystemAPI.get(`${HOME}/${name}`);
        if (!node || typeof node.content !== "string") {
            throw new Error(`build-plain: seed file ${HOME}/${name} not found`);
        }
        return node.content;
    };
    const findLinks = (text) => terminal.findLinks(text);
    const section = (id, title, file) => [
        `<section id="${id}">`,
        `<h2>${title}</h2>`,
        textToHtml(read(file), findLinks),
        `</section>`
    ].join("\n");

    return `<!DOCTYPE html>
<!--
    GENERATED FILE - do not edit by hand.
    Made by tools/build-plain.js from the seed files in
    js/filesystem/seed.js (readme.md, resume.md, contact.md).
    To change it, edit those and run:  node tools/build-plain.js
-->
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${SITE_NAME} - plain version</title>
    <meta name="description" content="Plain HTML version of ${SITE_NAME}: about this site, resume and contact details.">
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
    <link rel="icon" href="favicon-32.png" sizes="32x32" type="image/png">
    <link rel="stylesheet" href="css/plain.css">
</head>
<body>
<header>
    <h1>${SITE_NAME}</h1>
    <p>This is the plain version of this site. The main site is an <a href="./">interactive terminal</a>, which needs JavaScript.</p>
    <nav aria-label="Sections">
        <a href="#about">About</a>
        <a href="#resume">Resume</a>
        <a href="#contact">Contact</a>
    </nav>
</header>
<main>
${section("about", "About this site", "readme.md")}
${section("resume", "Resume", "resume.md")}
${section("contact", "Contact", "contact.md")}
</main>
</body>
</html>
`;
}

// Compares ignoring line-ending style, so a checkout that converts line
// endings (git on Windows) doesn't make the page look out of date.
const normalize = (text) => text.replace(/\r\n/g, "\n");

function isUpToDate() {
    if (!fs.existsSync(OUTPUT_FILE)) return false;
    return normalize(fs.readFileSync(OUTPUT_FILE, "utf8")) === normalize(build());
}

module.exports = { build, isUpToDate, textToHtml, OUTPUT_FILE };

if (require.main === module) {
    if (process.argv.includes("--check")) {
        if (isUpToDate()) {
            console.log("plain.html is up to date.");
            process.exit(0);
        }
        console.error("plain.html is out of date. Run: node tools/build-plain.js");
        process.exit(1);
    }
    fs.writeFileSync(OUTPUT_FILE, build());
    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_FILE)}`);
    process.exit(0);
}
