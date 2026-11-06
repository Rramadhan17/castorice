const { searchLyrics } = require("./src/lyrics/engine");

async function main() {
    const result = await searchLyrics({
        title: "Die With A Smile",
        artist: "Lady Gaga, Bruno Mars",
        duration: 251
    });

    console.log({
        found: result.found,
        synced: result.synced,
        instrumental: result.instrumental,
        lyricLines: result.lyrics?.length || 0,
        preview: result.lyrics?.slice(0, 3) || result.plainLyrics?.slice(0, 200)
    });
}

main().catch(console.error);
