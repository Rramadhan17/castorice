const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createRadioDiscovery,
    mapStations,
    normalizeStreamUrl
} = require("../../src/music/radio-discovery");
const music = require("../../src/music/manager");

function station(index, overrides = {}) {
    return {
        stationuuid: `station-${index}`,
        name: `Station ${index}`,
        url_resolved: `https://stream${index}.example/radio`,
        country: "Testland",
        codec: "MP3",
        bitrate: 128,
        ...overrides
    };
}

test("Radio Browser query is bounded and station results are normalized and deduplicated", async () => {
    let requestUrl;
    let requestOptions;
    const discovery = createRadioDiscovery({
        baseUrl: "https://radio.example",
        fetchImpl: async (url, options) => {
            requestUrl = url;
            requestOptions = options;
            return {
                ok: true,
                async json() {
                    return [
                        station(1),
                        station(2, { url_resolved: "https://stream1.example/radio" }),
                        station(3, { url_resolved: "http://127.0.0.1/admin" }),
                        ...Array.from({ length: 10 }, (_, index) => station(index + 4))
                    ];
                }
            };
        }
    });

    const stations = await discovery.search(`  ${"a".repeat(130)}  `);
    const parsedUrl = new URL(requestUrl);

    assert.equal(parsedUrl.hostname, "radio.example");
    assert.equal(parsedUrl.searchParams.get("name").length, 100);
    assert.equal(parsedUrl.searchParams.get("limit"), "8");
    assert.equal(parsedUrl.searchParams.get("hidebroken"), "true");
    assert.equal(requestOptions.headers["User-Agent"].startsWith("Castorice/"), true);
    assert.equal(stations.length, 8);
    assert.equal(new Set(stations.map(item => item.streamUrl)).size, 8);
    assert.equal(stations[0].title, "Station 1");
    assert.equal(stations[0].bitrate, 128);
});

test("Radio Browser rejects unsupported and private stream addresses", () => {
    assert.equal(normalizeStreamUrl("https://radio.example/live"), "https://radio.example/live");
    for (const url of [
        "file:///etc/passwd",
        "ftp://radio.example/live",
        "http://localhost/live",
        "http://service.local/live",
        "http://169.254.169.254/latest",
        "http://192.168.1.1/live",
        "http://[::1]/live",
        "https://user:password@radio.example/live"
    ]) {
        assert.equal(normalizeStreamUrl(url), null, url);
    }

    assert.deepEqual(mapStations([station(1, { name: " \u0000 Station \n One " })])[0].title, "Station One");
});

test("Radio Browser surfaces HTTP and invalid response failures", async () => {
    const unavailable = createRadioDiscovery({
        baseUrl: "https://radio.example",
        fetchImpl: async () => ({ ok: false, status: 503 })
    });
    await assert.rejects(unavailable.search("jazz"), /status 503/i);

    const invalid = createRadioDiscovery({
        baseUrl: "https://radio.example",
        fetchImpl: async () => ({ ok: true, json: async () => ({ stations: [] }) })
    });
    await assert.rejects(invalid.search("jazz"), /invalid station list/i);
});

test("Radio Browser request timeout is surfaced", async () => {
    const discovery = createRadioDiscovery({
        baseUrl: "https://radio.example",
        timeoutMs: 10,
        fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });
    await assert.rejects(discovery.search("jazz"), /timed out/i);
});

test("Radio Browser tag searches use the tag filter and reject empty tags", async () => {
    let requestUrl;
    const discovery = createRadioDiscovery({
        baseUrl: "https://radio.example",
        fetchImpl: async url => {
            requestUrl = url;
            return { ok: true, json: async () => [station(1)] };
        }
    });

    await discovery.search("tag: jazz");
    const parsedUrl = new URL(requestUrl);
    assert.equal(parsedUrl.searchParams.get("tag"), "jazz");
    assert.equal(parsedUrl.searchParams.has("name"), false);
    await assert.rejects(discovery.search("tag: "), /tag radio/i);
});

test("Radio station queue entry skips metadata scraping and remains a live track", async t => {
    const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    const channelId = "345678901234567890";
    const session = {
        guildId,
        channelId,
        closed: false,
        currentTrack: { title: "Existing Track" },
        queue: [],
        finishing: false,
        player: { state: { status: "playing" } }
    };
    music.getSessions().set(guildId, session);
    t.after(() => music.getSessions().delete(guildId));

    const result = await music.addRadioStation(
        { id: guildId },
        { id: "234567890123456789", voice: { channel: { id: channelId } } },
        {
            title: "Test Radio",
            country: "Testland",
            streamUrl: "https://stream.example/live"
        }
    );

    assert.equal(result.started, false);
    assert.equal(result.track.title, "Test Radio");
    assert.equal(result.track.radioStream, true);
    assert.equal(result.track.duration, null);
    assert.equal(session.queue[0], result.track);
});
