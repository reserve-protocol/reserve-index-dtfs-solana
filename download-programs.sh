#!/bin/bash

PROGRAMS_DIR="tests-ts/programs"
mkdir -p "$PROGRAMS_DIR"

# Metaplex' Token Metadata Program
if [ ! -f "$PROGRAMS_DIR/metadata.so" ]; then
    solana program dump --url mainnet-beta metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$PROGRAMS_DIR/metadata.so"
fi

# Squad's Multisig Program
if [ ! -f "$PROGRAMS_DIR/squads.so" ]; then
    solana program dump --url mainnet-beta SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu "$PROGRAMS_DIR/squads.so"
fi