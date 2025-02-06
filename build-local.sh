#! /bin/bash
########################################################################################
# Building local will build 2 folio programs, so we can test migration between them
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