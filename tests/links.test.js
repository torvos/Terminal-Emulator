(function () {
"use strict";

const { describe, test, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Compact form for assertions: "T:text", "U:text->href", "E:text->href".
function shape(input) {
    return terminal.findLinks(input).map(p =>
        p.type === "text" ? `T:${p.text}` : `${p.type === "url" ? "U" : "E"}:${p.text}->${p.href}`
    );
}
function joined(input) {
    return terminal.findLinks(input).map(p => p.text).join("");
}

describe("findLinks(): URLs and emails are linked without ever producing markup");

test("plain text has no links", async () => {
    assertEqual(shape("just some text").join("|"), "T:just some text");
    assertEqual(terminal.findLinks("").length, 0);
});

test("a simple URL and a simple email", async () => {
    assertEqual(shape("see https://example.com/a?b=1&c=2#top now").join("|"),
        "T:see |U:https://example.com/a?b=1&c=2#top->https://example.com/a?b=1&c=2#top|T: now");
    assertEqual(shape("mail contact@torvos.ca today").join("|"),
        "T:mail |E:contact@torvos.ca->mailto:contact@torvos.ca|T: today");
});

test("an address inside a URL stays part of that one link", async () => {
    const parts = terminal.findLinks("https://user@example.com/path?a=1");
    assertEqual(parts.length, 1);
    assertEqual(parts[0].type, "url");
    assertEqual(parts[0].href, "https://user@example.com/path?a=1");
});

test("trailing sentence punctuation is not part of the link", async () => {
    assertEqual(shape("Go to https://example.com/x.").join("|"),
        "T:Go to |U:https://example.com/x->https://example.com/x|T:.");
    assertEqual(shape("(https://example.com/x).").join("|"),
        "T:(|U:https://example.com/x->https://example.com/x|T:).");
    assertEqual(shape("a@b.co, or c@d.org.").join("|"),
        "E:a@b.co->mailto:a@b.co|T:, or |E:c@d.org->mailto:c@d.org|T:.");
});

test("brackets balanced inside the URL are kept", async () => {
    const parts = terminal.findLinks("https://en.wikipedia.org/wiki/Rust_(programming_language)");
    assertEqual(parts.length, 1);
    assertEqual(parts[0].text, "https://en.wikipedia.org/wiki/Rust_(programming_language)");
});

test("quotes and angle brackets end a URL", async () => {
    assertEqual(shape('http://x.com/a"onmouseover=alert(1)')[0], "U:http://x.com/a->http://x.com/a");
    assertEqual(shape("http://x.com<b>hi</b>")[0], "U:http://x.com->http://x.com/");
});

test("only http and https become links", async () => {
    for (const input of ["javascript:alert(1)", "data:text/html,<script>x</script>", "ftp://example.com/f", "https://", "http://."]) {
        assert(terminal.findLinks(input).every(p => p.type === "text"), `should not link: ${input}`);
    }
});

test("the visible text is always exactly the input", async () => {
    const samples = [
        "<img src=x onerror=alert(1)> https://a.co/<script> & \"q\" 'q'",
        "https://user@example.com/p?a=1&b=2), then x@y.io!",
        "((https://a.co/(x)))...",
        "a@b.co@c.de https://https://x.y",
        "%@a.bc 100%+x@d.ef"
    ];
    for (const input of samples) {
        assertEqual(joined(input), input);
    }
});

test("email hrefs are percent-encoded", async () => {
    assertEqual(terminal.findLinks("50%off@shop.example")[0].href, "mailto:50%25off@shop.example");
});

})();
