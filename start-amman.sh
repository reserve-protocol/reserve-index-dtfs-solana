#!/bin/bash

# Dump the programs first
solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/programs/metadata.so
solana program dump GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw tests/programs/governance.so
solana program dump SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf tests/programs/squads.so

# Build the program
anchor build -- --features dev

killall solana-test-validator

amman start