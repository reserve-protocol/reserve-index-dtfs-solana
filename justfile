# Set the default shell to bash
set shell := ["bash", "-cu"]

# Environment variables
set dotenv-load := true
set export

export PROGRAMS_DIR := "tests-ts/programs"

# Install Rust, Solana CLI, and Anchor with version checks
install-tools:
    # Check and install Rust
    @echo "Checking for Rust..."
    @if command -v cargo >/dev/null 2>&1; then \
        echo "Rust is already installed. Version: $(rustc --version)"; \
    else \
        echo "Installing Rust nightly-2025-03-05"; \
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly-2025-03-05; \
        source "$HOME/.cargo/env"; \
    fi

    # Check and install Solana CLI
    @echo "Checking for Solana CLI..."
    @if command -v solana >/dev/null 2>&1; then \
        echo "Solana CLI is already installed. Version: $(solana --version)"; \
    else \
        echo "Installing Solana v2.1.0"; \
        sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"; \
        echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc; \
    fi
    @echo "Use Solana v2.1.0"
    @agave-install init 2.1.0

    # Install Anchor
    @echo "Checking for Anchor..."
    @if command -v avm >/dev/null 2>&1; then \
        echo "Anchor Version Manager already installed"; \
    else \
        echo "Installing Anchor..."; \
        cargo install --git https://github.com/coral-xyz/anchor avm --force; \
        avm install 0.30.1; \
    fi

    # Setup Anchor version
    @echo "Setting up Anchor version 0.30.1"
    @avm use 0.30.1

    # Verification
    @echo "Installation complete! Please restart your terminal or run 'source ~/.bashrc' (or ~/.zshrc if you use zsh)"
    @echo "Verify installations:"
    @echo "Rust: $(cargo --version 2>/dev/null || echo 'not found')"
    @echo "Solana: $(solana --version 2>/dev/null || echo 'not found')"
    @echo "Anchor: $(anchor --version 2>/dev/null || echo 'not found')"

build-local:
    # Exit on error
    @set -e

    # Return to workspace root
    @cd "$(git rev-parse --show-toplevel)" || exit 1

    # Build SPL Governance program
    @echo "Building SPL Governance program..."
    @cd governance/program
    @cargo build-sbf
    @cd ..

    # Copy the built governance program
    @if [ -f "target/deploy/spl_governance.so" ]; then \
        cp target/deploy/spl_governance.so ../tests-ts/programs/governance.so; \
    elif [ -f "target/sbf-solana-solana/release/spl_governance.so" ]; then \
        cp target/sbf-solana-solana/release/spl_governance.so ../tests-ts/programs/governance.so; \
    fi

    # Return to workspace root
    @cd ..

    # Install node modules
    @yarn install

    @cp .env.example .env

    # Build second Folio instance with feature flag
    @echo "Building second instance of the program..."
    @cp utils/keys/folio-2-keypair-local.json target/deploy/folio-keypair.json

    # Anchor build with dev feature flag
    @anchor build -- --features dev

    # Update program ID in IDL and type files (Mac compatible)
    @sed -i '' 's/n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG/7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt/g' target/idl/folio.json
    @sed -i '' 's/n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG/7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt/g' target/types/folio.ts

    # Rename second instance files
    @mv target/idl/folio.json target/idl/second_folio.json
    @mv target/types/folio.ts target/types/second_folio.ts
    @mv target/deploy/folio.so target/deploy/second_folio.so
    @mv target/deploy/folio-keypair.json target/deploy/second_folio-keypair.json

    # Build first Folio instance
    @echo "Building first instance of the program..."
    @cp utils/keys/folio-keypair-local.json target/deploy/folio-keypair.json
    @anchor build

download-programs:
    # Exit on error
    @set -e

    @PROGRAMS_DIR="tests-ts/programs"
    @mkdir -p "{{PROGRAMS_DIR}}"

    # Metaplex' Token Metadata Program
    @if [ ! -f "{{PROGRAMS_DIR}}/metadata.so" ]; then \
        solana program dump --url mainnet-beta metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "{{PROGRAMS_DIR}}/metadata.so"; \
    fi

    # Squad's Multisig Program
    @if [ ! -f "{{PROGRAMS_DIR}}/squads.so" ]; then \
        solana program dump --url mainnet-beta SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu "{{PROGRAMS_DIR}}/squads.so"; \
    fi

# Run Solana local validator and tests
test-amman skip_build="":
    # Go to git workspace root
    @cd "$(git rev-parse --show-toplevel)" || exit 1

    # Run setup scripts
    @just install-tools
    @just download-programs
    @if [ "{{skip_build}}" == "--skip-build" ]; then \
        echo "Skipping build-local step"; \
    else \
      just build-local; \
    fi
    
    # Kill existing processes
    @killall solana-test-validator || true
    @pkill -f "node.*amman start" || true

    # Start amman in background
    @npx amman start --reset >/dev/null &

    # Wait for validator to start
    @sleep 15

    # Run tests
    @anchor test --skip-local-validator --skip-deploy --skip-build

    # Kill existing processes
    @pkill -f "node.*amman start" || true
    @killall solana-test-validator || true
    @pkill -f "npm exec amman" || true

test-bankrun skip_build="":
    # Go to git workspace root
    @cd "$(git rev-parse --show-toplevel)" || exit 1

    # Run setup scripts
    @just install-tools
    @just download-programs
    @if [ "{{skip_build}}" == "--skip-build" ]; then \
        echo "Skipping build-local step"; \
    else \
      just build-local; \
    fi
    @anchor run test-bankrun

test-coverage:
    @just install-tools
    # Expect tarpaulin to be already installed.
    @cargo tarpaulin --workspace \
                --exclude-files \
                "governance/*" \
                "programs/*/src/instructions/*" \
                "programs/*/src/external/*" \
                "programs/*/src/**/events.rs" \
                "programs/*/src/**/state.rs" \
                "programs/*/src/lib.rs" \
                "programs/*/src/**/errors.rs" \
                --out Html \
                --output-dir target/tarpaulin