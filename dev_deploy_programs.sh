#!/bin/bash

# Default values
DEFAULT_RPC_URL="http://localhost:8899"
DEFAULT_PROGRAM_AUTH_KEYPAIR="$HOME/.config/solana/folio-auth.json"
DEFAULT_PRIORITY_FEE_LAMPORTS_PER_CU=10000

# Initialize with defaults
RPC_URL="$DEFAULT_RPC_URL"
PROGRAM_AUTH_KEYPAIR="$DEFAULT_PROGRAM_AUTH_KEYPAIR"
PRIORITY_FEE_LAMPORTS_PER_CU=$DEFAULT_PRIORITY_FEE_LAMPORTS_PER_CU
FORCE=false

# Help function
show_help() {
  echo "Usage: $0 [OPTIONS]"
  echo "Deploy Solana programs for the Folio project."
  echo ""
  echo "Options:"
  echo "  --help                       Show this help message and exit"
  echo "  --force                      Force overwrite of existing buffer keypairs"
  echo "  --keypair PATH               Path to the program authority keypair (default: $DEFAULT_PROGRAM_AUTH_KEYPAIR)"
  echo "  --url URL                    RPC URL to use (default: $DEFAULT_RPC_URL)"
  echo "  --priority-fee LAMPORTS      Priority fee in lamports per compute unit (default: $DEFAULT_PRIORITY_FEE_LAMPORTS_PER_CU)"
  echo ""
  echo "Example:"
  echo "  $0 --force --keypair ~/.config/solana/my-keypair.json --url https://api.devnet.solana.com --priority-fee 5000"
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      show_help
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --keypair)
      PROGRAM_AUTH_KEYPAIR="$2"
      shift 2
      ;;
    --url)
      RPC_URL="$2"
      shift 2
      ;;
    --priority-fee)
      PRIORITY_FEE_LAMPORTS_PER_CU="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help to see available options"
      exit 1
      ;;
  esac
done

# Prepare force flag if needed
FORCE_FLAG=""
if [ "$FORCE" = true ]; then
  FORCE_FLAG="--force"
fi

# Airdrop SOL if using local validator
if [ "$RPC_URL" = "http://localhost:8899" ]; then
  echo "Using local validator, airdropping SOL to program authority..."
  PROGRAM_AUTH_ADDRESS=$(solana address -k "$PROGRAM_AUTH_KEYPAIR" | awk '{print $1}')
  echo "Program authority address: $PROGRAM_AUTH_ADDRESS"
  solana airdrop 20 "$PROGRAM_AUTH_ADDRESS" -u "$RPC_URL" || echo "Warning: Airdrop failed, continuing anyway"
  echo "Airdrop complete"
fi

# get sol balance before and store in variable
SOL_BALANCE_BEFORE=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')

echo "Deploying Folio program..."
solana-keygen new --outfile target/deploy/folio-buffer.json --no-bip39-passphrase $FORCE_FLAG
solana program write-buffer target/deploy/folio.so \
--buffer target/deploy/folio-buffer.json \
--buffer-authority "$PROGRAM_AUTH_KEYPAIR" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc || exit 1
echo "✅ Folio program deployed"

SOL_BALANCE_AFTER_FOLIO=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
FOLIO_COST=$(echo "$SOL_BALANCE_BEFORE - $SOL_BALANCE_AFTER_FOLIO" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Folio cost: $FOLIO_COST SOL"

echo "Deploying Folio Admin program..."
solana-keygen new --outfile target/deploy/folio-admin-buffer.json --no-bip39-passphrase $FORCE_FLAG
solana program write-buffer target/deploy/folio_admin.so \
--buffer target/deploy/folio-admin-buffer.json \
--buffer-authority "$PROGRAM_AUTH_KEYPAIR" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc || exit 1
echo "✅ Folio Admin program deployed"

SOL_BALANCE_AFTER_FOLIO_ADMIN=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
FOLIO_ADMIN_COST=$(echo "$SOL_BALANCE_AFTER_FOLIO - $SOL_BALANCE_AFTER_FOLIO_ADMIN" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Folio Admin cost: $FOLIO_ADMIN_COST SOL"

echo "Deploying Rewards program..."
solana-keygen new --outfile target/deploy/rewards-buffer.json --no-bip39-passphrase $FORCE_FLAG
solana program write-buffer target/deploy/rewards.so \
--buffer target/deploy/rewards-buffer.json \
--buffer-authority "$PROGRAM_AUTH_KEYPAIR" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc || exit 1
echo "✅ Rewards program deployed"

SOL_BALANCE_AFTER_REWARDS=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
REWARDS_COST=$(echo "$SOL_BALANCE_AFTER_FOLIO_ADMIN - $SOL_BALANCE_AFTER_REWARDS" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Rewards cost: $REWARDS_COST SOL"

TOTAL_COST=$(echo "$SOL_BALANCE_BEFORE - $SOL_BALANCE_AFTER_REWARDS" | bc | awk '{printf "%.2f\n", $1}')
echo ""
echo "💰 Total cost: $TOTAL_COST SOL"