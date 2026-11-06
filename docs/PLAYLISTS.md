# Playlist Server

Playlists are stored per guild through the versioned `JsonGuildStore` collection. The Dashboard is available from `/menu` → **Playlists**. Members can enqueue tracks; creating, renaming, adding tracks, and deleting playlists requires the Discord **Manage Server** permission. Delete asks for confirmation and binds that confirmation to the user who requested it.

The playlist selector is paginated and offers four actions for each playlist. Create and add-track modals accept one search term or URL per line. Track resolution uses the existing Music Engine, so the configured `yt-dlp` and FFmpeg dependencies still apply.

AI Tag examples:

- `@Castorice lihat playlist`
- `@Castorice putar playlist Road Trip`

Playlist playback checks the per-guild Playlists and Music Feature Guard settings and requires the requester to be in a voice channel in the same server. It enqueues tracks serially. If the queue rejects a later track, the bot reports the number already added and the queue error instead of claiming full success.

The service currently allows up to 100 playlists per server and 500 tracks per playlist. Every mutation also requires a same-guild actor whose Discord permissions include **Manage Server**; the Dashboard checks this before the operation and the service checks the actor again. The Music Engine queue currently caps pending tracks at 100; larger playlist playback can therefore stop partway and report the partial result.

Autoplay is an opt-in setting for an active music session and is off by default. Toggle it from the music player or with `@Castorice autoplay on` / `@Castorice autoplay off`. When the queue is empty after a track finishes, Castorice searches up to eight yt-dlp results for a similar track, skips recently played titles/URLs, and queues the first valid recommendation. Turning Autoplay off or stopping the session cancels an active recommendation search. It does not discover or stream radio stations; radio discovery remains unimplemented.

The backend service (`src/playlists/service.js`) exposes `list`, `findByName`, `create`, `rename`, `addTracks`, `removeTrack`, and `remove`. It validates names and inputs, rejects case-insensitive duplicate names, and persists schema version 1 under `data/storage/<guildId>/playlists.json`.
