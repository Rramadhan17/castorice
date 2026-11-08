const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRadioUrl, resolvePublicIpv4 } = require("../../src/music/radio-stream-proxy");
const music = require("../../src/music/manager");
const {
    createPinnedLookup,
    isPublicIp,
    parseExternalHttpUrl,
    resolvePublicAddresses,
    validateMusicInput
} = require("../../src/music/url-security");

test("music URL validator allows HTTP and HTTPS and normalizes bracketed public IPv6", async () => {
    assert.equal(
        (await validateMusicInput("http://music.example/song", {
            lookup: async (_host, options) => {
                assert.equal(options.all, true);
                assert.equal(options.verbatim, true);
                return [{ address: "93.184.216.34", family: 4 }];
            }
        })),
        "http://music.example/song"
    );
    assert.equal(
        await validateMusicInput("https://[2606:4700:4700::1111]/stream"),
        "https://[2606:4700:4700::1111]/stream"
    );
    assert.equal(parseExternalHttpUrl("https://[2606:4700:4700::1111]/stream").hostname, "[2606:4700:4700::1111]");
});

test("music URL validator rejects non-HTTP protocols, credentials, localhost, and legacy loopback forms", async () => {
    for (const url of [
        "ftp://music.example/song",
        "file:///C:/Windows/win.ini",
        "gopher://music.example/",
        "http://user:pass@music.example/song",
        "http://localhost/song",
        "http://voice.local/song",
        "http://service.internal/song",
        "http://127.1/song",
        "http://0177.0.0.1/song"
    ]) {
        await assert.rejects(validateMusicInput(url, { resolveDns: false }), undefined, url);
    }
});

test("IPv4 private, link-local, multicast, reserved and non-global ranges are rejected", () => {
    for (const address of [
        "0.1.2.3",
        "10.1.2.3",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.20.1.2",
        "192.0.2.1",
        "192.168.1.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255"
    ]) {
        assert.equal(isPublicIp(address), false, address);
        assert.throws(() => parseExternalHttpUrl(`https://${address}/`), undefined, address);
    }
    assert.equal(isPublicIp("93.184.216.34"), true);
});

test("IPv6 rejects private, loopback, link-local, multicast, unspecified, mapped, transition and reserved ranges", () => {
    for (const address of [
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:0808:0808",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1",
        "ff02::1",
        "2001:db8::1",
        "2001:2::1",
        "2002::1",
        "3fff::1"
    ]) {
        assert.equal(isPublicIp(address), false, address);
        assert.throws(() => parseExternalHttpUrl(`https://[${address}]/`), undefined, address);
    }
    assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("DNS validates every A and AAAA answer and rejects mixed public/private answers", async () => {
    let optionsSeen;
    await assert.rejects(
        resolvePublicAddresses("mixed.example", async (_host, options) => {
            optionsSeen = options;
            return [
                { address: "93.184.216.34", family: 4 },
                { address: "fd00::1", family: 6 }
            ];
        }),
        /privat atau non-global/
    );
    assert.equal(optionsSeen.all, true);
    assert.equal(Object.prototype.hasOwnProperty.call(optionsSeen, "family"), false);
});

test("DNS timeout and rebinding to a private address fail closed", async () => {
    await assert.rejects(
        resolvePublicAddresses("slow.example", () => new Promise(() => {}), 10),
        /DNS lookup timed out/
    );
    let lookups = 0;
    const lookup = async () => {
        lookups += 1;
        return [{ address: lookups === 1 ? "93.184.216.34" : "10.0.0.1", family: 4 }];
    };
    assert.equal((await resolvePublicAddresses("changing.example", lookup))[0].address, "93.184.216.34");
    await assert.rejects(resolvePublicAddresses("changing.example", lookup), /privat atau non-global/);
});

test("Radio relay rejects any forbidden AAAA answer even when A is public", async () => {
    const url = parseRadioUrl("https://radio.example/live");
    await assert.rejects(
        resolvePublicIpv4(url, async (_host, options) => {
            assert.equal(options.all, true);
            assert.equal(options.family, undefined);
            return [
                { address: "93.184.216.34", family: 4 },
                { address: "fe80::1", family: 6 }
            ];
        }),
        /private or reserved/
    );
});

test("pinned lookup returns only the validated address and rejects hostname or family changes", () => {
    const lookup = createPinnedLookup("media.example", "93.184.216.34");
    lookup("media.example", { all: true }, (error, records) => {
        assert.ifError(error);
        assert.deepEqual(records, [{ address: "93.184.216.34", family: 4 }]);
    });
    lookup("other.example", {}, error => assert.match(error.message, /hostname mismatch/));
    lookup("media.example", { family: 6 }, error => assert.match(error.message, /family mismatch/));
});

test("title search normalization and unsupported-scheme validation remain available", async () => {
    assert.equal(await validateMusicInput("The Artist - The Song"), "ytsearch1:The Artist - The Song");
    assert.equal(await validateMusicInput("ytsearch1:Artist Song"), "ytsearch1:Artist Song");
    await assert.rejects(validateMusicInput("file:///C:/secret.mp3"), /HTTP\/HTTPS/);
});

test("the public Music queue entry fails closed before metadata or playback", async () => {
    await assert.rejects(
        music.addToQueue(
            { id: "test-guild" },
            { id: "test-user", voice: { channel: { id: "test-channel" } } },
            "http://127.0.0.1:8080/admin"
        ),
        /isolasi egress tingkat proses\/OS/
    );
});
