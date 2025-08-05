#!/bin/bash
# Solana Local Validator Script
echo "Starting Solana Test Validator..."
# Configuration variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAMS_REMOTE_DIR="$SCRIPT_DIR/tests-ts/programs"
LOCAL_PROGRAM_DIR="$SCRIPT_DIR/target/deploy"

solana-test-validator \
    --reset \
    --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$PROGRAMS_REMOTE_DIR/metadata.so" \
    --bpf-program HwXcHGabc19PxzYFVSfKvuaDSNpbLGL8fhVtkcTyEymj "$PROGRAMS_REMOTE_DIR/governance.so" \
    --bpf-program SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu "$PROGRAMS_REMOTE_DIR/squads.so" \
    --bpf-program RsHWkAsrWvntjhWgMT1uBLJJea9TSjDhsx8j3DHVDEv "$LOCAL_PROGRAM_DIR/folio_admin.so" \
    --bpf-program DTF4yDGBkXJ25Ech1JVQpfwVb1vqYW4RJs5SuGNWdDev "$LOCAL_PROGRAM_DIR/folio.so" \
    --bpf-program n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG "$LOCAL_PROGRAM_DIR/second_folio.so" \
    --bpf-program 7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf "$LOCAL_PROGRAM_DIR/rewards.so"
