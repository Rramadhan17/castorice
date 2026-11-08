# Mori Media Downloader audit

## Audit result

The Mori downloader is **BLOCKED from integration**. Castorice does not currently
provide an operational social-media download service. The legacy natural-language
intent parser is not evidence that downloads are implemented; the Voice Greeter
Help Center says this explicitly.

The official Mori `v4.5.2` tag identifies its CLI package as
`@coflyn/mori@1.2.0`, licensed `GPL-3.0-or-later`, with Node.js `>=18`. Castorice
is currently declared `ISC`. This audit is not legal advice: bundling or
redistributing Mori requires a license-compatibility review, and Castorice's
license must not be changed without the owner's explicit decision.

The release README and CLI source also advertise different platform counts and
options. The CLI documents unattended downloads (`-y`) and an output-directory
option, but the reviewed material does not establish a stable machine-readable
result contract for reliably delivering downloaded files through Discord.
Additionally, Mori documents remote scraper engines and OTA scraper patches.
Castorice cannot currently enforce its required per-redirect DNS/IP validation,
destination pinning, resource limits, and cleanup over all network requests made
by that downloader. These are integration assurance gaps, not a claim that Mori
has a confirmed vulnerability.

No Mori package was installed, invoked, or added to Castorice. No media was
downloaded. Do not expose a download command as operational until license,
network-security, output, resource-bound, and platform-support questions are
resolved and tested.

## Voice Greeter Help Center

The Voice Greeter now attaches a tutorial embed and navigation components to its
existing greeting message. Selecting a topic updates that same message; it does
not send a second greeting or expose server-action controls. The greeting text
and mention-safety behavior are unchanged. If panel construction fails, the
greeter logs the failure and still attempts to send the greeting without the
panel.

Tutorials cover the Greeter, Music/Radio, AI Chat, Voice AI, Voice Manager,
Translator, Server Templates, Security Assistant, `/menu`, and the unavailable
media downloader. They describe configuration and permission requirements
without claiming live provider or Discord Gateway operation.

## References

- [Mori v4.5.2 release](https://github.com/coflyn/Mori/releases/tag/v4.5.2)
- [Mori CLI package manifest at v4.5.2](https://raw.githubusercontent.com/coflyn/Mori/v4.5.2/cli/package.json)
- [Mori CLI README at v4.5.2](https://raw.githubusercontent.com/coflyn/Mori/v4.5.2/cli/README.md)
- [Mori CLI source at v4.5.2](https://raw.githubusercontent.com/coflyn/Mori/v4.5.2/cli/index.js)
- [Mori license at v4.5.2](https://raw.githubusercontent.com/coflyn/Mori/v4.5.2/LICENSE)
