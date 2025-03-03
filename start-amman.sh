#!/bin/bash

./download-programs.sh
./build-local.sh

killall solana-test-validator

amman start --reset