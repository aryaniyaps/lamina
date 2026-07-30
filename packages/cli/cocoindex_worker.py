"""Frozen entry point for Lamina's managed CocoIndex worker."""
import multiprocessing
import sys

from cocoindex.cli import cli

if __name__ == "__main__":
    # PyInstaller's Windows child processes re-enter this executable. Without
    # the frozen-process dispatch, CocoIndex workers can exit successfully
    # without ever reconciling their target states.
    multiprocessing.freeze_support()
    if len(sys.argv) > 1 and sys.argv[1] == "retrieval":
        from retrieval_worker import main as retrieval_main

        raise SystemExit(retrieval_main(sys.argv[2:]))
    cli()
