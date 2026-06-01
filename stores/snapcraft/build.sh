#!/usr/bin/env bash
# No-op stub for Aimux CI builds.
#
# The upstream VSCodium repo ships a snapcraft packaging script here, but Aimux
# only produces .deb + .tar.gz on the bare ubuntu-latest runner (snap packaging
# needs the snapcraft toolchain and is intentionally disabled).
#
# build/linux/prepare_assets.sh sources this file with `.` when CI_BUILD=no, so
# it MUST NOT call `exit` (that would terminate the parent shell). Just return.
echo "snapcraft build skipped (Aimux: .deb + .tar.gz only)"
