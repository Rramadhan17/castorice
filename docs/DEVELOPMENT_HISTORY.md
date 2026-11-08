# CASTORICE — DEVELOPMENT HISTORY
Project: Castorice — AI Server Ras Ultra
Platform: Discord.js v14 | Node.js CommonJS
Repository: Castorice Workspace

==================================================
PHASE 1 — REPOSITORY DISCOVERY DAN AUDIT
==================================================
Date: 2026-11-06
Status: COMPLETE
Summary:
- Menjalankan audit menyeluruh terhadap seluruh modul, file konfigurasi, test, dan dokumentasi.
- Syntax check 93 file JavaScript aktif: 0 syntax error.
- Automated tests: 167 total tests, 166 PASS, 1 FAIL.
- Mengidentifikasi akar masalah test TTS (assertion mismatch pada AbortSignal).
- Mengidentifikasi akar masalah bug seek -5/+5 (spawn ulang yt-dlp/ffmpeg tanpa duration check yang memicu EOF/stop).
- Mengidentifikasi volume cap di 100% dan hardcoded path Windows yt-dlp.exe.
- Membuat Artifact audit komprehensif dan Implementation Plan untuk Phase 2–18.

==================================================
PHASE 2 — PERIKSA HASIL AUDIT DAN TEST TTS YANG GAGAL
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Inspected:
- src/voice-ai/greeter-tts.js
- docs/VOICE_GREETER_TTS.md
- test/voice-ai/greeter-tts.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
Files Changed:
- test/voice-ai/greeter-tts.test.js (backup: test/voice-ai/greeter-tts.test.js.castorice-20261106-112608.bak)
- docs/MASTER_DEVELOPMENT_ROADMAP.md (backup: docs/MASTER_DEVELOPMENT_ROADMAP.md.castorice-20261106-112716.bak)
Implementation:
- Menyelaraskan assertion test di test/voice-ai/greeter-tts.test.js agar mencocokkan signal: AbortSignal sesuai kontrak synthesize(text, context).
Tests Executed:
- node --test test/voice-ai/greeter-tts.test.js (4/4 PASS)
- node --test test/**/*.test.js (167/167 PASS)
Verification Result:
- 167 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Baseline pengujian siap untuk pengembangan autonomous Phase 3 sampai Phase 18.

==================================================
PHASE 3 — GLOBAL NATURAL TRIGGER
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Created:
- src/ai/natural-trigger.js
- src/ai/intent-router.js
- test/ai/natural-trigger.test.js
- test/ai/intent-router.test.js
Files Changed:
- src/events/interactionCreate.js (backup: src/events/interactionCreate.js.castorice-20261106-113644.bak)
Implementation:
- Membangun trigger parser boundary-aware dan case-insensitive di src/ai/natural-trigger.js yang mendukung mention Discord (<@id>) dan name trigger ("Castorice:", "Castorice,", "Hey Castorice").
- Mencegah false positives jika nama Castorice muncul di tengah kalimat tanpa mention.
- Mengabaikan bot, webhook, dan bot sendiri.
- Membangun Global Natural Intent Router di src/ai/intent-router.js yang memetakan intent untuk Auto Disconnect, Trusted Member, Auto Kick, Social Downloader, Security Assistant, Server Templates, Voice Manager, Music, Playlists, Translator, dan Conversation.
- Mengintegrasikan in-memory conversation context per channel dengan TTL 3 menit untuk context continuation.
- Mengintegrasikan extractTrigger ke dalam client.on(Events.MessageCreate) di interactionCreate.js.
Tests Executed:
- node --test test/ai/natural-trigger.test.js test/ai/intent-router.test.js (12/12 PASS)
- node --test test/**/*.test.js (179/179 PASS)
Verification Result:
- 179 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 4 (Natural Response dan AI Conversation).

==================================================
PHASE 4 — NATURAL RESPONSE DAN AI CONVERSATION
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Created:
- src/ai/natural-responder.js
- test/ai/natural-responder.test.js
Implementation:
- Membangun NaturalResponder di src/ai/natural-responder.js yang menyusun respons ramah dan natural untuk seluruh domain (Music, Playlists, Translator, Voice Manager, Server Templates, Security Assistant, Auto Disconnect, Trusted Member, Auto Kick, Social Downloader, dan Percakapan Umum).
- Menerapkan prinsip Truthfulness: respons sukses hanya dibuat jika eksekusi service mengembalikan status "success".
- Menyediakan fallback response template terstruktur ketika external AI provider offline atau belum dikonfigurasi.
- Menangani permission denied dan feature disabled secara transparan dan sopan.
Tests Executed:
- node --test test/ai/natural-responder.test.js (6/6 PASS)
- node --test test/**/*.test.js (185/185 PASS)
Verification Result:
- 185 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 5 (Music Engine Audit: Volume 0-500, cross-platform yt-dlp path).

==================================================
PHASE 5 — MUSIC ENGINE AUDIT
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Created:
- test/music/volume-500.test.js
Files Changed:
- src/music/manager.js (backup: src/music/manager.js.castorice-20261106-114240.bak)
- src/dashboard/menu-panel.js (backup: src/dashboard/menu-panel.js.castorice-20261106-114240.bak)
Implementation:
- Mengubah batasan volume di src/music/manager.js dari 0-100% menjadi 0-500% (volume multiplier hingga 5.0x) dengan pesan validasi "Volume harus antara 0 sampai 500."
- Menambahkan pilihan volume hingga 500% pada Select Menu Dashboard di src/dashboard/menu-panel.js ([0, 25, 50, 75, 100, 150, 200, 300, 500]).
- Menambahkan resolver platform-aware resolveYtDlpPath() di src/music/manager.js untuk binary yt-dlp pada Windows dan Linux.
- Menambahkan export getSessions: () => sessions di src/music/manager.js untuk isolasi pengujian.
Tests Executed:
- node --test test/music/volume-500.test.js (1/1 PASS)
- node --test test/**/*.test.js (186/186 PASS)
Verification Result:
- 186 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 6 (Lyrics Multi-provider).

==================================================
PHASE 6 — LYRICS MULTI-PROVIDER
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Created:
- src/lyrics/title-cleaner.js
- test/lyrics/multi-provider.test.js
Files Changed:
- src/lyrics/engine.js (backup: src/lyrics/engine.js.castorice-20261106-120209.bak)
Implementation:
- Membangun src/lyrics/title-cleaner.js untuk membersihkan tag video YouTube (Official Video, Audio, Visualizer, feat/ft) dan mendeteksi versi (live, remix, acoustic, cover).
- Membangun arsitektur multi-provider di src/lyrics/engine.js dengan LRCLIB sebagai Primary provider (timestamped LRC + plain) dan Lyrics.ovh sebagai Secondary open API fallback.
- Menambahkan klasifikasi status hasil lirik (synced, plain, instrumental, not_found, timeout).
- Menerapkan bounded timeout AbortSignal (6000ms) dan in-memory cache TTL 30 menit.
Tests Executed:
- node --test test/lyrics/multi-provider.test.js (3/3 PASS)
- node --test test/lyrics/*.test.js (22/22 PASS)
- node --test test/**/*.test.js (189/189 PASS)
Verification Result:
- 189 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 7 (Karaoke Synchronization: clock sync dan adaptive refresh).

==================================================
PHASE 7 — KARAOKE SYNCHRONIZATION
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Changed:
- src/music/panel-updater.js (backup: src/music/panel-updater.js.castorice-20261106-120728.bak)
Implementation:
- Mengoptimalkan mekanisme update panel karaoke di src/music/panel-updater.js dengan mendeteksi perubahan baris aktif (lastDescription diffing) dan pembatasan adaptif (maksimal 5 detik interval per baris statis) untuk mencegah penipisan kuota rate limit Discord API tanpa mengurangi responsivitas sinkronisasi.
- Memastikan timer berhenti secara bersih saat lagu selesai atau sesi ditutup.
Tests Executed:
- node --test test/lyrics/*.test.js (22/22 PASS)
- node --test test/**/*.test.js (189/189 PASS)
Verification Result:
- 189 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 8 (Seek -5/+5 boundary checks, serialization, regression tests).

==================================================
PHASE 8 — SEEK -5/+5
==================================================
Date: 2026-11-06
Status: COMPLETE
Files Created:
- test/music/seek-regression.test.js
Files Changed:
- src/music/manager.js (backup: src/music/manager.js.castorice-20261106-120900.bak)
- src/events/interactionCreate.js (backup: src/events/interactionCreate.js.castorice-20261106-120900.bak)
Implementation:
- Memperbaiki fungsi seek di src/music/manager.js dengan:
  1. Serialisasi seek queue berbasis Promise chain untuk mencegah race condition dari klik berulang / concurrent clicks.
  2. Pengecekan batas durasi atas (track.duration): jika seek +5 melebihi durasi lagu, memicu transisi track finish/next secara bersih tanpa crash FFmpeg EOF atau Stop mendadak.
  3. Pengecekan batas bawah 0 detik (Math.max(0, currentPosition + delta)) untuk seek -5.
  4. Penyuntikan runtime dependency (runtime.next, runtime.finishTrack, runtime.transitionTrack) untuk deterministik testing.
  5. Perbaikan assertTransitionAvailable agar tidak gagal pada nilai undefined startingTrackToken.
- Memperbaiki handler tombol seek di src/events/interactionCreate.js dengan isolasi try/catch dan safe fallback update agar interaksi Discord tidak pernah hang/unresponsive.
- Membuat 5 regression tests di test/music/seek-regression.test.js yang memverifikasi batas atas/bawah, delta limit, serialisasi klik berturut-turut, dan pencegahan accidental stop.
Tests Executed:
- node --test test/music/seek-regression.test.js (5/5 PASS)
- node --test test/music/*.test.js (27/27 PASS)
- node --test test/**/*.test.js (194/194 PASS)
Verification Result:
- 194 PASS, 0 FAIL (100% PASS).
Remaining Issues:
- Siap melanjutkan ke Phase 9 (Natural Music Integration).

==================================================
PHASE 9 — AI PROVIDER DAN NATURAL CHAT ROUTING
==================================================
Date: 2026-11-06
Status: IMPLEMENTED, INTEGRATED, TESTED; OPERATIONAL BLOCKED BY CREDENTIALS
Objective:
- Menghubungkan pesan natural Castorice yang bukan perintah fitur ke provider AI yang dapat dikonfigurasi, tanpa mengklaim keberhasilan ketika provider belum tersedia.
Audit:
- Feature registry menandai AI Chat belum diimplementasikan; trigger natural di handler aktif hanya meneruskan unknown command ke pesan bantuan statis.
- Tidak ada adapter provider AI atau konfigurasi AI di .env.example.
- Natural volume increase masih membatasi volume ke 100% walaupun Music Engine mendukung hingga 500%.
Bugs dan Root Cause:
- Pesan percakapan biasa tidak mencapai model AI karena MessageCreate handler hanya menjalankan parser fitur spesifik.
- Batas atas pada handler volume natural tidak konsisten dengan batas Music Engine.
Files Changed:
- src/ai/openai-compatible-provider.js
- src/ai/conversation-service.js
- src/events/interactionCreate.js
- src/features/feature-registry.js
- src/dashboard/menu-panel.js
- .env.example
- docs/AI_CHAT.md
- test/ai/openai-compatible-provider.test.js
- test/ai/conversation-service.test.js
- test/integration/ai-chat-routing.test.js
- test/integration/music-volume-routing.test.js
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Menambahkan adapter Chat Completions kompatibel OpenAI dengan konfigurasi endpoint/model/key, timeout, retry terbatas, validasi respons, dan token usage yang tidak pernah dicatat ke log.
- Menghubungkan trigger natural unknown ke AI Chat per guild dan per user; fitur harus diaktifkan administrator, sementara data percakapan dibatasi di memori, memiliki rate limit/TTL, dan dapat direset dengan "reset percakapan".
- Menambahkan AI panel ke dashboard dan dokumentasi konfigurasi tanpa kredensial.
- Mengubah kontrol volume natural agar menghormati batas 0–500%.
Tests:
- Regression tests provider, retry, timeout, validasi konfigurasi, isolasi percakapan, usage, reset, opt-in guild, serta volume natural.
- node --check pada seluruh file JavaScript yang diubah.
- npm test (seluruh suite).
Actual Results:
- 206 PASS, 0 FAIL.
- Provider eksternal tidak diuji karena tidak ada kredensial yang disediakan; integrasi AI memerlukan AI_API_KEY dan model yang tersedia dari provider.
- Startup/login dan command deployment ke Discord tidak dijalankan untuk menghindari efek samping pada bot/server live.
Security Impact:
- AI Chat nonaktif secara default dan hanya memanggil provider setelah trigger bot tervalidasi dan administrator mengaktifkan fitur.
- API key tidak dimasukkan ke repository, tidak dikirim ke chat, dan tidak dicatat ke log. Mention otomatis dinonaktifkan pada jawaban AI.
- Riwayat tidak dipersistenkan; konteks terisolasi, berbatas ukuran, memiliki TTL, dan dapat dihapus per pengguna.
Regression Impact:
- Perintah layanan yang sudah ada tetap dirutekan sebelum fallback percakapan AI.
- Music volume adjustment mempertahankan batas engine 0–500%.
Remaining Tasks:
- Operasional AI menunggu konfigurasi provider/kredensial pemilik dan smoke test pada provider yang dipilih.
- Roadmap proyek fase selanjutnya belum selesai; voice speech/live input, integrasi lintas-modul lanjutan, dan pengujian operasional layanan eksternal tetap perlu implementasi/verifikasi tersendiri.

PHASE 9 ADDENDUM — PRIVACY RESET DAN PROVIDER CONFIGURATION
Date: 2026-11-06
Objective:
- Menutup kondisi balapan ketika pengguna menghapus riwayat saat request AI masih berjalan, dan menghindari asumsi model AI tertentu.
Audit:
- Reset awal menghapus sesi lokal, tetapi tidak membatalkan request provider yang sedang berjalan; hasil lambat dapat tetap diproses setelah reset.
- Factory provider sebelumnya memilih model default walau ketersediaan model provider belum diketahui.
Files Changed:
- src/ai/conversation-service.js
- src/ai/openai-compatible-provider.js
- src/events/interactionCreate.js
- .env.example
- docs/AI_CHAT.md
- test/ai/conversation-service.test.js
- test/ai/openai-compatible-provider.test.js
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Reset membatalkan AbortSignal request yang sedang berjalan, dan pemeriksaan generation mencegah hasil lama mengembalikan konteks yang sudah dihapus.
- Factory hanya membuat provider ketika AI_API_KEY dan AI_MODEL sama-sama ditetapkan.
- Menambahkan regresi untuk abort request aktif, reset saat request berjalan, konfigurasi tanpa model, dan perlindungan konteks terhapus.
Tests:
- Test AI terarah: 13/13 PASS.
- node --check pada 9 file JavaScript yang diubah: PASS.
- npm test: 208/208 PASS.
Actual Results:
- Tidak ada kredensial eksternal yang digunakan; provider live tetap BLOCKED sampai pemilik mengonfigurasi API key/model.
Security Impact:
- Meminimalkan pemrosesan lanjutan prompt yang konteksnya telah dihapus dan menghindari pilihan model tersembunyi.
Regression Impact:
- Percakapan baru setelah reset dimulai dengan konteks kosong; provider yang tidak lengkap tetap tidak aktif.
Remaining Tasks:
- Kriteria penyelesaian penuh master roadmap belum tercapai; fase fitur selain perubahan yang tercatat di atas masih memerlukan audit, implementasi, dan pengujian.

==================================================
PHASE 10 — VOICE AI INTERACTION DAN SECURITY PRESENCE
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND TESTED; NOT LIVE OPERATIONAL
Implementation:
- Menambahkan routing permintaan Voice AI eksplisit ke layanan AI dan lifecycle TTS yang sudah ada; fitur tetap opt-in dan memerlukan voice membership yang sah, konfigurasi AI, serta provider TTS.
- Menambahkan laporan ringkas presence bot dari cache Security Assistant. Status offline/invisible dan data unknown disajikan dengan batasan yang jelas, tanpa tindakan otomatis.
- Menjadikan Discord Presence Intent pilihan konfigurasi, tidak mengubah intent default.
Tests:
- Test terarah Voice AI, presence, Feature Guard, dan Discord intents yang dilaporkan saat milestone: 24/24 PASS.
- Suite lengkap setelah milestone musik di bawah mencakup test Voice AI/presence.
Operational Status:
- Tidak ada login Discord, pemanggilan provider AI/TTS, maupun deployment live.
- Voice AI memerlukan AI_API_KEY, AI_MODEL, dan module lokal VOICE_GREETER_TTS_MODULE. Presence report hanya mencakup cache yang tersedia.

==================================================
PHASE 11 — MUSIC SEARCH CLEANUP DAN SESSION AUTOPLAY
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND TESTED; LIVE PROVIDERS NOT VERIFIED
Files Changed:
- src/music/manager.js
- src/ai/music-intent.js
- src/events/interactionCreate.js
- src/dashboard/menu-panel.js
- test/music/queue-lifecycle.test.js
- test/ai/music-intent.test.js
- test/dashboard/music-autoplay-panel.test.js
- test/integration/music-autoplay-routing.test.js
- docs/PLAYLISTS.md
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Memperbaiki cleanup timeout/output yt-dlp yang sebelumnya memanggil killProcess tanpa deklarasi di Music Manager; proses kini dihentikan melalui helper bounded stopProcessPair yang sudah digunakan lifecycle Music.
- Menambahkan autoplay opt-in per sesi, nonaktif secara default. Saat antrean kosong setelah lagu selesai, pencarian yt-dlp dibatasi ke delapan hasil, deduplikasi mencakup judul/URL terbaru, dan rekomendasi harus lolos validasi input sebelum masuk antrean.
- Menambahkan pembatalan pencarian dengan AbortSignal saat autoplay dimatikan atau sesi dihentikan, serta mencegah add-to-queue memulai track bersamaan dengan finalisasi track.
- Menghubungkan kontrol autoplay ke panel Music, pemeriksaan akses kontrol musik, dan intent natural `autoplay on/off` / `putar otomatis nyala/mati`.
Tests Executed:
- Test terarah lifecycle, parsing intent, panel Dashboard, routing integrasi, dan process cleanup: 22/22 PASS.
- npm test: 225/225 PASS.
- node --check pada seluruh 8 file JavaScript yang diubah: PASS.
Actual Results:
- Autoplay hanya memakai pencarian yt-dlp yang tersedia dan tidak mengimplementasikan radio discovery.
- Tidak ada Discord gateway, provider eksternal, atau playback live yang diuji; Music Engine dan kesiapan operasional keseluruhan tetap belum dinyatakan selesai.
- AI Chat tetap COMPLETE dan TESTED berdasarkan 208/208 test milestone sebelumnya; fitur belum live operational karena API key/model belum dikonfigurasi dan diuji.

==================================================
PHASE 12 — MUSIC EFFECTS ENDPOINT BIND RETRY
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED
Files Changed:
- src/music/manager.js
- test/music/track-startup.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Mengurangi risiko race saat port sementara yang dipilih untuk ZeroMQ direbut proses lain sebelum FFmpeg bind.
- Jika FFmpeg melaporkan bind collision saat startup, Music Manager membersihkan kedua child process dan Effects lease, lalu mencoba endpoint baru; maksimum dua retry tambahan.
- Jika semua upaya gagal, startup tetap gagal secara eksplisit, tanpa memutar track atau menyisakan lease/child process.
Tests Executed:
- Test terarah endpoint allocator, Manager startup/Stop, cleanup dan queue lifecycle: 21/21 PASS.
- npm test: 227/227 PASS.
- node --check pada seluruh 9 file JavaScript yang diubah pada follow-up ini: PASS.
Limitations:
- Retry hanya mitigasi untuk collision yang dilaporkan FFmpeg; kontensi berulang tetap menghasilkan kegagalan setelah batas retry.
- Tidak ada login Discord, FFmpeg/music provider live, maupun playback gateway yang diuji.
- Seluruh roadmap belum selesai; AI Chat tetap tested tetapi bukan live operational sampai pemilik mengonfigurasi dan menguji API key/model.

==================================================
PHASE 13 — RADIO DISCOVERY DAN MUSIC ENGINE
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (NOT LIVE)
Files Created:
- src/music/radio-discovery.js
- test/music/radio-discovery.test.js
- test/dashboard/radio-discovery-panel.test.js
- test/integration/radio-discovery-routing.test.js
Files Changed:
- src/music/manager.js
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- src/ai/music-intent.js
- test/music/track-startup.test.js
- test/music/seek-regression.test.js
Implementation:
- Menambahkan Radio Browser search provider dengan batas timeout, batas panjang query/hasil, deduplikasi, normalisasi metadata, dan pencarian nama maupun tag.
- Menambahkan pencarian station melalui Dashboard dan natural language, daftar hasil yang dapat dipilih, serta enqueue ke Music Engine dengan akses voice server yang sudah berlaku.
- Menambahkan jalur live stream langsung ke FFmpeg tanpa metadata scraping yt-dlp; kontrol seek dan lyrics dinonaktifkan/ditolak untuk radio.
- Memvalidasi skema URL HTTP(S), kredensial URL, localhost, domain lokal, dan sejumlah alamat IP privat/lokal. Validasi ini tidak membuktikan keamanan DNS/rebinding atau redirect end-to-end.
Tests Executed:
- Test terarah Radio Discovery, seek, dashboard, startup, routing, dan music intent: 29/29 PASS.
- npm test: 239/239 PASS.
- node --check pada seluruh 11 file JavaScript yang berubah: PASS.
Limitations:
- Tidak ada request ke Radio Browser live, koneksi Discord gateway, atau playback station live yang diuji; fitur ini tidak dinyatakan live-operational.
- Radio/FFmpeg live stream bergantung pada URL station yang dapat dijangkau dan didukung oleh FFmpeg. Redirect dan DNS privat belum diverifikasi secara menyeluruh.
- AI Chat tetap COMPLETE dan TESTED; belum live operational sebelum API key/model dikonfigurasi dan diuji.
- Roadmap berikutnya yang belum selesai mencakup validasi live eksternal dengan otorisasi pemilik, penyelesaian route AI Tag Server Template yang aman, cakupan error-path Dashboard, serta dependency/provider operasional Voice AI/Greeter dan Translator.

==================================================
PHASE 14 — AI TAG VOICE GREETER
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (NOT LIVE)
Files Created:
- src/voice-ai/greeter-tag-router.js
- test/voice-ai/greeter-tag-router.test.js
- test/integration/voice-greeter-tag-routing.test.js
Files Changed:
- src/events/interactionCreate.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Menambahkan intent natural-language eksplisit untuk membuka konfigurasi pesan Voice Greeter melalui AI Tag.
- Menolak konfigurasi ketika Feature Guard menonaktifkan fitur atau aktor tidak memiliki Manage Server.
- Mengarahkan pengguna yang berwenang ke modal Dashboard yang sudah ada; `{user}` tetap didukung dan mention massal tetap disupresi.
Tests Executed:
- Test terarah AI Tag, event routing, Dashboard configuration dan persistence: 6/6 PASS.
- node --check pada seluruh 4 file JavaScript yang berubah: PASS.
Limitations:
- Route hanya membuka konfigurasi; tidak memanggil TTS atau mengubah pengaturan tanpa input modal.
- Tidak ada Discord gateway atau TTS provider live yang diuji; Voice Greeter dan Voice AI tidak dinyatakan live-operational.
- AI Tag Server Template preview-modal entry juga sudah ditambahkan dan lulus test terarah 16/16; eksekusi apply tetap memerlukan preview dan konfirmasi melalui Dashboard.

==================================================
PHASE 15 — TRANSLATOR TARGET LANGUAGE SELECTION
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (NOT LIVE)
Files Changed:
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- test/dashboard/translator-panel.test.js
- test/integration/translator-routing.test.js
- docs/TRANSLATOR.md
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Menambahkan tombol pemilih bahasa tujuan pada Translator Dashboard yang memuat bahasa dari endpoint provider `/languages`.
- Menampilkan maksimal 25 bahasa per halaman dan menyediakan navigasi halaman.
- Pilihan target membuka modal terjemahan dengan kode bahasa terpilih terisi; validasi Feature Guard dan error provider tetap berlaku.
- Memperbarui panduan konfigurasi dan batas operasional Translator.
Tests Executed:
- Test terarah Translator provider, Dashboard, AI routing, dan pilihan bahasa: 17/17 PASS.
- npm test: 247/247 PASS (suite penuh).
- node --check seluruh 19 file JavaScript yang berubah dalam rangkaian milestone ini: PASS.
Limitations:
- Tes menggunakan provider mock; tidak ada request ke layanan LibreTranslate live dan fitur belum dinyatakan live-operational.
- Bahasa sumber masih dimasukkan sebagai kode (`auto` untuk deteksi); ketersediaan pasangan bahasa tetap bergantung pada provider.
- Multi-batch lyrics tetap tidak mengklaim sinkronisasi timestamp.

==================================================
PHASE 16 — SECURITY ASSISTANT AUDIT HISTORY
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED
Files Changed:
- src/security/tag-router.js
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- test/security/tag-router.test.js
- test/integration/security-assistant-routing.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Menambahkan tombol riwayat audit pada panel Security Assistant `/menu`, dengan respons ephemeral dan pemeriksaan Feature Guard serta Manage Server.
- Menambahkan intent AI Tag `riwayat audit` untuk menampilkan hingga lima ringkasan terbaru, tanpa memulai audit baru.
- Riwayat mencantumkan waktu, hitungan severity, dan report ID; tidak menampilkan detail temuan dan tetap tanpa tindakan otomatis.
Tests Executed:
- Test terarah Security Assistant, persistence, dashboard, dan AI Tag: 10/10 PASS.
- node --check pada seluruh 5 file JavaScript yang berubah: PASS.
Limitations:
- Riwayat service dibatasi maksimal 20 report per guild; panel menampilkan hingga 10 ringkasan dan AI Tag hingga 5.
- Data gateway/cache yang digunakan audit tetap terbatas; configurable policy/allowlists dan verifikasi izin/API Discord live belum selesai.

==================================================
PHASE 17 — CONSOLIDATED REGRESSION VERIFICATION
==================================================
Date: 2026-11-06
Status: VERIFIED
Verification:
- npm test: 249/249 PASS, 0 FAIL.
- Targeted Radio Discovery: 29/29 PASS.
- Targeted Server Template: 16/16 PASS.
- Targeted Voice Greeter: 7/7 PASS.
- Targeted Translator: 17/17 PASS.
- Targeted Security Assistant: 10/10 PASS.
- node --check: seluruh 22 file JavaScript yang berubah dalam rangkaian milestone ini PASS.
Limitations:
- Tidak ada pengujian live ke Radio Browser, LibreTranslate, AI provider, TTS provider, Discord gateway, atau server Discord.
- AI Chat tetap COMPLETE dan TESTED; statusnya bukan live-operational sampai API key/model dikonfigurasi dan diverifikasi.

==================================================
PHASE 18 — SECURITY ASSISTANT OFFLINE POLICY (ALERT-ONLY)
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (NOT CONTINUOUS)
Files Changed:
- src/security/assistant.js
- src/security/tag-router.js
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- test/security/assistant.test.js
- test/security/tag-router.test.js
- test/integration/security-assistant-routing.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Implementation:
- Menambahkan konfigurasi kebijakan offline alert-only per server: enabled, threshold 5-10080 menit, maksimum jarak sampel 1-60 menit (harus lebih kecil dari threshold), dan hingga 100 ID bot yang dikecualikan.
- Perubahan kebijakan memerlukan preview ephemeral, konfirmasi requester-bound berumur lima menit, Feature Guard, Manage Server, dan pemeriksaan ulang aktor saat menyimpan.
- Hanya status `offline` yang eksplisit di cache Discord yang menjadi sampel offline. Unknown/missing, online, idle, DND, bot whitelist, dan evaluasi yang tidak berurutan mereset kontinuitas.
- Setiap perubahan kebijakan dan keputusan sampel disimpan dalam audit log bounded per guild. Keputusan threshold hanya kandidat alert; tidak ada kick, ban, atau perubahan anggota.
- Dashboard dan AI Tag dapat melihat status kebijakan; AI Tag mengarahkan administrator ke flow preview Dashboard yang sama.
Tests Executed:
- Tes terarah Security Assistant policy, persistence, confirmation, history dan routes: 13/13 PASS.
- node --check pada seluruh 7 file JavaScript yang berubah dalam milestone ini: PASS.
Limitations:
- Evaluasi berlangsung hanya saat administrator menjalankan audit manual; ini bukan scheduler/monitor kontinu dan tidak bisa membuktikan durasi offline di antara audit tanpa sampel.
- Discord presence cache dapat tidak lengkap; status offline tetap tidak membuktikan bot mati atau aman ditindak. Tidak ada tindakan otomatis.
- Belum ada live Discord Gateway/API test.

==================================================
PHASE 19 — RADIO STREAM SSRF-RESISTANT RELAY
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (NOT LIVE)
Files Changed:
- src/music/radio-stream-proxy.js
- src/music/manager.js
- test/music/radio-stream-proxy.test.js
- test/music/track-startup.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Backup:
- src/music/manager.js.backup-radio-security-20261106-173916
- radio-stream-proxy.js was newly created and had no prior file to back up.
Implementation:
- Radio FFmpeg input now uses a random-token loopback HTTP URL; FFmpeg no longer connects directly to the station URL.
- Resolves and pins public IPv4 addresses before each outbound request, rejects private/reserved destinations and validates every redirect hop.
- Rejects HTTPS downgrade redirects, bounds redirects, concurrent clients and request/idle timeouts, and logs relay failures without exposing provider response bodies.
- Track teardown, transition, startup failure and proxy close destroy owned requests/responses and close the loopback server. A blocked URL fails before FFmpeg is spawned.
Tests Executed:
- Radio proxy and Music Manager targeted tests: 19/19 PASS.
- npm test: 266/266 PASS, 0 FAIL.
- node --check: all 15 changed JavaScript source/test files PASS.
Status:
- PASS: DNS pinning, redirect validation, private-target rejection, timeouts, relay, and teardown regression coverage.
- FAIL: 0 in final test run.
- SKIPPED: live station/provider and Discord Gateway playback tests.
- BLOCKED: live behavior requires an authorized external station/provider and Gateway test.
Limitations:
- DNS, redirect, timeout, relay and process lifecycle tests use controlled fakes; no live radio provider, station URL, Discord Gateway or real voice playback was tested.
- The relay intentionally permits only public IPv4 destinations. Live provider/network behavior remains unverified.

==================================================
PHASE 20 — SERVER TEMPLATE AI TAG WORKFLOW
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (REAL DISCORD NOT VERIFIED)
Files Changed:
- src/server-templates/tag-router.js
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- test/server-templates/tag-router.test.js
- test/dashboard/server-template-panel.test.js
- test/integration/server-template-dashboard-routing.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/DEVELOPMENT_HISTORY.md
Backup:
- Timestamped siblings with suffix backup-template-workflow-20261106-175233 were created for active source files, Server Template tag/integration tests, and both documentation files before the workflow changes.
Implementation:
- AI Tag accepts explicit create, rebuild, clone, smart-merge and preview requests; requested modes are preselected in the existing Dashboard preview modal. Snapshot creation/listing remain distinct operations.
- Mode selection only opens the guarded modal. Existing source/target Manage Server checks, preview plan hash, five-minute requester-bound apply button, executor confirmation and rollback remain in force.
- Concurrent applies to the same target guild are rejected while an apply is active in this process.
Tests Executed:
- Targeted Server Template and Security Assistant routing/policy suite: 30/30 PASS.
- npm test: 266/266 PASS, 0 FAIL.
- node --check: all 15 changed JavaScript source/test files PASS.
Status:
- PASS: AI Tag mode routing, existing Dashboard preview/confirmation/apply protection, and concurrent apply regression.
- FAIL: 0 in final test run.
- SKIPPED: live Discord server mutation and hierarchy/rollback tests.
- BLOCKED: live verification requires an authorized test server and bot permissions.
Limitations:
- AI-generated layouts are not implemented. Confirmation state and the apply lock are process-local/in-memory.
- Discord permission hierarchy, real mutations and rollback behavior have not been tested against a live server or Gateway.

==================================================
PHASE 21 — VOICE AI AND TRANSLATOR PROVIDER READINESS
==================================================
Date: 2026-11-06
Status: MOCKED INTEGRATIONS VERIFIED; LIVE OPERATION BLOCKED
Files Audited:
- src/ai/openai-compatible-provider.js
- src/translator/libretranslate-provider.js
- src/voice-ai/interaction-service.js
- src/voice-ai/greeter-tts.js
- docs/TRANSLATOR.md
- docs/VOICE_GREETER_TTS.md
Tests Executed:
- Targeted AI provider, Voice AI/TTS and Translator unit/integration suite: 56/56 PASS.
Status:
- PASS: mocked provider configuration, error handling, cancellation, routing and TTS lifecycle tests.
- FAIL: 0 in the targeted provider suite.
- SKIPPED: live AI/TTS/Translator provider requests and Discord Gateway playback.
- BLOCKED: live validation requires configured provider credentials/modules and authorized Gateway testing.
Readiness:
- Provider errors and credential-bearing response bodies are sanitized in regression tests; AI requires AI_API_KEY and AI_MODEL, Voice AI speech requires a trusted local VOICE_GREETER_TTS_MODULE, and Translator requires a reachable configured LibreTranslate endpoint.
- Configuration and test entry points are documented. No external provider request or Discord Gateway login/playback was performed.
Limitations:
- AI Chat remains COMPLETE and TESTED, but is not live-operational until an owner configures and verifies a provider.
- Voice AI/TTS and Translator are not declared live-operational. Real-provider and authorized Discord Gateway verification remain BLOCKED pending provider configuration and test authorization.

==================================================
PHASE 22 — MULTI-PROVIDER AI DAN SECURITY MONITOR
==================================================
Date: 2026-11-06
Status: IMPLEMENTED AND REGRESSION-TESTED (MOCKED; NOT LIVE)

Files Created:
- src/ai/gemini-provider.js
- src/ai/provider-manager.js
- src/ai/provider-settings.js
- src/security/monitor.js
- test/ai/gemini-provider.test.js
- test/ai/provider-manager.test.js
- test/ai/provider-settings.test.js
- test/integration/ai-provider-settings-routing.test.js
- test/security/monitor.test.js
- test/security/monitor-persistence.test.js

Files Changed:
- .env.example
- docs/AI_CHAT.md
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- docs/SECURITY_ASSISTANT.md
- docs/VOICE_AI.md
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- src/main.js
- src/security/assistant.js
- src/security/tag-router.js
- src/voice-ai/interaction-router.js
- test/integration/security-assistant-routing.test.js
- test/security/tag-router.test.js

Timestamped Backups Created:
- 20261106-212354: src/events/interactionCreate.js, src/main.js, src/security/assistant.js, .env.example, docs/AI_CHAT.md, docs/DEVELOPMENT_HISTORY.md, docs/MASTER_DEVELOPMENT_ROADMAP.md
- 20261106-212843: src/dashboard/menu-panel.js, src/security/tag-router.js, test/integration/security-assistant-routing.test.js, test/security/tag-router.test.js
- 20261106-213318: docs/SECURITY_ASSISTANT.md
- 20261106-213532: docs/VOICE_AI.md, src/voice-ai/interaction-router.js, test/voice-ai/interaction-router.test.js
- Existing backups were retained; no backup was removed.

Implementation:
- Added Gemini native generateContent adapter using API-key headers, bounded timeout/retry, cancellation, response validation, sanitized failures, and token usage mapping. OpenAI-compatible configuration remains backward-compatible; OpenRouter uses its OpenAI-compatible endpoint.
- Added provider ordering, sequential failover, three-failure/30-second cooldown, per-provider health and in-memory usage counters, strict key/model pair validation for new providers, and environment-controlled failover.
- Added owner-only natural-trigger commands for provider health/status and process-local provider ordering. Keys cannot be entered or displayed. Existing Discord mention and Castorice-name triggers remain unchanged.
- Added opt-in message-event spam monitoring, disabled by default. It counts repeated identical text per guild/channel/user, deletes messages at the configured threshold, and applies a bounded timeout at the higher threshold only when Feature Guard, bot permissions, target permissions, and role hierarchy checks pass.
- Bot/webhook messages, configured owner, guild owner, moderators/administrators, and configured user IDs are excluded. State and audit records are bounded; message text is not persisted. Security action events are visible in Dashboard and AI Tag history.
- Offline bot presence remains alert-only and is never used for automated member action. No kick or ban automation was added.
- Updated provider/security environment examples and configuration documentation; `.env` was not edited and no credential value was printed.

Tests and Checks:
- PASS: baseline `npm test` before code changes — 266/266.
- PASS: final `npm test` — 285/285; 0 FAIL, 0 SKIPPED.
- PASS: `node --check` — all 18 changed JavaScript source/test files.
- PASS: provider/failover, owner access, trigger routing, spam thresholds, feature/permission denial, role hierarchy, audit persistence, and history routing are covered by mocked regression tests.
- FAIL: 0 in the final test run.
- SKIPPED: live AI providers, Discord Gateway, external service calls, real message deletion, and real timeout execution.
- BLOCKED: live validation requires configured provider credentials and an authorized test guild/Gateway. Spam controls are global environment settings; per-guild configuration UI remains incomplete.

Operational Status:
- AI Chat remains COMPLETE and TESTED, now with additional provider adapters and failover; it is not live-operational until an owner configures and tests a provider.
- Security spam monitoring is implemented but remains disabled unless `SECURITY_AUTO_MODERATION=true`; default settings may still false-positive on repeated legitimate messages.
- Voice AI remains dependent on a configured AI provider and local TTS module. No live provider, Gateway, or voice playback was exercised.
- No commit, push, or deployment was performed.

==================================================
PHASE — API-KEY-ONLY AI DISCOVERY DAN AUTONOMOUS SECURITY
==================================================
Date: 2026-11-06
Status: IMPLEMENTED (MOCK-TESTED; NOT LIVE)

Files Changed:
- .env.example
- docs/AI_CHAT.md
- docs/SECURITY_ASSISTANT.md
- docs/MASTER_DEVELOPMENT_ROADMAP.md
- src/ai/openai-compatible-provider.js
- src/ai/provider-manager.js
- src/ai/gemini-provider.js
- src/dashboard/menu-panel.js
- src/events/interactionCreate.js
- src/security/assistant.js
- src/security/monitor.js
- src/security/tag-router.js
- test/ai/openai-compatible-provider.test.js
- test/ai/provider-manager.test.js
- test/integration/security-assistant-routing.test.js
- test/security/assistant.test.js
- test/security/monitor.test.js
- test/security/tag-router.test.js

Timestamped Backups:
- Backup set `20261106-222453`: 20 existing scoped source, test, example-environment, and documentation files. All 20 backup files were verified present; earlier backups were retained.

Implementation:
- OpenAI-compatible, Gemini, and OpenRouter now accept API-key-only configuration. Legacy model variables remain valid optional overrides; model variables without their matching API key are rejected.
- Gemini selection uses catalogue entries advertising `generateContent`; OpenRouter selection uses catalogue endpoint, text modality, and request-parameter metadata. OpenAI's catalogue does not provide Chat Completions capability, so candidates are selected only from returned supported-family IDs and compatibility is checked by a real request; bounded fallback occurs only on model-not-found/incompatible responses. No model IDs are hard-coded.
- Model catalogues are cached with a five-minute TTL, discovery uses configured request timeouts, candidate/page counts are capped, and existing provider order, failover, cooldown, usage counters, cancellation, and explicit model overrides remain.
- Spam observation starts automatically and persists repeated-message alerts without raw message content. Destructive delete/timeout remain disabled per guild until a Manage Server administrator previews and confirms a persistent guild policy through the Dashboard; AI Tag links administrators to the same guarded flow.
- Moderator exclusions use effective per-channel permissions and fail closed when unavailable. Feature Guard, bot channel permissions, exemptions, bot/owner protection, timeout permission, and hierarchy checks remain enforced.
- A persistent audit intent is required before each destructive action; audit failure blocks the action. Timestamp arrays and pending message queues are bounded.
- `.env.example` lists model overrides as optional and no longer presents a global environment switch as destructive moderation consent. `.env` was not read or modified.

Verification:
- PASS: targeted AI provider and Security Assistant regressions — 43/43.
- PASS: full `npm test` — 295/295; 0 FAIL, 0 SKIPPED.
- PASS: `git diff --check`.
- PASS: `node --check` — all 21 changed JavaScript source/test files; 0 syntax errors.
- SKIPPED: live provider catalogue/request, Discord Gateway, real channel permission evaluation, message deletion, and timeout.
- BLOCKED: live operation still requires provider keys, configured Discord application/Gateway, an authorized test guild, and persistent hosting storage for guild policies/audit logs.

Operational Status:
- AI Chat remains tested but is not declared live-operational.
- Security Assistant automatically observes in alert-only mode; destructive actions require explicit per-guild administrator confirmation and have not been tested live.
- No commit, push, deployment, credential read, or credential change was performed.

==================================================
PHASE — VOICE GREETER HELP CENTER AND MORI AUDIT
==================================================
Date: 2026-11-06
Status: HELP CENTER COMPLETE AND TESTED; MORI DOWNLOADER BLOCKED
Files Created:
- src/dashboard/voice-greeter-help-center.js
- test/voice-ai/help-center.test.js
- docs/MORI_MEDIA_DOWNLOADER.md
Files Changed:
- src/voice-ai/greeter.js (backup: src/voice-ai/greeter.js.castorice-20261106-235224.bak)
- src/events/interactionCreate.js (backup: src/events/interactionCreate.js.castorice-20261106-235224.bak)
- test/voice-ai/greeter.test.js (backup: test/voice-ai/greeter.test.js.castorice-20261106-235224.bak)
- test/integration/voice-greeter-dashboard-routing.test.js
- docs/MASTER_DEVELOPMENT_ROADMAP.md (backup: docs/MASTER_DEVELOPMENT_ROADMAP.md.castorice-20261106-235224.bak)
- docs/DEVELOPMENT_HISTORY.md (backup: docs/DEVELOPMENT_HISTORY.md.castorice-20261106-235224.bak)
Implementation:
- Added a tutorial-only Help Center embed and navigation to the existing Voice Greeter message. Page changes update that same message; no duplicate greeting or server action controls are created.
- Kept the default greeting sentence and mention-safety behavior unchanged. If Help Center panel construction fails, the greeter logs the failure and continues sending the greeting.
- Added tutorials for existing bot features and explicitly states that a social-media downloader is not currently operational.
- Audited Mori's official v4.5.2 release materials. The CLI package manifest identifies `@coflyn/mori@1.2.0` under GPL-3.0-or-later while Castorice remains ISC. The release README and CLI source differ in advertised platform counts/options. Mori documents remote scraper engines and OTA patches; required Castorice DNS/redirect/resource controls and reliable Discord delivery contract were not established.
- Did not install, execute, or add Mori; did not change Castorice's license. Integration is blocked pending license review and a verifiable network/output security design.
Tests Executed:
- PASS: targeted Voice Greeter tests — 4/4.
- PASS: full `npm test` — 299/299; 0 FAIL, 0 SKIPPED.
- PASS: `node --check` — all 6 changed JavaScript source/test files.
- PASS: `git diff --check`.
- SKIPPED: Mori installation/execution and real media download; Discord Gateway, greeting delivery, TTS, attachment delivery, and Linux/Render testing.
Operational Status:
- The Voice Greeter Help Center passed mock-based regression tests; Discord Gateway behavior has not been live-tested.
- Mori Downloader remains BLOCKED and is not exposed as an operational Castorice feature. No live provider, Discord, or hosting behavior is claimed.

Backup follow-up:
- The pre-change `test/integration/voice-greeter-dashboard-routing.test.js` was not modified at the start of this milestone and was therefore absent from the initial backup set. Its original `HEAD` version was subsequently saved as `test/integration/voice-greeter-dashboard-routing.test.js.castorice-20261106-235224.bak`; all six scoped backup files were verified present.

==================================================
PHASE 23 — MUSIC URL SSRF GUARDRAILS
==================================================
Date: 2026-11-07
Status: PARTIALLY MITIGATED; FULL SSRF GUARANTEE BLOCKED

Root Cause:
- Queue validation checked only selected hostname and IPv4/IPv6 text patterns. It did not resolve DNS, check all A/AAAA answers, or bind yt-dlp connections to a validated address; bracketed IPv6 literals were not classified correctly.
- Metadata resolution, search, playback, radio playback, and the fixed Radio Browser discovery request used separate network paths. yt-dlp could independently resolve extractor, redirect, and media URLs.

Files Created:
- src/music/url-security.js
- src/music/yt-dlp-egress-proxy.js
- src/music/secure-http.js
- src/music/track-resolver.js
- test/music/url-security.test.js
- test/music/yt-dlp-egress-proxy.test.js
- test/music/secure-http.test.js
- test/music/track-resolver.test.js
Files Changed:
- src/music/manager.js
- src/music/radio-stream-proxy.js
- src/music/radio-discovery.js
- test/music/track-startup.test.js
- test/music/queue-lifecycle.test.js
- docs/DEVELOPMENT_HISTORY.md
- docs/MASTER_DEVELOPMENT_ROADMAP.md
Timestamped Backups Created Before Editing:
- src/music/manager.js.castorice-ssrf-20261107-091800.bak
- src/music/radio-stream-proxy.js.castorice-ssrf-20261107-091800.bak
- src/music/radio-discovery.js.castorice-ssrf-20261107-091800.bak
- test/music/track-startup.test.js.castorice-ssrf-20261107-091800.bak
- test/music/radio-stream-proxy.test.js.castorice-ssrf-20261107-092520.bak
- test/music/radio-discovery.test.js.castorice-ssrf-20261107-092520.bak
- test/music/queue-lifecycle.test.js.castorice-ssrf-20261107-101443.bak
- docs/DEVELOPMENT_HISTORY.md.castorice-ssrf-20261107-091800.bak
- docs/MASTER_DEVELOPMENT_ROADMAP.md.castorice-ssrf-20261107-091800.bak

Implementation:
- Added one shared Music input validator for HTTP/HTTPS, credentials, local names, IP literals, and DNS answers. It rejects non-global IPv4/IPv6, IPv4-mapped IPv6, loopback, private, link-local, multicast, unspecified, transition, and reserved ranges. Every DNS answer must be public; DNS failure and timeout fail closed.
- The Music Manager validates queue input, autoplay recommendations, and track startup. Manual/Dashboard/AI queue actions and playlist queueing converge on addToQueue; search results are URL-parsed before being exposed.
- yt-dlp metadata, search, and playback now use one secured spawn helper with argument arrays, a per-process loopback HTTP proxy, `--proxy`, empty `NO_PROXY`, a bounded socket timeout, and the native downloader. Metadata/search have bounded runtime and output; process/session cleanup closes their proxy and stops child processes.
- The proxy resolves each HTTP request and HTTPS CONNECT target, rejects a mixed public/private DNS result, and connects directly to a selected validated IP. HTTP redirect targets are checked before being returned to yt-dlp and observable HTTP redirect responses are capped at 10. A later connection/CONNECT is independently resolved and pinned.
- Radio Stream Proxy now uses the same address classifier and checks both A and AAAA results before pinning its supported public IPv4 target. Radio Browser discovery uses pinned DNS and rejects redirects. FFmpeg continues to receive yt-dlp stdout or the Radio Stream Proxy loopback URL, never a user-supplied station URL.
- Search by song name, playback, queue, next/previous, pause/resume, autoplay, radio relay, and existing FFmpeg processing remain wired.

Verification:
- Targeted Music SSRF, URL routing, proxy, resolver, Radio, queue, and playback tests: 61/61 PASS.
- Full `npm test`: 326 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: all 13 changed Music JavaScript source/test files PASS.
- `git diff --check`: PASS; Git reported only existing LF/CRLF conversion warnings.
- All network fixtures were mocked or loopback-only. No external address, provider, Discord Gateway, or live playback was tested.

Remaining Blockers:
- HTTPS CONNECT is an opaque TLS tunnel. The proxy validates and pins each HTTPS destination connection, so a redirect to a new private hostname/IP is rejected, but the proxy cannot inspect or count same-tunnel HTTPS redirect responses. yt-dlp's internal redirect bound was not independently verified or configured by this change.
- The proxy is mandatory in Castorice's yt-dlp launch arguments/environment, but this application does not impose an OS-level egress sandbox against a future extractor/helper that ignores proxy settings or uses a non-HTTP protocol. This bypass-resistance and complete HTTPS redirect bound remain BLOCKED pending a verified yt-dlp network handler or process-level egress policy.
- Therefore this phase does not declare the entire arbitrary-URL yt-dlp path fully SSRF-safe. No live testing is claimed.

==================================================
PHASE 24 — FAIL-CLOSED MUSIC DOWNLOADER GATE
==================================================
Date: 2026-11-07
Status: BLOCKED — yt-dlp FEATURES DISABLED PENDING VERIFIED EGRESS ISOLATION

Final Audit:
- yt-dlp uses HTTP handlers for extraction, but HTTPS CONNECT only exposes the tunnel destination to Castorice's proxy, not encrypted redirect responses. Whether every cross-host redirect opens a newly validated/pinned CONNECT, whether any redirects reuse a TLS connection, and whether every extractor/helper honors the proxy were not proven for this deployed binary and its helpers.
- Proxy environment variables and yt-dlp's `--proxy` option are application settings, not Windows Firewall/WFP or Linux/Render default-deny egress controls. A downloader/helper may use another transport or connect directly; this repository does not establish process-tree isolation on either platform.
- Since redirect destination validation, DNS pinning for every transport, and process-wide egress enforcement cannot be demonstrated, do not claim arbitrary yt-dlp URL playback is safe.

Fail-Closed Mitigation:
- The shared yt-dlp launcher now always throws before opening a proxy or spawning any process. Manager queue insertion, track startup, search, autoplay, and metadata resolution surface that disabled state rather than returning success-shaped empty metadata/search results.
- This intentionally disables all yt-dlp-backed external URL processing and name-based search, including new queue items and autoplay. Search input normalization remains tested, but name search is not operational until a verifiable network isolation mechanism is available.
- Radio remains on its separate validated/pinned Radio Stream Proxy route; FFmpeg receives only that relay's loopback URL. Radio discovery and playback tests still pass. No claim is made that FFmpeg or the wider host has OS-level egress isolation.

Final Verification:
- Targeted Music module tests: 75 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 322 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: all 9 changed JavaScript source/test files PASS.
- `git diff --check`: PASS; only Git's existing LF/CRLF conversion warnings were reported.
- Tests use mocks/fixtures and loopback-only resources; no external penetration test, provider request, real media playback, Windows firewall test, or Linux/Render deployment test was run.

## 2026-11-07 - AI Chat recovery and natural-intent isolation

Audit findings:
- AI Chat is implemented but opt-in per server and disabled by default. An API key alone does not enable the feature or prove that model discovery, provider authentication, network access, and response parsing work.
- Provider-manager environment validation ran synchronously during event-handler registration. Invalid AI configuration could throw before message and interaction listeners were registered, affecting unrelated bot features.
- Feature routers already run before the general AI fallback, but the existing global intent resolver was not used by the production message handler. Recognized unsupported requests, including Auto Kick/manual kick, could therefore reach general AI conversation instead of receiving an honest unavailable response.
- Provider errors had limited user-facing classification. Provider handling and Discord reply handling shared a try/catch, so a failed Discord reply could be misreported as a provider failure and trigger another reply attempt.

Changes:
- `src/events/interactionCreate.js` now catches invalid provider configuration without preventing listener registration, logs only a fixed safe error code, and reports the configuration failure when AI Chat is requested.
- The production message path now uses the existing `resolveIntent` after existing feature routers. AI Chat's per-server feature guard is consulted only for general conversation; recognized but unsupported actions are explicitly unavailable and do not fall back to AI.
- Auto Kick and manual-kick natural-language requests never execute a kick. The response states that no member was removed and that a guarded, confirmed, permission-checked workflow is required. Auto Disconnect, Trusted Member, and Social Downloader requests without active handlers also fail closed.
- Provider/model failures receive safe categorized responses. Empty provider output is rejected. Discord reply failures are isolated and log only fixed codes; raw provider/Discord errors and credentials are not logged.
- Added `test/integration/ai-feature-isolation-routing.test.js` for trigger formats, AI opt-in, provider/configuration errors, malformed replies, feature isolation, and non-execution of kick intents. Existing provider, model-discovery, trigger, security, and router tests were retained.

Verification:
- Focused AI/provider/trigger/security tests: 57 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 338 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: both JavaScript files changed in this task passed.
- `git diff --check`: PASS; Git reported existing LF/CRLF conversion warnings in the working copy.
- Tests use mocks and test-only values. Dotenv loading was disabled by a temporary test preload; no `.env` file was opened, read, copied, or modified. No live provider/Discord verification was performed.
- Timestamped backups were retained for `src/events/interactionCreate.js`, `docs/DEVELOPMENT_HISTORY.md`, and `docs/MASTER_DEVELOPMENT_ROADMAP.md` (`.castorice-ai-router-20261107-131500.bak` suffix).
- Auto Kick, Auto Disconnect, Trusted Member management, and Social Downloader remain unavailable through this message handler. AI Chat remains disabled by default and requires per-server opt-in. No commit, push, deploy, or remote change was performed.

Platform and Residual Status:
- HTTPS redirect protection for yt-dlp: BLOCKED; downloader launches are disabled, but TLS redirect behavior is not independently proven.
- yt-dlp DNS pinning and subprocess/helper isolation: BLOCKED; no yt-dlp network connection is permitted by the application, and no OS-level egress boundary is configured.
- Windows development and Linux/Render deployment egress isolation: BLOCKED pending host/deployment-level default-deny policies and verification.
- Radio's pinned relay remains available and regression-tested; other Music downloader/search/playback features remain unavailable until the security gate is resolved.

==================================================
PHASE 25 — SETTINGS CENTER PLACEHOLDER ACTIONS
==================================================
Date: 2026-11-07
Status: COMPLETE FOR AVAILABLE ACTIONS; RATE/SUGGESTION/BUG REPORT BACKENDS BLOCKED

Initial Audit:
- Settings Center already rendered four buttons with the custom IDs `castorice:settings_tutor`, `castorice:settings_rate`, `castorice:settings_suggestion`, and `castorice:settings_report`, but the production `InteractionCreate` button handler had no matching branches. Clicking them reached no acknowledgement/action.
- An informational Voice Greeter Help Center with topic navigation already existed, but Settings Tutor was not connected to it.
- No bot rating service, suggestion intake/storage service, or bug-report intake/storage service was found in the inspected application paths. The controls did not have a safe backend to invoke.
- Existing `extractTrigger` recognizes direct bot mentions and leading `Castorice:` / comma / name triggers; the current message handler already routes recognized feature actions before conversational AI fallback. No second message router was added.

Implementation:
- Added stable shared Settings action-ID constants and registered handling for all four existing buttons. Tutor opens the existing Help Center in the same Dashboard message; the Help Center can return to Settings, whose existing Dashboard button is preserved.
- Rate Bot, Suggestion, and Report Bug now receive an ephemeral, explicit “not available” response. No rating, submission, report, or successful persistence is claimed. No input form was introduced because no backend exists to validate or store submissions.
- Extended the existing `MessageCreate` trigger path for Tutor/Rate/Suggestion/Report Bug phrasing. Mention, `Castorice:`, `Castorice,`, and natural-name triggers are covered; unavailable requests are answered deterministically instead of being sent to conversational AI as if the action had occurred. Existing unrelated AI Chat intent routing remains covered by regression tests.
- These informational/unavailable actions require no administrative permission and perform no server mutation. Any future data-collecting backend must define validation, spam controls, storage, permissions, and failure semantics before its UI is enabled.

Files Changed:
- `src/dashboard/menu-panel.js`
- `src/dashboard/voice-greeter-help-center.js`
- `src/events/interactionCreate.js`
- `test/dashboard/settings-center-panel.test.js`
- `test/integration/settings-center-routing.test.js`
- `docs/DEVELOPMENT_HISTORY.md`
- `docs/MASTER_DEVELOPMENT_ROADMAP.md`

Timestamped Backups Created Before Editing:
- `src/dashboard/menu-panel.js.castorice-settings-20261107-122900.bak`
- `src/events/interactionCreate.js.castorice-settings-20261107-122900.bak`
- `src/dashboard/voice-greeter-help-center.js.castorice-settings-20261107-122900.bak`
- `docs/DEVELOPMENT_HISTORY.md.castorice-settings-20261107-122900.bak`
- `docs/MASTER_DEVELOPMENT_ROADMAP.md.castorice-settings-20261107-122900.bak`

Verification:
- Focused Settings Center, Help Center, and AI Chat routing tests: 12 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 329 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: all 5 changed JavaScript source/test files PASS.
- `git diff --check`: PASS; only existing LF/CRLF conversion warnings were reported.
- Tests use mocks; no Discord Gateway or live service was exercised. The test process was configured to use a nonexistent dotenv path and dummy test-only Discord identifiers; `.env` was not opened or loaded for the final test runs.

Remaining Work:
- Tutor is connected to the existing informational Help Center.
- Rate Bot, Suggestion, and Report Bug remain unavailable until real, permission-appropriate services and storage are designed and tested. Their UI currently reports this explicitly and does not accept or persist user-submitted data.
- No Graceful Shutdown or Persistent Storage work was included in this phase.
- No commit, push, deploy, or remote change was performed.

Environment handling clarification:
- An early preliminary focused test command invoked the repository's existing dotenv loader automatically; its output reported 10 injected variables but displayed no values. The file was not manually opened or modified. All final focused/full test runs redirected dotenv to a nonexistent path and used dummy test-only Discord identifiers.

==================================================
COMBINED SETTINGS, ACCESS CONTROL, AND MULTI-PROVIDER AI
==================================================
Date: 2026-11-07
Status: IMPLEMENTED (MOCK-VERIFIED; NOT LIVE)

Root Cause and Dashboard:
- `/menu` built its main navigation only from the `dashboardFeatures` list, which omitted Settings (and the requested AI and Voice navigation entries). Added these entries to the existing dashboard rather than creating a second Settings implementation.
- Settings opens the existing Settings Center, and Dashboard/back navigation stays in the same message. Music, AI, Translator, Voice Manager, Playlists, and Settings are retained without duplicate IDs or exceeding Discord component limits.

Access Control:
- Global AI defaults OFF and is controlled only by the configured bot owner. Global state, provider priority, and failover preference are persisted in `data/global-ai-settings.json`; this file stores no credentials.
- Server AI Chat defaults to its existing per-guild opt-in (OFF). Manage Server administrators may enable it only while global AI is enabled. Backend handlers re-check owner/admin identity and guild scope; ordinary members cannot change either setting.
- Members may use AI Chat only when global AI and that guild's AI Chat are both enabled. Other ordinary features retain their own feature and permission guards.
- Provider status is shown without credentials and explicitly is not evidence of live connectivity.

Providers and Failover:
- OpenAI-compatible (OpenAI), Gemini, and OpenRouter adapters retain their existing environment-based credentials and model overrides. Model discovery and response/error handling were tested with mocks; no live provider request was made.
- Owner-controlled priority and failover settings are persisted. Failover is limited to temporary rate-limit, timeout, and provider-unavailable errors. Authentication, quota, and incompatible-model errors do not trigger failover. Provider errors returned by the manager are sanitized; health/usage state and cooldown behavior remain available.
- OpenAI: adapter/model discovery/error paths MOCK-TESTED; live authentication/model access NOT VERIFIED.
- Gemini: adapter/model discovery/error paths MOCK-TESTED; live authentication/model access NOT VERIFIED.
- OpenRouter: OpenAI-compatible adapter/model discovery/error paths MOCK-TESTED; live authentication/model access NOT VERIFIED.

Files Added or Changed for This Implementation:
- Added: `src/ai/global-settings.js`, `test/ai/global-settings.test.js`, `test/dashboard/dashboard-navigation.test.js`, `test/integration/ai-global-settings-routing.test.js`.
- Changed: `src/ai/provider-manager.js`, `src/ai/openai-compatible-provider.js`, `src/ai/gemini-provider.js`, `src/ai/provider-settings.js`, `src/dashboard/menu-panel.js`, `src/events/interactionCreate.js`, `docs/AI_CHAT.md`.
- Updated related regression coverage: `test/ai/provider-manager.test.js`, `test/ai/openai-compatible-provider.test.js`, `test/ai/gemini-provider.test.js`, `test/integration/ai-provider-settings-routing.test.js`, `test/integration/ai-chat-routing.test.js`, `test/integration/ai-feature-isolation-routing.test.js`, `test/integration/voice-ai-routing.test.js`, `test/dashboard/translator-panel.test.js`, `test/dashboard/voice-manager-link.test.js`.

Verification:
- Focused dashboard/settings/provider/AI routing suite: 58 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 351 PASS, 0 FAIL, 0 SKIPPED. A transient Windows file-rename failure occurred once in a full run; the affected Voice AI test passed alone and the repeated full suite passed.
- `node --check`: 54 changed JavaScript files PASS.
- `git diff --check`: PASS; Git reported only existing LF/CRLF conversion warnings.
- Model discovery and provider behavior are MOCK-VERIFIED only. Discord Gateway and live provider connectivity were not tested; production readiness is not claimed.

Backups and Restrictions:
- Timestamped backups were retained with suffix `.castorice-settings-ai-20261107-135200.bak` for pre-existing implementation/documentation files, and `.castorice-settings-ai-20261107-140753.bak` for the two existing dashboard tests updated after full-suite review. Newly added files did not need backups.
- `.env` was not opened, read, copied, or modified. Tests used a preload that disables dotenv loading and test-only identifiers; no production credential was used.
- No commit, push, deployment, remote change, or unrelated feature work was performed.

Remaining Verification:
- Live OpenAI, Gemini, and OpenRouter authentication/model access requires separately authorized staging credentials and was not performed.
- Live Discord interaction, permissions, and message lifecycle require staging verification. Mock tests do not establish production connectivity.

==================================================
AI PROVIDER DIAGNOSTICS AND VOICE GREETER PERMISSIONS
==================================================
Date: 2026-11-07
Status: IMPLEMENTED (MOCK-VERIFIED; LIVE PROVIDERS NOT VERIFIED)

AI Provider Diagnosis:
- The previous `[AI Chat Error] provider_error` line was emitted only after the provider adapter and manager had reduced an error to a category. The OpenAI-compatible classifier returns `provider_error` for HTTP 400/422 responses that do not match a more specific safe category (and for other unclassified completion responses). The manager then removed provider identity and HTTP status, and the AI Chat handler logged only the category.
- The original runtime line therefore does not identify which provider or HTTP response caused the incident; the exact upstream root cause cannot be determined from that log alone.
- The current local process environment was checked by variable-presence booleans only: `AI_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY` were absent. This is not a check of deployed runtime configuration. No provider request was made.
- OpenAI, Gemini, and OpenRouter retain their existing environment variable names, provider endpoints, optional model overrides, request formats, bounded timeouts, response validation, and error classification. Invalid initialization of one provider no longer prevents other configured adapters from initializing; invalid shared timeout/order/failover settings use safe defaults and produce sanitized configuration diagnostics.

Diagnostics and Failover:
- Provider errors now carry safe operation and HTTP status metadata where available. Manager diagnostics include provider ID, operation, status, category, whether failover was attempted, and whether it succeeded.
- Diagnostics contain only fixed identifiers/numeric status/category fields; they never include request/response bodies, headers, tokens, API key values, or raw provider errors. Discord responses remain mapped to safe user-facing messages.
- Existing failover remains limited to eligible transient failures; invalid credentials, quota, and incompatible model errors do not trigger failover. Mock coverage verifies fallback success and sanitized all-provider failure behavior.
- OpenAI: adapter error categorization/metadata tested with mocks; no live authentication/model test.
- Gemini: adapter error categorization/metadata tested with mocks; no live authentication/model test.
- OpenRouter: OpenAI-compatible API-key/model/response handling and its fixed endpoint tested with mocks; no live authentication/model test.

Voice Greeter:
- The greeter now rejects non-text-capable channels and checks the bot member's `ViewChannel` and `SendMessages` permissions before sending. Missing either permission or an unavailable permission snapshot skips the greeting and emits a concise deduplicated warning.
- If `EmbedLinks` is missing, the greeter sends the existing text greeting and Help Center components without embeds. A Discord 50013 permission race is handled without logging raw error details or disrupting other listener work; failed sends do not claim success and the cooldown is rolled back.
- No server/channel permissions are changed automatically. Server configuration must grant the bot View Channel and Send Messages for greetings; Embed Links enables the full embedded Help Center.

Files Changed:
- `src/ai/provider-manager.js`
- `src/ai/openai-compatible-provider.js`
- `src/ai/gemini-provider.js`
- `src/events/interactionCreate.js`
- `src/voice-ai/greeter.js`
- `test/ai/provider-manager.test.js`
- `test/ai/openai-compatible-provider.test.js`
- `test/ai/gemini-provider.test.js`
- `test/integration/ai-feature-isolation-routing.test.js`
- `test/voice-ai/greeter.test.js`
- `test/voice-ai/greeter-config.test.js`
- `docs/DEVELOPMENT_HISTORY.md`
- `docs/MASTER_DEVELOPMENT_ROADMAP.md`

Verification:
- Focused provider diagnostics, provider adapters, AI error routing, and Voice Greeter tests: 42 PASS, 0 FAIL, 0 SKIPPED; the separate Voice Greeter configuration regression test: 1 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 360 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: 55 changed JavaScript files PASS.
- `git diff --check`: PASS; only existing LF/CRLF conversion warnings were reported.
- Tests use mocks/fixtures. No OpenAI, Gemini, OpenRouter, Discord API, or live guild permission request was made.

Backups and Restrictions:
- Timestamped backups were created and retained for all pre-existing edited files before edits using suffix `.castorice-provider-greeter-20261107-165200.bak`, including both documentation files and `test/voice-ai/greeter-config.test.js`.
- `.env` was not opened, read, copied, printed, or modified. Automated tests used a preload that disables dotenv loading and test-only identifiers; no production credential was used.
- No commit, push, deployment, remote change, or server permission change occurred.

Remaining Work:
- Obtain sanitized diagnostics from the actual deployed runtime after this change to identify any specific provider/model/account cause. Live provider connectivity remains unverified.
- In the Discord server/channel, grant View Channel and Send Messages to the bot; grant Embed Links for the full Help Center embed. These permissions must be configured by a server administrator.

## Auto Kick Voice, Trusted Members, and Voice Disconnect Timer — 2026-11-07

Status: IMPLEMENTED (MOCK-VERIFIED; NOT LIVE)

Root Cause and Audit:
- The natural intent router recognized legacy Auto Disconnect and Trusted Member phrases, but the active MessageCreate handler explicitly reported those intents as unavailable. No trusted-member enforcement service, disconnect timer lifecycle, or Voice AI Center Dashboard panel was wired into startup.
- The existing Voice Manager and natural-trigger pipeline were retained. Voice Center actions are routed before conversational AI fallback, so they do not depend on AI Chat being enabled.

Implementation:
- Added one guild-scoped Voice Center service backed by `JsonGuildStore`. Auto Kick Voice defaults OFF; no member is implicitly trusted, and enforcement applies only to explicitly protected voice channels.
- Trusted member IDs, trusted role IDs, Auto Kick exemption roles, protected channels, grace period, timer metadata, and bounded activity history are isolated by guild.
- A non-trusted member is disconnected from voice only (never server-kicked or banned) after the configured grace period. The service re-fetches membership and configuration before acting, cancels stale joins/moves, honors trusted members/roles and configured owner/admin/role exceptions, and verifies channel-scoped `Move Members` permission before calling `GuildMember.voice.disconnect()`.
- The owner or a Manage Server administrator controls settings. Dashboard mutations and AI Tag mutations re-check authorization on the backend; cross-guild IDs and non-voice channels are rejected.
- Voice timers support set/show/cancel/reset/extend, are keyed by guild and current session identity, and use the existing Music Manager destruction lifecycle when the timed session is music. Persisted timer metadata is cleared on startup rather than risking a stale timer disconnecting a new session. Leaving or changing the timed channel clears the timer.
- The Dashboard now links to Voice AI Center with Auto Kick status/toggle, grace period, Trusted Members/roles, exemption roles and admin/owner toggles, protected channels, timer controls, active session, activity log pagination, confirmation, and back navigation. Member views are read-only.
- Natural trigger routes support `@Castorice`, `Castorice:`, and `Castorice,` forms for Auto Kick Voice, grace period, trusted member/role actions, protected channels, and voice disconnect timer actions, including legacy Auto Disconnect phrases. Ambiguous member/role/channel targets are rejected instead of guessed.

Files Added or Changed:
- Added: `src/voice-ai/center-service.js`, `src/voice-ai/center-events.js`, `src/voice-ai/center-tag-router.js`, `src/voice-ai/center-interactions.js`.
- Changed: `src/main.js`, `src/events/interactionCreate.js`, `src/dashboard/menu-panel.js`.
- Tests added: `test/voice-ai/center-service.test.js`, `test/voice-ai/center-events.test.js`, `test/voice-ai/center-routing-dashboard.test.js`.
- Documentation appended: `docs/DEVELOPMENT_HISTORY.md`, `docs/MASTER_DEVELOPMENT_ROADMAP.md`, and `docs/VOICE_AI.md`.

Verification:
- Focused Voice Center and existing Voice Manager dashboard-link tests: 20 PASS, 0 FAIL, 0 SKIPPED.
- Full `npm test`: 379 PASS, 0 FAIL, 0 SKIPPED.
- `node --check`: all 10 changed JavaScript source/test files PASS.
- `git diff --check`: PASS; Git reported existing LF/CRLF conversion warnings only.
- All Voice Center cases use mocks/fixtures. No live Discord Gateway, permission, voice disconnect, or deployment test was performed.

Backups and Remaining Gates:
- Timestamped backups were retained: `src/main.js.castorice-voice-center-20261107-170928.bak`, `src/events/interactionCreate.js.castorice-voice-center-20261107-170928.bak`, `src/dashboard/menu-panel.js.castorice-voice-center-20261107-170928.bak`, `docs/DEVELOPMENT_HISTORY.md.castorice-voice-center-20261107-170928.bak`, `docs/MASTER_DEVELOPMENT_ROADMAP.md.castorice-voice-center-20261107-170928.bak`, and `docs/VOICE_AI.md.castorice-voice-center-20261107-171922.bak`.
- Production use still requires a server administrator to grant the bot `Move Members` on each protected channel and verify the feature in a staging guild. Dashboard, Discord permissions, and real disconnect lifecycle are not live-verified.
- `.env` was not manually opened, printed, copied, or modified. One early focused test invocation triggered the repository's existing dotenv bootstrap automatically and reported only an injected-variable count (no values); all subsequent focused/full test runs disabled dotenv loading and used test-only identifiers.
- No commit, push, deployment, remote change, or server permission change occurred.

## Voice Manager Natural-Language and Channel Creation — 2026-11-07

| Area | Result |
|---|---|
| Voice-channel creation | Added a separate `createVoiceChannel()` operation to the existing Voice Manager service. It creates a regular voice channel without moving the requester or adding temporary-voice state, validates guild/member/name/category/privacy/user-limit scope, checks bot `Manage Channels`, and uses bounded request-key deduplication. The legacy temporary-voice path remains unchanged. |
| AI Tag routing | Expanded deterministic creation phrases for voice channel/room/VC requests, including Indonesian and English forms. Missing names prompt the requester and accept a bounded same-channel follow-up; ambiguous or unavailable categories are rejected rather than guessed. Trusted-member routing now accepts additional list/add/remove/check phrasing and explicit user mentions without inferring an unmentioned target. |
| Dashboard | The existing Voice Manager panel now offers regular channel creation. It supports guild category selection, a bounded modal for name/privacy/member limit, a preview, requester- and guild-bound confirmation, and an ephemeral cancellation path. Existing temporary voice controls and dashboard navigation remain available. |
| Verification | Focused Voice Manager, Voice Center, Dashboard, and AI Tag routing tests: 34 PASS, 0 FAIL, 0 SKIPPED. Full `npm test`: 390 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 9 changed JavaScript files PASS. `git diff --check`: PASS; only existing LF/CRLF conversion warnings were reported. Tests used mocks/fixtures and test-only environment values; no live Discord Gateway or channel creation was performed. |
| Backups / remaining gate | Timestamped backups with suffix `.castorice-natural-voice-20261107-173900.bak` were retained for the Voice Manager/router/interaction source, relevant tests, and docs. Real Discord creation still requires the bot to have `Manage Channels`; staging-guild verification is outstanding. `.env` was not opened or modified. No commit, push, deployment, or remote change occurred. |

## Public Multilingual AI Chat and Voice Natural Phrasing — 2026-11-07

| Area | Result |
|---|---|
| Public AI chat | AI responses continue as public replies in the invoking channel. Context now keys by guild and channel when a channel ID is available, so members can follow up on the same public conversation and different channels/guilds remain isolated. Per-member cooldown remains independent within a shared channel; concurrent provider work remains bounded to one request per conversation. Reset now clears that channel's shared history. |
| Multilingual behavior | The existing provider abstraction receives a system prompt to understand Indonesian, English, slang, abbreviations, and code-switching, and to answer in the latest member language/tone. The bot sends a typing indicator before provider work when supported. This is prompt behavior tested with mocks, not live model language-quality verification or a separate language detector. |
| Voice natural language | Expanded deterministic Indonesian/English create requests (including polite/need/another/new-room forms), name clarification instead of inferred names, bilingual rename/lock/unlock/delete/transfer patterns, and common number words for room limits. Mentioned transfer targets are resolved from Discord user mentions; backend ownership/guild checks remain in force. |
| Remaining scope | This does not add open-ended LLM intent classification, a dedicated language detector, or general co-reference resolution. Dynamic room hide/show, bitrate, per-room permission/trusted access, and member-disconnect controls remain unimplemented; existing create/rename/lock/limit/transfer/confirmed-delete operations are preserved. AI history is in-memory and public-channel reset affects all recent context for that guild/channel. |
| Verification | Focused AI/Voice suite: 50 PASS, 0 FAIL, 0 SKIPPED. Full `npm test`: 394 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 6 changed JavaScript files PASS. `git diff --check`: PASS with existing LF/CRLF conversion warnings. Provider and Discord behavior were mock-tested; no live provider call, Gateway test, or channel creation was run. |
| Backups / safety | Timestamped backups with suffix `.castorice-public-multilingual-20261107-175132.bak` were retained for the 10 source/test/documentation files selected before changes. `.env` was not opened or modified; test runs used a nonexistent dotenv path and dummy test-only Discord values. No commit, push, deployment, or remote change occurred. |

## AI Provider and Trusted-Member Privacy Follow-up — 2026-11-07

| Area | Result |
|---|---|
| Owner provider settings | Status, priority, and failover responses are sent to the owner's DM rather than the public AI conversation. If DMs are unavailable, the channel receives only a generic safe notice; diagnostics use a fixed sanitized warning. |
| Trusted member list | The Voice Center AI Tag sends member/role identities privately and disables mention parsing. If DMs are unavailable, it returns a generic notice without listing identities. |
| Verification | Focused AI/Voice suite: 55 PASS, 0 FAIL, 0 SKIPPED. Full `npm test`: 397 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 9 changed JavaScript files PASS. `git diff --check`: PASS; only existing LF/CRLF conversion warnings were reported. |
| Backups / safety | Backups retained with suffix `.castorice-public-multilingual-20261107-175132.bak`, including the provider routing test and pre-change snapshots of the Voice Center router/test. `.env` was not opened or modified; provider behavior was mock-tested only. No commit, push, or deployment occurred. |

## Gemini-Only AI Runtime — 2026-11-07

| Area | Result |
|---|---|
| Runtime provider | Replaced the multi-provider manager with a Gemini-only environment factory. AI Chat and Voice AI use the same `GeminiProvider`; OpenAI-compatible and OpenRouter settings, provider ordering, rotation, and cross-provider failover are not read or invoked by runtime. The legacy OpenAI-compatible adapter remains in the source tree for existing adapter tests/compatibility, but there are no runtime imports of it. Gemini uses the existing `GEMINI_API_KEY`, optional `GEMINI_MODEL`, and bounded `AI_TIMEOUT_MS` configuration. |
| AI responses | The conversation system prompt explicitly supports free-form questions and discussion in Indonesian, informal Indonesian/slang, English, and code-switching without treating every message as a server action. Existing intent routing, feature guards, permissions, and bounded guild/channel conversation context remain unchanged. |
| Errors and privacy | Gemini HTTP 400 maps to request/configuration error, 401/403 to authentication/access error, 429 to quota/rate-limit categories, and 5xx/timeouts to temporary unavailability. Discord receives an honest failure rather than a template answer. Logs contain only Gemini, operation, status, and safe category; provider response bodies and conversation contents are not logged. |
| UI and settings | Owner controls now expose only global AI availability and read-only Gemini configuration status. Runtime provider priority/failover controls were removed. Legacy priority/failover fields are ignored when read and removed from the persisted global settings file on its next write. `.env.example` now shows only Gemini AI configuration and timeout names. |
| Verification | Focused Gemini/AI/Voice/Settings regression suite: 50 PASS, 0 FAIL, 0 SKIPPED. Full `npm test`: 392 PASS, 0 FAIL, 0 SKIPPED. `node --check` passed for 20 changed JavaScript files. `git diff --check` passed with existing LF/CRLF conversion warnings. Results are mocked; no live Gemini API request was made, so authentication, entitlement, model access, quota, and response quality remain unverified. |
| Backups and safety | Timestamped `.castorice-gemini-only-20261107-1812.bak` backups were created for all modified pre-existing source, test, and documentation files. `.env` was not opened, read, copied, printed, or modified. No commit, push, deploy, or live API request occurred. |

## Runtime Lifecycle Cleanup — 2026-11-07

| Area | Result |
|---|---|
| Cleanup APIs | Wired the Voice Greeter disposer function, Voice Manager `dispose()`, Security Monitor `close()`, Voice Center events `dispose()`, and Music Manager `shutdown()` into one cleanup registry. Interaction handlers now return a disposer for their `InteractionCreate` and `MessageCreate` listeners. |
| Ordering and failure behavior | Cleanup runs once in reverse registration order; failures are reported with sanitized error metadata, collected, and do not prevent later cleanup handlers. The existing HTTP lifecycle still closes HTTP and destroys Discord after service cleanup. Startup initialization failures clean all handles registered so far before destroying the client. Voice Manager, Voice Center, and interaction-listener registration also roll back listeners if their own partial registration fails. |
| Verification | Focused runtime lifecycle tests: 13 PASS, 0 FAIL, 0 SKIPPED. Full `npm test`: 409 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 6 changed JavaScript files PASS. `git diff --check`: PASS; Git reported existing LF/CRLF conversion warnings. Tests used local servers and mocks; no live Discord or Render lifecycle was tested. |
| Safety | `.env` was not opened, read, printed, copied, or modified. No provider, yt-dlp, URL-security, or redirect-proxy configuration was changed. No backup was deleted; no staging, commit, push, or deployment occurred. |

## Render Free Web Service Readiness — 2026-11-07

| Area | Result |
|---|---|
| Startup and HTTP health | `npm start` runs `node index.js`, which loads `src/main.js`. The main module creates exactly one Discord `Client`; a built-in Node HTTP server starts listening on `0.0.0.0` and `process.env.PORT` (local default 3000) before awaiting Discord login. It logs the successfully bound host and port without environment values, and `GET /health` returns only `{"status":"ok"}` with HTTP 200; other paths/methods return 404. |
| Lifecycle | HTTP bind failure prevents Discord login; Discord login failure closes HTTP and destroys the client. SIGTERM/SIGINT close the HTTP server, clean tracked music/voice sessions and remaining voice connections, then destroy the Discord client idempotently. Cleanup failures set a failing exit code while still attempting remaining shutdown steps. This was verified with local mocks/test servers, not a Render instance or live Discord Gateway. |
| Filesystem data | Guild records in `data/storage/<guildId>/`, legacy settings in `data/guilds/<guildId>/`, and `data/global-ai-settings.json` are file-backed and ephemeral on Render Free; deploy/restart/instance replacement may lose them. Installed `pg` is not wired to these stores. AI conversation context is process-memory only. Persistent production data requires an explicit migration to a configured persistent store. |
| Linux/media compatibility | `yt-dlp` lookup now selects `bin/yt-dlp` on Linux and no longer falls back to a Windows `.exe`. The repository currently contains only `bin/yt-dlp.exe`, so Linux Music playback/metadata remain blocked until a Linux executable is supplied and made executable. `ffmpeg-static` and `zeromq` have platform/native install considerations not validated on Render Linux; Opus, ZeroMQ, and actual playback require a Linux build/runtime smoke test. Music is not claimed deployment-ready. |
| Verification | Render port report follow-up: source already invoked and awaited HTTP listen before Discord login, so its successful Discord login means HTTP listen should already have completed on that deployed revision; the provided logs alone do not prove why Render detected no port. Added a safe bound-address log and a regression test that fetches `/health` on the configured port while mocked Discord login remains pending. Focused HTTP/lifecycle suite: 15 PASS, 0 FAIL. Full `npm test`: 403 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 2 changed JavaScript files PASS. `git diff --check`: PASS with existing LF/CRLF conversion warnings. Local HTTP/mocked tests do not establish Render detection; no Discord/provider requests are made. |
| Remaining deployment gates | Configure required `DISCORD_TOKEN`, `CLIENT_ID`, and `OWNER_ID` as Render environment settings without committing values; decide persistent storage/database; supply and verify Linux media binaries/native dependencies; confirm Free Web Service sleep behavior is compatible with a continuously connected Discord bot. No deployment was performed. |
| Backups and safety | Existing `.render-free-20261107-1840.bak` and `.render-free-20261107-1918.bak` backups remain. This follow-up created `.render-port-20261107-2030.bak` backups before editing the health server, focused test, and these deployment docs. `.env` was not opened/read/copied/printed/modified. No commit, push, deployment, Discord permission change, or live request occurred. |

## yt-dlp Egress Proxy Redirect Isolation — 2026-11-07

| Area | Result |
|---|---|
| Redirect handling | Replaced the proxy-wide redirect counter with a counter scoped to each incoming HTTP request. The proxy now follows redirect hops internally, enforcing the per-request maximum even for loops and ensuring the counter cannot be reset by a caller issuing another hop as a new proxy request. |
| Network validation and cleanup | Every redirect URL is parsed and checked for protocol/downgrade rules; every redirect target is DNS-resolved, rejected if any answer is private/non-global, and pinned for the outbound request. Request errors remain sanitized; cancellation destroys the active upstream and response stream; active requests are removed on close. Redirects that require replaying a non-GET/HEAD request body are rejected. |
| Verification | Focused `test/music/yt-dlp-egress-proxy.test.js`: 11 PASS, 0 FAIL, 0 SKIPPED, including independent requests after redirects, a redirect loop, unsafe destinations, and cancellation cleanup. Full `npm test`: 412 PASS, 0 FAIL, 0 SKIPPED. `node --check`: 2 changed JavaScript files PASS. `git diff --check`: PASS with existing LF/CRLF conversion warnings. All proxy/network verification used local mocks; no live egress test was performed. |
| yt-dlp status and safety | `spawnSecuredYtDlp()` remains fail-closed and was not changed; yt-dlp playback/metadata remain disabled. `.env` was not opened, read, printed, copied, or modified. No backup was deleted and no staging, commit, push, or deployment occurred. |
