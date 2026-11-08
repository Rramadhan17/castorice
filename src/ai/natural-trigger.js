/**
 * Global Natural Trigger Parser for Castorice.
 * Supports Discord mentions (@Castorice) and prefix/natural name triggers (Castorice:, Castorice, Hey Castorice).
 * Strictly boundary-aware and ignores bots/webhooks.
 */

const LEADING_NAME_REGEX = /^(?:(?:hey|hai|halo|hi|hello)\s+)?castorice(?:[\s,;:!?]+|\s*[.]{1,3}\s*|\s+)?\s*(.*)$/i;
const STANDALONE_NAME_REGEX = /^(?:(?:hey|hai|halo|hi|hello)\s+)?castorice(?:[!?.]+)?$/i;

function extractTrigger(message, clientUser = null) {
    if (!message || typeof message.content !== "string") {
        return { isTriggered: false, cleanText: "", triggerType: null };
    }

    // Ignore bots and webhooks
    if (message.author?.bot || message.webhookId) {
        return { isTriggered: false, cleanText: "", triggerType: null };
    }

    const content = message.content.trim();
    if (!content) {
        return { isTriggered: false, cleanText: "", triggerType: null };
    }

    const clientUserId = clientUser?.id || message.client?.user?.id;

    // 1. Check Discord mention if client user ID is available
    if (clientUserId) {
        const mentionRegex = new RegExp(`^<@!?${clientUserId}>\\s*(.*)$`, "i");
        const mentionMatch = content.match(mentionRegex);
        if (mentionMatch) {
            const cleanText = mentionMatch[1].trim().replace(/^[:;,]\s*/, "");
            return {
                isTriggered: true,
                cleanText,
                triggerType: "mention"
            };
        }

        // Mention anywhere in the message if clientUser is in mentions
        if (message.mentions?.users?.has?.(clientUserId)) {
            const globalMentionRegex = new RegExp(`<@!?${clientUserId}>`, "gi");
            const cleanText = content.replace(globalMentionRegex, "").trim().replace(/^[:;,]\s*/, "");
            return {
                isTriggered: true,
                cleanText,
                triggerType: "mention"
            };
        }
    }

    // 2. Check standalone name trigger
    if (STANDALONE_NAME_REGEX.test(content)) {
        return {
            isTriggered: true,
            cleanText: "",
            triggerType: "name"
        };
    }

    // 3. Check leading name trigger
    const nameMatch = content.match(LEADING_NAME_REGEX);
    if (nameMatch) {
        return {
            isTriggered: true,
            cleanText: nameMatch[1].trim(),
            triggerType: "name"
        };
    }

    // Boundary-aware safety: "Aku suka Castorice" does NOT trigger
    return {
        isTriggered: false,
        cleanText: "",
        triggerType: null
    };
}

module.exports = {
    extractTrigger,
    LEADING_NAME_REGEX,
    STANDALONE_NAME_REGEX
};
