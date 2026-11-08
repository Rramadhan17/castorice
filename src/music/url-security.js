const dns = require("node:dns").promises;
const net = require("node:net");

const DNS_TIMEOUT_MS = 10_000;

const DENIED_IPV4_RANGES = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
];

function ipv4ToNumber(address) {
    return address.split(".").reduce((value, part) => (value * 256) + Number(part), 0);
}

function isInIpv4Range(address, network, prefix) {
    const shift = 32 - prefix;
    return Math.floor(ipv4ToNumber(address) / (2 ** shift)) ===
        Math.floor(ipv4ToNumber(network) / (2 ** shift));
}

function expandIpv6(address) {
    let value = address.toLowerCase();
    if (value.includes(".")) {
        const lastColon = value.lastIndexOf(":");
        const ipv4 = value.slice(lastColon + 1);
        if (net.isIP(ipv4) !== 4) return null;
        const octets = ipv4.split(".").map(Number);
        value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }

    const halves = value.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
        return null;
    }
    const groups = [...left, ...Array(missing).fill("0"), ...right];
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) {
        return null;
    }
    return groups.map(group => Number.parseInt(group, 16));
}

function isPublicIp(address) {
    const version = net.isIP(address);
    if (version === 4) {
        return !DENIED_IPV4_RANGES.some(([network, prefix]) =>
            isInIpv4Range(address, network, prefix)
        );
    }
    if (version !== 6) return false;

    const groups = expandIpv6(address);
    if (!groups) return false;
    const first = groups[0];
    const second = groups[1];

    // Only global-unicast space is accepted; special-purpose and transition ranges fail closed.
    return first >= 0x2000 &&
        first <= 0x3fff &&
        !(first === 0x2001 && second <= 0x01ff) &&
        !(first === 0x2001 && second === 0x0db8) &&
        first !== 0x2002 &&
        !(first === 0x3fff && second < 0x1000);
}

function normalizeHostname(hostname) {
    return String(hostname || "")
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase();
}

function parseExternalHttpUrl(value) {
    let url;
    try {
        url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
    } catch {
        throw new Error("URL tidak valid.");
    }

    const hostname = normalizeHostname(url.hostname);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !hostname ||
        hostname === "localhost" ||
        /\.(?:localhost|local|internal)$/.test(hostname)
    ) {
        throw new Error("Hanya URL HTTP/HTTPS publik yang diizinkan.");
    }
    if (net.isIP(hostname) && !isPublicIp(hostname)) {
        throw new Error("Alamat IP privat atau non-global tidak diizinkan.");
    }

    return url;
}

function withTimeout(promise, timeoutMs, message) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

async function resolvePublicAddresses(hostname, lookup = dns.lookup, timeoutMs = DNS_TIMEOUT_MS) {
    const host = normalizeHostname(hostname);
    const family = net.isIP(host);
    if (family) {
        if (!isPublicIp(host)) {
            throw new Error("Alamat IP privat atau non-global tidak diizinkan.");
        }
        return [{ address: host, family }];
    }
    if (!host || /\.(?:localhost|local|internal)$/.test(host)) {
        throw new Error("Hostname lokal atau non-global tidak diizinkan.");
    }

    let records;
    try {
        records = await withTimeout(
            lookup(host, { all: true, verbatim: true }),
            timeoutMs,
            "DNS lookup timed out."
        );
    } catch (error) {
        if (error.message === "DNS lookup timed out.") throw error;
        throw new Error("Hostname DNS tidak dapat di-resolve.");
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new Error("Hostname DNS tidak memiliki alamat publik.");
    }
    const addresses = records.map(record => {
        const address = String(record.address || "");
        const family = net.isIP(address);
        return {
            address,
            family,
            reportedFamily: Number(record.family) || family
        };
    });
    if (addresses.some(record =>
        !record.family ||
        record.family !== record.reportedFamily ||
        !isPublicIp(record.address)
    )) {
        throw new Error("Hostname DNS mengarah ke alamat privat atau non-global.");
    }

    return [...new Map(addresses.map(({ address, family }) => [address, { address, family }])).values()];
}

async function validateMusicInput(input, {
    lookup = dns.lookup,
    resolveDns = true,
    timeoutMs = DNS_TIMEOUT_MS
} = {}) {
    const value = String(input || "").trim();
    if (!value) throw new Error("Masukkan link atau judul lagu.");
    if (/^ytsearch1:/i.test(value)) {
        const query = value.slice("ytsearch1:".length).trim();
        if (!query) throw new Error("Masukkan judul lagu.");
        return `ytsearch1:${query}`;
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return `ytsearch1:${value}`;
    }

    const url = parseExternalHttpUrl(value);
    if (resolveDns) await resolvePublicAddresses(url.hostname, lookup, timeoutMs);
    return url.toString();
}

function createPinnedLookup(hostname, address) {
    const expectedHost = normalizeHostname(hostname);
    const family = net.isIP(address);
    if (!family || !isPublicIp(address)) {
        throw new Error("Alamat DNS pin tidak valid atau non-global.");
    }

    return (requestedHostname, options, callback) => {
        if (normalizeHostname(requestedHostname) !== expectedHost) {
            callback(new Error("DNS pin hostname mismatch."));
            return;
        }
        if (options?.family && options.family !== family) {
            callback(new Error("DNS pin address family mismatch."));
            return;
        }
        if (options?.all) {
            callback(null, [{ address, family }]);
        } else {
            callback(null, address, family);
        }
    };
}

module.exports = {
    DNS_TIMEOUT_MS,
    createPinnedLookup,
    isPublicIp,
    normalizeHostname,
    parseExternalHttpUrl,
    resolvePublicAddresses,
    validateMusicInput
};
