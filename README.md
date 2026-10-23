# Kaigi FreeBSD port

This repository maintains the FreeBSD port for
[Kaigi](https://github.com/freegateway/kaigi), the FreeGateway Project’s
self-hosted video conferencing application.

The repository root is the port directory. It contains the Makefile, checked
source and dependency hashes, locked npm extraction rules, package messages,
service script, log rotation configuration and supplementary packing list.
Application code, configuration examples, administrator manuals and the
application-specific fail2ban filter belong to the Kaigi repository.

## Installation and testing

Copy this port into `www/kaigi` in your ports tree or Poudriere overlay, then
build and test `www/kaigi` using your usual Poudriere configuration. The port
requires `www/mediasoup` version 3.31.0 or newer and Node.js 24.

The service is `kaigi`; settings live in `/usr/local/etc/kaigi/kaigi.conf`.
Configure users, meeting permissions, TLS and media addresses before starting
it. See the installed `kaigi(8)`, `kaigi.conf(5)` and `kaigi-ldap.conf(5)` manuals.

## Source and dependencies

`GH_TAGNAME` selects an exact Kaigi commit. `distinfo` records the checksums and
sizes of its source archive and npm inputs. `npm-deps.mk` preserves the
application lockfile’s production dependency paths; mediasoup is provided by
the separate FreeBSD port. No npm lifecycle scripts run during packaging.

The initial import is based on `kaigi-0.1.0_2.tar.gz`, pinned to application
commit `4a4acc3d1f4e279543b90fe88a276f322d4e06da`. Its application and dependency
pins are unchanged. Manuals and configuration templates are read from that
pinned source rather than duplicated under `files/`. This works with the
current application pin as well as the proposed repository separation.

## Maintenance

Preserve the maintainer’s Makefile formatting and FreeBSD adaptations. Update
the application pin and checksums together, review dependency changes, and
validate the result in Poudriere. Application development and port revisions
are maintained separately; the port does not track a moving application branch.

Run `make corresponding-source` in the port directory to collect this port and
its checksummed inputs. Publish the result at the URL embedded in the package,
and include the matching mediasoup port and other required source and build
material for the deployed combination. A repository link alone does not
identify the complete Corresponding Source of a particular installation.

Application and bundled-component copyright and licence notices remain with
their source. This repository’s licence is in [LICENSE](LICENSE).
