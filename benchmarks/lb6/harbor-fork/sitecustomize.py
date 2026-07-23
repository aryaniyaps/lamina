"""Activate the LaminaBench fail-closed Harbor patch when explicitly requested."""

import os

if os.environ.get("LB6_HOST_SEAL") == "1":
    from lb6_harbor_patch import install

    install()
