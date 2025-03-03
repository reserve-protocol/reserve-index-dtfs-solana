#! /bin/bash
set -e  # Exit on error

########################################################################################
# Building our custom governance program
########################################################################################
echo "Building SPL Governance program..."
cd ../solana-program-library/governance/program
cargo build-sbf

cd ../.. # Back to solana-program-library, where the governance .so is created

# Copy the built program
if [ -f "target/deploy/spl_governance.so" ]; then
    cp target/deploy/spl_governance.so ../reserve-index-dtfs-solana/tests-ts/programs/governance.so
elif [ -f "target/sbf-solana-solana/release/spl_governance.so" ]; then
    cp target/sbf-solana-solana/release/spl_governance.so ../reserve-index-dtfs-solana/tests-ts/programs/governance.so
fi

cd ../reserve-index-dtfs-solana # Back to the solana-dtf repo

########################################################################################
# Building local will build 2 folio programs 
########################################################################################
# Build and deploy second instance with feature flag
echo "Building second instance of the program..."
cp utils/keys/folio-2-keypair-local.json target/deploy/folio-keypair.json
anchor build -- --features dev

# Manually update the program ID in the IDL and type (Mac compatible, if not just manually copy paste)
sed -i '' 's/n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG/7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt/g' target/idl/folio.json
sed -i '' 's/n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG/7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt/g' target/types/folio.ts

mv target/idl/folio.json target/idl/second_folio.json
mv target/types/folio.ts target/types/second_folio.ts
mv target/deploy/folio.so target/deploy/second_folio.so
mv target/deploy/folio-keypair.json target/deploy/second_folio-keypair.json

# Build and deploy first instance
echo "Building first instance of the program..."
cp utils/keys/folio-keypair-local.json target/deploy/folio-keypair.json
anchor build
# Want to keep original folio file names so no mv here