# Voice Manager service

`src/voice-ai/manager-service.js` provides an injectable Discord.js service for temporary voice channels. It persists through the existing `src/voice-ai/state-manager.js` API and preserves that store's schema.

Implemented service operations:

- Create a temporary channel only when the requester is currently in a voice channel in the same guild. The bot must have `ManageChannels` and `MoveMembers`; optional private channels receive member and bot overwrites.
- Rename, change capacity, lock/unlock, transfer ownership to a member currently in the channel, and delete an owned channel.
- Record voice joins/leaves, schedule empty channel cleanup, cancel cleanup when activity returns, and recheck occupancy immediately before deleting.
- Validate Discord guild/member/channel IDs at the service boundary and reject cross-guild objects.

`src/voice-ai/register.js` registers the service, voice-state lifecycle recovery, and an ephemeral Dashboard Voice Manager panel. Members can create a temporary room while in voice, then rename it, set its member limit, lock/unlock it, transfer ownership, or confirm deletion. User actions validate the guild and owner; the bot requires Manage Channels, Move Members, and Connect in the destination channel to create/move users. Voice-state handlers schedule empty-channel cleanup, recheck occupancy, recover pending deadlines after ready, and transfer ownership to the oldest human present when configured. It does not run the bot or perform live Discord actions during tests.

The existing state manager defaults to one channel per member and a one-minute empty cleanup delay. Admin configuration and category provisioning are not exposed in Dashboard yet. The Voice Greeter remains a separate text-only module; this service does not provide TTS.

AI Tag commands include `@Castorice buat voice`, `@Castorice buat voice private bernama Team Room`, `@Castorice rename voice jadi Quiet Room`, `@Castorice atur limit voice 4`, `@Castorice kunci voice`, `@Castorice buka voice`, and `@Castorice transfer owner voice ke <user-id>`. `@Castorice hapus voice saya` asks for a button confirmation; the service rechecks ownership when the confirmation is clicked.

Run the isolated service tests with:

```sh
node --test test/voice-ai/manager-service.test.js
```
