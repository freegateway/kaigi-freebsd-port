# Kaigi FreeBSD port maintenance

- This repository is the canonical FreeBSD port; application source belongs to
  https://github.com/freegateway/kaigi. Do not replay a MiroTalk patch stack.
- Preserve the user-designated canonical Makefile formatting, FreeBSD adaptations,
  dependency choices, installation paths, service names and Corresponding Source
  target. Kaigi and MiroTalk remain independently installable.
- Keep fixed application commits in GH_TAGNAME. Verify exact distfile bytes when
  changing pins; keep distinfo, dependency paths and fetch references consistent.
- Keep application manuals, configuration samples and the application fail2ban
  filter in the pinned application source. files/ owns service integration,
  log rotation, package messages and supplementary packing entries.
- Never refresh dependency versions merely to reorganize packaging. Native
  mediasoup comes from www/mediasoup; never download a prebuilt worker silently.
- Accumulate changes without regenerating archives or bumping PORTREVISION until
  explicitly requested. Use the FreeBSD Port Workflow for requested archives:
  kaigi-DISTVERSION_PORTREVISION.tar.gz with an identical sole top-level directory.
- Keep shell instructions suitable for FreeBSD /bin/sh. Give user-facing commands
  on one line. Never commit production credentials or local build output.
- Validate checksums, template substitution and packing entries. Report actual
  FreeBSD/Poudriere results separately from source and Linux checks.
