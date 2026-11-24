(function () {
"use strict";

// Node only: these tests read files from disk and run the page
// generator, neither of which a browser page can do. The file is still
// listed in test.html (run-tests.js checks that every test file is), but
// in a browser it stops right here and registers nothing.
if (typeof module === "undefined") {
    return;
}

const fs = require("fs");
const path = require("path");
const { describe, test, assert, assertEqual, assertIncludes, terminal } = require("./harness");
const { build, isUpToDate, textToHtml } = require("../tools/build-plain");

const ROOT_DIR = path.join(__dirname, "..");
const readFile = (name) => fs.readFileSync(path.join(ROOT_DIR, name), "utf8");
const findLinks = (text) => terminal.findLinks(text);

describe("plain.html: the static, no-JavaScript version of the site");

test("plain.html matches the seed content (if this fails, run: node tools/build-plain.js)", async () => {
    assert(isUpToDate(), "plain.html is out of date - run: node tools/build-plain.js");
});

test("it contains the about, resume and contact content as real text", async () => {
    const html = build();
    assertIncludes(html, '<section id="about">');
    assertIncludes(html, '<section id="resume">');
    assertIncludes(html, '<section id="contact">');
    assertIncludes(html, "senior cloud architecture and cybersecurity leader");
    assertIncludes(html, '<a href="mailto:contact@torvos.ca">contact@torvos.ca</a>');
    assertIncludes(html, '<a href="https://github.com/torvos">https://github.com/torvos</a>');
});

test("it needs no script and no inline style (works under a strict CSP)", async () => {
    const html = build();
    assert(!/<script/i.test(html), "no <script>");
    assert(!/<style/i.test(html), "no <style>");
    assert(!/\sstyle=/i.test(html), "no style attributes");
    assert(!/\son\w+=/i.test(html), "no inline event handlers");
});

test("box drawing from the terminal layout is not carried over", async () => {
    const html = build();
    assert(!html.includes("+---"), "no box rules");
    assert(!/[█╗╔╝═║]/.test(html), "no block art");
});

describe("plain.html: converting the seed files' text conventions to HTML");

test("dashed titles become headings, dash items become a list", async () => {
    const html = textToHtml("----------- Skills -----------\n - One\n - Two", findLinks);
    assertEqual(html, "<h3>Skills</h3>\n<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>");
});

test("a line directly above a list is its heading; wrapped lines form one paragraph", async () => {
    assertEqual(textToHtml("Team Leader\n - Led things", findLinks),
        "<h4>Team Leader</h4>\n<ul>\n  <li>Led things</li>\n</ul>");
    assertEqual(textToHtml("first line\nsecond line\n\nnew paragraph", findLinks),
        "<p>first line second line</p>\n<p>new paragraph</p>");
});

test("boxed text is unwrapped and special characters are escaped", async () => {
    assertEqual(textToHtml("+-------+\n| - a@b.co |\n+-------+", findLinks),
        '<ul>\n  <li><a href="mailto:a@b.co">a@b.co</a></li>\n</ul>');
    assertEqual(textToHtml("R&D <script>alert(1)</script>", findLinks),
        "<p>R&amp;D &lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

describe("index.html: fallback, link-preview tags and icons");

test("there is a no-JavaScript message that links to the plain version", async () => {
    const html = readFile("index.html");
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    assert(noscript, "index.html should have a <noscript> block");
    assertIncludes(noscript[1], 'href="plain.html"');
});

test("link-preview tags are present and use absolute URLs", async () => {
    const html = readFile("index.html");
    for (const property of ["og:title", "og:description", "og:url", "og:image", "og:type"]) {
        assert(new RegExp(`<meta property="${property}" content="[^"]+">`).test(html), `missing ${property}`);
    }
    assert(/<meta property="og:image" content="https:\/\/[^"]+">/.test(html), "og:image must be an absolute URL");
    assert(/<meta name="twitter:card" content="summary_large_image">/.test(html), "missing twitter:card");
    assert(/<link rel="canonical" href="https:\/\/[^"]+">/.test(html), "missing canonical link");
});

test("every icon, image and page the head refers to actually exists", async () => {
    const html = readFile("index.html");
    const local = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|alternate)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert(local.length >= 4, "expected icon and alternate links");
    for (const file of [...local, "og-image.png", "css/plain.css", "robots.txt", "sitemap.xml"]) {
        assert(fs.existsSync(path.join(ROOT_DIR, file)), `missing file: ${file}`);
    }
});

})();
