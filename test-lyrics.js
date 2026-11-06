const { parseLrc } = require("./src/lyrics/lrc-parser");

const sample = [
    "[offset:0]",
    "[00:01.50]Baris pertama",
    "[00:03.00][00:04.00]Baris kedua"
].join("\n");

console.log(parseLrc(sample));
