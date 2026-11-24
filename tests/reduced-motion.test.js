(function () {
"use strict";

const { describe, test, run, assert, assertEqual, terminal } =
    typeof module !== "undefined" ? require("./harness") : window.TestHarness;

// Runs fn with the "reduce motion" preference forced on or off, recording
// every pause the terminal takes meanwhile.
async function withMotionPreference(reduced, fn) {
    const originalPreference = terminal.prefersReducedMotion;
    const originalSleep = terminal.sleep;
    const pauses = [];
    terminal.prefersReducedMotion = () => reduced;
    terminal.sleep = async (ms) => { pauses.push(ms); };
    try {
        await fn();
    } finally {
        terminal.prefersReducedMotion = originalPreference;
        terminal.sleep = originalSleep;
    }
    return pauses;
}

describe("reduced motion: animation pauses are skipped when the visitor asks for less motion");

test("command output is paced normally by default", async () => {
    const pauses = await withMotionPreference(false, () => run("seq 5"));
    assertEqual(pauses.length, 5);
});

test("command output appears without pauses under reduced motion", async () => {
    let result;
    const pauses = await withMotionPreference(true, async () => { result = await run("seq 5"); });
    assertEqual(pauses.length, 0);
    assertEqual(result.stdout, "1\n2\n3\n4\n5"); // and nothing is lost
});

test("error output is not paced either", async () => {
    const pauses = await withMotionPreference(true, () => run("cat no-such-file"));
    assertEqual(pauses.length, 0);
});

test("the typewriter effect writes the whole line at once", async () => {
    const target = { textContent: "" };
    const pauses = await withMotionPreference(true, () => terminal.typeWrite(target, "Initializing kernel"));
    assertEqual(target.textContent, "Initializing kernel");
    assertEqual(pauses.length, 0);

    const animated = { textContent: "" };
    const normalPauses = await withMotionPreference(false, () => terminal.typeWrite(animated, "abc"));
    assertEqual(animated.textContent, "abc");
    assertEqual(normalPauses.length, 3);
});

test("the sleep command still really waits", async () => {
    const started = Date.now();
    await withMotionPreference(true, () => run("sleep 0.2"));
    assert(Date.now() - started >= 180, "sleep 0.2 should not be skipped");
});

})();
