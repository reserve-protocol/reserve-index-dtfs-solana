#!/bin/bash

# Default values
DEFAULT_RPC_URL="http://localhost:8899"
DEFAULT_PROGRAM_AUTH_KEYPAIR="$HOME/.config/solana/folio-auth.json"
DEFAULT_PRIORITY_FEE_LAMPORTS_PER_CU=10000

# Helper function to generate explorer links
account_explorer_link() {
  local address="$1"
  local rpc_url="$2"
  
  # Skip if address is empty
  if [[ -z "$address" ]]; then
    echo "Address not found"
    return
  fi
  
  # If using localhost, use the custom URL format
  if [[ "$rpc_url" == "http://localhost:8899" ]]; then
    echo "https://explorer.solana.com/address/$address?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899"
  elif [[ "$rpc_url" == *"devnet"* ]]; then
    echo "https://explorer.solana.com/address/$address?cluster=devnet"
  elif [[ "$rpc_url" == *"testnet"* ]]; then
    echo "https://explorer.solana.com/address/$address?cluster=testnet"
  else
    # Default to mainnet
    echo "https://explorer.solana.com/address/$address"
  fi
}

transaction_explorer_link() {
  local signature="$1"
  local rpc_url="$2"
  
  # Skip if signature is empty
  if [[ -z "$signature" ]]; then
    echo "Signature not found"
    return
  fi
  
  # If using localhost, use the custom URL format
  if [[ "$rpc_url" == "http://localhost:8899" ]]; then
    echo "https://explorer.solana.com/tx/$signature?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899"
  elif [[ "$rpc_url" == *"devnet"* ]]; then
    echo "https://explorer.solana.com/tx/$signature?cluster=devnet"
  elif [[ "$rpc_url" == *"testnet"* ]]; then
    echo "https://explorer.solana.com/tx/$signature?cluster=testnet"
  else
    # Default to mainnet
    echo "https://explorer.solana.com/tx/$signature"
  fi
}

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
SOL_BALANCE_BEFORE_WRITE_BUFFERS=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')

echo "Writing Folio program to buffer..."
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
echo "✅ Folio program written to buffer"

SOL_BALANCE_AFTER_FOLIO_WRITE_BUFFER=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
FOLIO_COST=$(echo "$SOL_BALANCE_BEFORE_WRITE_BUFFERS - $SOL_BALANCE_AFTER_FOLIO_WRITE_BUFFER" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Folio write buffer cost: $FOLIO_COST SOL"

echo "Writing Folio Admin program to buffer..."
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
echo "✅ Folio Admin program written to buffer"

SOL_BALANCE_AFTER_FOLIO_ADMIN_WRITE_BUFFER=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
FOLIO_ADMIN_COST=$(echo "$SOL_BALANCE_BEFORE_WRITE_BUFFERS - $SOL_BALANCE_AFTER_FOLIO_ADMIN_WRITE_BUFFER" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Folio Admin write buffer cost: $FOLIO_ADMIN_COST SOL"

echo "Writing Rewards program to buffer..."
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
echo "✅ Rewards program written to buffer"

SOL_BALANCE_AFTER_REWARDS_WRITE_BUFFER=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
REWARDS_COST=$(echo "$SOL_BALANCE_BEFORE_WRITE_BUFFERS - $SOL_BALANCE_AFTER_REWARDS_WRITE_BUFFER" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Rewards write buffer cost: $REWARDS_COST SOL"

FOLIO_BUFFER_ADDRESS=$(solana-keygen pubkey target/deploy/folio-buffer.json)
FOLIO_ADMIN_BUFFER_ADDRESS=$(solana-keygen pubkey target/deploy/folio-admin-buffer.json)
REWARDS_BUFFER_ADDRESS=$(solana-keygen pubkey target/deploy/rewards-buffer.json)

echo "Deploying Folio program..."
FOLIO_DEPLOY_OUTPUT=$(solana program deploy \
--program-id target/deploy/folio-keypair.json \
--buffer "$FOLIO_BUFFER_ADDRESS" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc 2>&1) || exit 1

# Save output to a temporary file for easier parsing
echo "$FOLIO_DEPLOY_OUTPUT" > /tmp/folio_deploy_output.txt

# Extract program ID directly from the line with 'Program Id:'
FOLIO_PROGRAM_ID=$(grep "Program Id:" /tmp/folio_deploy_output.txt | awk '{print $NF}')

# Extract signature directly from the line with 'Signature:'
FOLIO_SIGNATURE=$(grep "Signature:" /tmp/folio_deploy_output.txt | awk '{print $NF}')

# Generate explorer links
FOLIO_PROGRAM_LINK=$(account_explorer_link "$FOLIO_PROGRAM_ID" "$RPC_URL")
FOLIO_TX_LINK=$(transaction_explorer_link "$FOLIO_SIGNATURE" "$RPC_URL")

echo "$FOLIO_DEPLOY_OUTPUT"
echo "✅ Folio program deployed"

echo "Deploying Folio Admin program..."
FOLIO_ADMIN_DEPLOY_OUTPUT=$(solana program deploy \
--program-id target/deploy/folio_admin-keypair.json \
--buffer "$FOLIO_ADMIN_BUFFER_ADDRESS" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc 2>&1) || exit 1

# Save output to a temporary file for easier parsing
echo "$FOLIO_ADMIN_DEPLOY_OUTPUT" > /tmp/folio_admin_deploy_output.txt

# Extract program ID directly from the line with 'Program Id:'
FOLIO_ADMIN_PROGRAM_ID=$(grep "Program Id:" /tmp/folio_admin_deploy_output.txt | awk '{print $NF}')

# Extract signature directly from the line with 'Signature:'
FOLIO_ADMIN_SIGNATURE=$(grep "Signature:" /tmp/folio_admin_deploy_output.txt | awk '{print $NF}')

# Generate explorer links
FOLIO_ADMIN_PROGRAM_LINK=$(account_explorer_link "$FOLIO_ADMIN_PROGRAM_ID" "$RPC_URL")
FOLIO_ADMIN_TX_LINK=$(transaction_explorer_link "$FOLIO_ADMIN_SIGNATURE" "$RPC_URL")

echo "$FOLIO_ADMIN_DEPLOY_OUTPUT"
echo "✅ Folio Admin program deployed"

echo "Deploying Rewards program..."
REWARDS_DEPLOY_OUTPUT=$(solana program deploy \
--program-id target/deploy/rewards-keypair.json \
--buffer "$REWARDS_BUFFER_ADDRESS" \
--fee-payer "$PROGRAM_AUTH_KEYPAIR" \
--max-sign-attempts 100 \
-k "$PROGRAM_AUTH_KEYPAIR" \
-u "$RPC_URL" \
--with-compute-unit-price "$PRIORITY_FEE_LAMPORTS_PER_CU" \
--use-rpc 2>&1) || exit 1

# Save output to a temporary file for easier parsing
echo "$REWARDS_DEPLOY_OUTPUT" > /tmp/rewards_deploy_output.txt

# Extract program ID directly from the line with 'Program Id:'
REWARDS_PROGRAM_ID=$(grep "Program Id:" /tmp/rewards_deploy_output.txt | awk '{print $NF}')

# Extract signature directly from the line with 'Signature:'
REWARDS_SIGNATURE=$(grep "Signature:" /tmp/rewards_deploy_output.txt | awk '{print $NF}')

# Generate explorer links
REWARDS_PROGRAM_LINK=$(account_explorer_link "$REWARDS_PROGRAM_ID" "$RPC_URL")
REWARDS_TX_LINK=$(transaction_explorer_link "$REWARDS_SIGNATURE" "$RPC_URL")

echo "$REWARDS_DEPLOY_OUTPUT"

SOL_BALANCE_AFTER_DEPLOY=$(solana balance -k "$PROGRAM_AUTH_KEYPAIR" -u "$RPC_URL" | awk '{print $1}')
DEPLOY_COST=$(echo "$SOL_BALANCE_BEFORE_WRITE_BUFFERS - $SOL_BALANCE_AFTER_DEPLOY" | bc | awk '{printf "%.2f\n", $1}')
echo "🟡 Deploy cost: $DEPLOY_COST SOL"

TOTAL_COST=$(echo "$SOL_BALANCE_BEFORE_WRITE_BUFFERS - $SOL_BALANCE_AFTER_DEPLOY" | bc | awk '{printf "%.2f\n", $1}')
echo ""
echo "💰 Total cost: $TOTAL_COST SOL"

echo "✅ Rewards program deployed"

# Print summary of all program IDs, links, and transaction signatures
echo ""
echo "📋 Deployment Summary:"
echo ""
echo "Program Explorer Links:"
echo "Folio:       $FOLIO_PROGRAM_LINK"
echo "Folio Admin: $FOLIO_ADMIN_PROGRAM_LINK"
echo "Rewards:     $REWARDS_PROGRAM_LINK"
echo ""
echo "Transaction Explorer Links:"
echo "Folio:       $FOLIO_TX_LINK"
echo "Folio Admin: $FOLIO_ADMIN_TX_LINK"
echo "Rewards:     $REWARDS_TX_LINK"