const { ownerId } = require("../config/env");

function isOwner(userId) {
    return Boolean(ownerId) && userId === ownerId;
}

module.exports = { isOwner };
