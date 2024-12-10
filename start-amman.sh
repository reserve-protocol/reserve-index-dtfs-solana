#!/bin/bash

PROGRAMS_DIR="tests/programs"
mkdir -p "$PROGRAMS_DIR"

# Dump the programs first
if [ ! -f "$PROGRAMS_DIR/metadata.so" ]; then
    solana program dump --url mainnet-beta metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$PROGRAMS_DIR/metadata.so"
fi

if [ ! -f "$PROGRAMS_DIR/governance.so" ]; then
    solana program dump --url mainnet-beta GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw "$PROGRAMS_DIR/governance.so"
fi

if [ ! -f "$PROGRAMS_DIR/squads.so" ]; then
    solana program dump --url mainnet-beta SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu "$PROGRAMS_DIR/squads.so"
fi

# Build the program
anchor build -- --features dev

killall solana-test-validator

amman start