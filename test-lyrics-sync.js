const { getActiveLyric } = require("./src/lyrics/synchronizer");

const lyrics = [
    { time: 3.24, text: "Ooh, ooh" },
    { time: 9.19, text: "I, I just woke up from a dream" },
    { time: 15.99, text: "But you and I had to say goodbye" }
];

console.log("Posisi 5 detik:", getActiveLyric(lyrics, 5));
console.log("Posisi 12 detik:", getActiveLyric(lyrics, 12));
console.log("Posisi 20 detik:", getActiveLyric(lyrics, 20));
