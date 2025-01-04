# Initial setup

Follow installation instructions at https://solana.com/docs/intro/installation

```bash
# Install rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Validate install
rustc --version # Might need to reload your path

# Install solana
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc

source ~/.zshrc

# Install anchor version manager and then anchor
cargo install --git https://github.com/coral-xyz/anchor avm --force

avm install 0.30.1
avm use 0.30.1
```
# How to get program ids

In solana, the program id is the public key at which your program is deloyed.

#### How to generate a new keypair
```bash
solana-keygen new -o dtfs-keypair.json --no-bip39-passphrase # For DTF
solana-keygen new -o folio-keypair.json --no-bip39-passphrase # For Folio
```

#### When to generate a new keypair

By default, Anchor will generate the keys for your program and store them under target/deploy/*-keypair.json. It will only generate them if they don't exist. To get the public key of the json file you can do 

```bash
solana address -k target/deploy/dtfs-keypair.json

solana address -k target/deploy/folio-keypair.json
```

**\*You should backup the deploy keys when they are for devnet or mainnet, as if you lose them, you can't upgrade the program anymore and will need to redeploy a new program\***

# How to build

1. Copy program id and paste in the lib.rs files:

```rust
// lib.rs for dtfs program
declare_id!(DTF_PROGRAM_ID)

// lib.rs for folio program
declare_id!(FOLIO_PROGRAM_ID)
```

2. Change program id and cluster in Anchor.toml:

```toml
folio = FOLIO_PROGRAM_ID
dtfs = DTF_PROGRAM_ID

cluster = Devnet / Localnet / Mainnet
```

3. Build:

```bash
anchor build
```

# How to run tests

```bash
# In the first terminal
./start-amman

# In the second terminal
anchor test --skip-local-validator --skip-deploy --skip-build
```

# How to deloy
```bash
anchor build

anchor deploy 
```

# Flows for Folio

Because of Solana's restrictions (transaction size, compute budget, etc.), the minting and redeeming flow need to happen in multiple steps.


#### Initializing a Folio
1. call ```init_folio```
2. call ```add_to_basket``` with 1..N tokens that you want to add to the folio's basket (might take multiple calls with 1..5 i.e. tokens at a time, because of the restrictions)
3. call ```finialize_basket``` when all the tokens for the folio have been added with the previous instruction. This will make your folio "mintable" by users

#### Mint 
1. call ```add_to_pending_basket``` with 1..N tokens that you want to add to your "pending" basket that will be used to mint the folio's token when the user has added all the required tokens. **The amounts added are directly transferred to the Folio's token accounts, but are set as "pending" so the user can always roll back using ```remove_from_pending_basket```**
2. call ```mint_folio_token``` when the user has finished adding / transferring all the required tokens (without a lookup table, the max amount of tokens you can send is 18)

#### Redeem
1. call ```burn_folio_token``` to burn the amount of folio token you want to redeem. **This can't be rolled back**. Will add the token amounts equal to your share of the total supply to your pending basket, so you can then redeem them by calling the following instruction
2. call ```redeem_from_pending_basket``` with 1..N tokens that you want to redeem from your pending basket. (might take multiple calls with 1..5 i.e. tokens at a time, because of the restrictions)