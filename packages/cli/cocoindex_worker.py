"""Frozen entry point for Lamina's managed CocoIndex worker."""
import multiprocessing

from cocoindex.cli import cli

if __name__ == "__main__":
    # PyInstaller's Windows child processes re-enter this executable. Without
    # the frozen-process dispatch, CocoIndex workers can exit successfully
    # without ever reconciling their target states.
    multiprocessing.freeze_support()
    cli()
