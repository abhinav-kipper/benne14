#!/usr/bin/env bash
# Stop any Next.js server started from this machine (dev, start, or the e2e web servers).
# A script file on purpose: a one-line `pkill -f next` also matches, and kills, the shell running it.
for d in /proc/[0-9]*; do
  c=$({ tr '\0' ' ' <"$d/cmdline"; } 2>/dev/null)
  case "$c" in *next-server* | *"next start"* | *"next dev"*) kill "${d#/proc/}" 2>/dev/null ;; esac
done
exit 0
