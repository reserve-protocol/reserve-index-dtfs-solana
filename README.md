# Initial setup

Follow installation instructions at https://solana.com/docs/intro/installation

```bash
avm install latest
avm use latest
```

# How to build

1. Copy program id and paste in:

```rust
declare_id!(PROGRAM_ID)
```

2. Change program id and cluster in Anchor.toml:

```toml
dtfs = PROGRAM_ID
cluster = Devnet / Localnet / Mainnet
```

3. Build:

```bash
# Build dev or local environment
anchor build -- --features dev

# Build main net environment
anchor build
```

# How to run tests

```bash
anchor test -- --features dev
```

# How to deloy
```bash
anchor build

anchor deploy 
```