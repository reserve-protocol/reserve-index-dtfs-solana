#!/bin/bash

# go to root of workspace where the .git folder, in this case ./reserve-index-dtfs-solana
home() {
    cd "$(git rev-parse --show-toplevel)" || exit 1
}

home

# trap is called when Ctrl-C signal is received.
# it will kill all child processes
parent_pid="$$"
trap 'kill -- -$parent_pid' SIGINT SIGQUIT EXIT

# helper function to silence background processes,
# otherwise multiple processes will write to stdout
bkg() { "$@" >/dev/null & }

./download-programs.sh
./build-local.sh
killall solana-test-validator

agave-install init 2.1.13

bkg npx amman start --reset

# sleep for a bit to let the validator start
sleep 5

anchor test --skip-local-validator --skip-deploy --skip-build