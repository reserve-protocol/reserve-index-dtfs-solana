# Folio Protocol

## Table of Contents

- [Overview](#overview)
- [Decimal Precision](#decimal-precision)
- [Mathematical Utilities](#mathematical-utilities)
- [Protocol Flows](#protocol-flows)
- [Protocol Explanation](#protocol-explanation)
- [Build Guide](#build-guide)
- [Testing Guide](#testing-guide)

## Overview

Reserve Folio is a protocol for creating and managing portfolios of SPL-compliant assets entirely onchain. Folios are designed to be used as a single-source of truth for asset allocations, enabling composability of complex, multi-asset portfolios.

Folios support rebalancing via Dutch Auction over an exponential decay curve between two prices. Control flow over the auction is shared between two parties, with a REBALANCE_MANAGER approving rebalances in advance and a AUCTION_LAUNCHER opening them, optionally providing some amount of additional detail. Permissionless execution is available after a delay.

REBALANCE_MANAGER is expected to be the SPL Governance account configured for fast-moving decisions associated with the Folio

AUCTION_LAUNCHER is expected to be a semi-trusted wallet or multisig; They can open auctions within the bounds set by governance, hopefully adding basket definition and pricing precision. If they are offline the auction can be opened permissionlessly after a preset delay. If they are evil, at-best they can deviate rebalancing within the governance-granted range, or prevent a Folio from rebalancing entirely by repeatedly closing-out auctions.

## Decimal Precision

In the solana program, we intentionally don't take into account how many decimals a token has, All calculations are done once the amount of tokens are multiplied by `D9 (10**9)`. The Token decimals are merely for the ui purposes and don't have any influence on the calculations.

### Precision Levels

- **D9 (1e9)**: Decimals added to the token amount before any calculations are done.
- **D18 (1e18)**: Decimals that are part of any fraction or ratio, for example a price, a basket ratio, an fee, etc.

### Implementation Details

#### Enhanced Precision (D9)

- Used for advanced calculations requiring higher precision
- Handles precision loss mitigation
- Conversion process to D9:
  - Values are floored for token operations
  - Sub-D9 precision ("dust") is retained
  - Accumulated dust compounds into complete D9 units over time

### Variable Naming Conventions

> Note: These conventions exclude `state.rs` account definitions to maintain Solidity compatibility.

- `raw_`: Indicates that the tokens are without any additional decimals added from our side. The protocol whenever mentioning tokens always talks about the smallest possible UI form, so Lamports for sol, and 1 raw USDC is 0.0000001 USDC on ui, but is treaded as 1 without any context of UI token decimals. Eg. 1 Lamport = 1 raw_token.

- `scaled_`: It is when used with fees, so we represent 10 percent, which would be 0.1(10/100) as `1e+17`. For token amounts,
  scaled only only used if it is multiplied by `D9`, meaning 9 additional decimals.

## Mathematical Utilities

### Core Operations

The `math_util.rs` module provides high-precision mathematical operations:

- Basic arithmetic (`add`, `sub`, `mul`, `div`)
- Power function (`pow`) using binary exponentiation

### Advanced Functions

#### Nth Root Implementation

Two-tiered approach based on input size:

1. Large Values (n > 1,000,000):

   - Taylor series approximation near x = 1
   - Three-term series expansion
   - Formula: 1 - x/n + (n-1)x²/(2n²) - (n-1)(n-2)x³/(6n³)

2. Standard Values (n ≤ 1,000,000):
   - Binary search implementation
   - 15 iteration maximum
   - Optimized for accuracy/performance balance

#### Natural Logarithm (ln)

Implementation features:

- Input normalization (1 to e range)
- arctanh Taylor series expansion
- Formula: ln((1+x)/(1-x)) = 2 \* arctanh(x)
- Epsilon precision: 1e-18

#### Exponential Function (exp)

Implementation features:

- Taylor series: e^x = 1 + x + x²/2! + x³/3! + ...
- Dynamic iteration termination
- Bi-directional exponent support
- Epsilon precision: 1e-18

### Error Handling

- D9 precision maintenance
- Comprehensive overflow protection
- U256 internal calculations
- Result-based error handling

## Protocol Flows

### Folio Initialization

1. Execute `init_folio`
2. Add tokens via `add_to_basket` (supports multiple transactions for large baskets)
   > Note: Providing `initial_shares` enables immediate minting capability

### Minting Process

1. Add tokens to pending basket:

   - Use `add_to_pending_basket` for 1-N tokens
   - Tokens transfer immediately but remain "pending"
   - Reversible via `remove_from_pending_basket`

2. Execute minting:
   - Call `mint_folio_token`
   - Maximum 16 tokens without lookup table

### Redemption Process

1. Burn tokens:

   - Execute `burn_folio_token`
   - Irreversible operation
   - Adds proportional tokens to pending basket

2. Claim tokens:
   - Use `redeem_from_pending_basket`
   - Supports multiple transactions for large baskets

### Migration Protocol

For security, the program is non-upgradeable. Migration process:

- Program owner initiates migration
- Permissionless token transfer
- New version handles account structure migration
- Whitelist-restricted program migration

### Governance Integration

- Integrated with custom SPL governance program
- Reward-enabled Folios owned by DAO via Governance PDA
- Administrative functions require DAO voting:
  - Reward token management
  - Ratio configuration
  - General administration

## Protocol Explanation

### Roles

##### Folio

A Folio has 3 roles:

1. `OWNER`
   - Expected: SPL Governance account of Realm with slow configuration
   - Can add/remove assets, set fees, configure auction length, set the auction delay, and closeout auctions
   - Can configure the `REBALANCE_MANAGER`/ `AUCTION_LAUNCHER`
   - Primary owner of the Folio
2. `REBALANCE_MANAGER`
   - Expected: SPL Governance account of Relam with fast configuration
   - Can approve auctions
3. `AUCTION_LAUNCHER`
   - Expected: wallet or multisig
   - Can open and close auctions, optionally altering parameters of the auction within the approved ranges

### Rebalancing

##### Auction Lifecycle

1. Rebalance is approved by governance, including an initial price range, the tokens mints and for each token mint the basket presence they are looking for after the rebalance is completed.
2. Auction is opened, initiating the progression through the predetermined price curve
   a. ...either by the auction launcher (immediately, or soon after). They can pass in additional details like price range etc.
   b. ...or permissionlessly (after the auction delay passes)
3. Bids occur
4. Auction expires

##### Auction Usage

###### Buy/Sell limits

Governance configures buy and sell limits for the basket ratios, including a spot estimate:

```rust
pub struct BasketRange {
    pub spot: u128,    /// D9{tok/share}
    pub low: u128,     /// D9{tok/share} inclusive
    pub high: u128,    /// D9{tok/share} inclusive
}

sell_limit: BasketRange; // D9{sellTok/share} min ratio of sell tokens in the basket, inclusive
buy_limit BasketRange; // D9{buyTok/share} max ratio of buy tokens in the basket, exclusive
```

During `open_auction` the `AUCTION_LAUNCHER` can set the buy and sell limits within the approved ranges provided by governance. If the auction is opened permissionlessly instead, the governance pre-approved spot estimates will be used instead.

###### Price

There are broadly 3 ways to parametrize `[start_price, end_price]`, as the `REBALANCE_MANAGER`:

1. Can provide `[0, 0]` to _fully_ defer to the auction launcher for pricing. In this mode the auction CANNOT be opened permissionlessly. Loss can arise either due to the auction launcher setting `start_price` too low, or due to precision issues from traversing too large a range.
2. Can provide `[start_price, 0]` to defer to the auction launcher for _just_ the `end_price`. In this mode the auction CANNOT be opened permissionlessly. Loss can arise due solely to precision issues only.
3. Can provide `[start_price, end_price]` to defer to the auction launcher for the `start_price`. In this mode the auction CAN be opened permissionlessly, after a delay. Suggested default option.

The `AUCTION_LAUNCHER` can always choose to raise `start_price` within a limit of 100x, and `end_price` by any amount. They cannot lower either price.

The price range (`start_price / end_price`) must be less than `1e9` to prevent precision issues.

###### Lot Sizing

Auction lots are sized by `Auction.sell_limit` and `Auction.buy_limit`. Both correspond to Folio structs about basket ratios that must be maintained throughout the auction:

- `sell_limit` is the min amount of sell token in the basket `D9{sellTok/share}`
- `buy_limit` is the max amount of buy token in the basket `D9{buyTok/share}`

In general it is possible for the `lot` to both increase and decrease over time, depending on whether `sell_limit` or `buy_limit` is the constraining factor in sizing.

###### Auction Participation

Anyone can bid in any auction in size up to and including the `lot` size.

### Fee Structure

Folios support 2 types of fees. Both have a DAO portion that work the same underlying way, placing limits on how small the fee can be.

##### `tvl_fee`

**Per-unit time fee on AUM**

The DAO takes a cut with a minimum floor of 15 bps. A consequence of this is that the Folio always inflates at least 15 bps annually. If the tvl fee is set to 15 bps, then 100% of this inflation goes towards the DAO.

##### `mint_fee`

**Fee on mints**

The DAO takes a cut with a minimum floor of 15 bps. The DAO always receives at least 15 bps of the value of the mint. If the mint fee is set to 15 bps, then 100% of the mint fee is taken by the DAO.

#### Fee Floor

The universal 15 bps fee floor can be lowered by the DAO, as well as set (only lower) on a per Folio basis.

## Build Guide

### Prerequisites

Development Tools:

```bash
cargo install just
just install-tools
```

### Environment Setup

1. Configuration Files:

   - Copy `.env.example` to `.env`
   - Configure required variables:
     ```
     ADMIN_PUBKEY=AXF3tTrMUD5BLzv5Fmyj63KXwvkuGdxMQemSJHtTag4j
     SPL_GOVERNANCE_PROGRAM_ID=HwXcHGabc19PxzYFVSfKvuaDSNpbLGL8fhVtkcTyEymj
     ```

2. Key Management:
   > Note: Local Development keys are included in `/utils/keys/`
   - `keys.json`: Test configuration keys

### Feature Flags

Folio can be compiled with 3 main feature flags:

1. **`dev`** - Development Environment
   - Uses `shared/dev` and `folio-admin/dev` features
   - For staging deployment.

2. **`test`** - Local Testing Environment
   - Makes sure the admin Key for test is used.
   - Makes sure that the folio-admin is compiled with non-dev pubkey for testing migrations.
   
3. Default:
   - Use for production deployment.

### Build Configuration

#### Environment Settings

Configure `Anchor.toml` for target environment:

```toml
[provider]
cluster = "Localnet"  # Options: Localnet, Devnet, Mainnet
wallet = "~/.config/solana/id.json"

[programs.localnet]
folio = "n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG"
folio_admin = "7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn"
rewards = "7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf"
```

#### Build Process

Execute:

```bash
just build-local
```

1. SPL Governance compilation
2. Dual Folio program builds:
   - Standard instance
   - Development instance (feature-enabled) (can be migrated to for testing purposes)
3. Normal build of Folio Admin and Rewards programs

### Key Management

#### Program ID Generation

```bash
# Generate new keypairs
solana-keygen new -o folio_admin-keypair.json --no-bip39-passphrase
solana-keygen new -o folio-keypair.json --no-bip39-passphrase
solana-keygen new -o rewards.json --no-bip39-passphrase

# View public keys
solana address -k target/deploy/folio_admin-keypair.json
solana address -k target/deploy/folio-keypair.json
solana address -k target/deploy/rewards.json
```

> Important: Backup deployment keys for devnet/mainnet environments to maintain upgrade capability

## Testing Guide

The protocol implements three distinct testing approaches to ensure comprehensive coverage and reliability.

### 1. Rust Unit Tests

Located under the `tests/` directory, these tests focus on pure Rust functions without Anchor-specific parameters.

#### Characteristics

- Tests functions without `Account`, `AccountInfo`, or `AccountLoader` parameters
- Fast execution and simple setup
- Ideal for testing mathematical operations and utility functions

#### Running Unit Tests

```bash
# Standard test execution
cargo test

# With coverage reporting
cargo tarpaulin --workspace \
                --exclude-files \
                "programs/*/src/instructions/*" \
                "programs/*/src/external/*" \
                "programs/*/src/**/events.rs" \
                "programs/*/src/**/state.rs" \
                "programs/*/src/lib.rs" \
                "programs/*/src/**/errors.rs" \
                --out Html \
                --output-dir target/tarpaulin
```

> Note: Some functions are intentionally excluded from coverage metrics due to the complexity of mocking Anchor structures. These typically involve Account-related parameters.

### 2. Bankrun Tests

Located under `tests-ts/bankrun/`, these tests provide a middle ground between unit and integration tests.

#### Features

- Simulates on-chain behavior without requiring a validator
- Faster than full integration tests
- Tests program instructions and account interactions

#### Setup and Execution

```bash
just test-bankrun
```

> Note: Bankrun tests don't require a Solana test validator, making them significantly faster than traditional integration tests.

### 3. Integration Tests

Located under `tests-ts/tests-*.ts`, these tests provide full end-to-end testing of the protocol.

#### Features

- Complete on-chain interaction testing
- Tests cross-program interactions
- Validates real-world scenarios

#### Setup and Execution

Start the test environment and run tests:

```bash
just test-amman
```

#### Test Configuration

- Uses Amman for transaction monitoring
- Skips local validator (using Amman instead)
- Skips deployment and build (assuming programs are pre-built)

### Test Organization

```bash
project/
├── tests/ # Rust unit tests
├── tests-ts/
│ ├── bankrun/ # Bankrun tests
│ │ └── test-runner.ts
│ └── tests-*.ts # Integration tests
```

### Best Practices

1. **Unit Tests**

   - Write for all pure functions
   - Focus on edge cases and error conditions
   - Maintain high coverage for non-Account functions

2. **Bankrun Tests**

   - Test instruction logic
   - Validate account constraints
   - Verify state transitions

3. **Integration Tests**
   - Test complete user flows
   - Verify cross-program interactions
   - Validate real-world scenarios

## Architecture Diagrams

### Core Account Structure

```mermaid
classDiagram
    class Folio {
        +bump: u8
        +status: u8
        +folio_token_mint: Pubkey
        +tvl_fee: u128
        +mint_fee: u128
        +dao_pending_fee_shares: u128
        +fee_recipients_pending_fee_shares: u128
        +auction_length: u64
        +current_auction_id: u64
        +last_poke: i64
        +mandate: FixedSizeString
    }

    class Actor {
        +bump: u8
        +authority: Pubkey
        +folio: Pubkey
        +roles: u8
    }

    class FolioBasket {
        +bump: u8
        +folio: Pubkey
        +folio_token_amounts: FolioTokenAmount[]
    }

    class UserPendingBasket {
        +bump: u8
        +owner: Pubkey
        +folio: Pubkey
        +token_amounts: TokenAmount[]
    }

    Folio --> Actor: has many
    Folio --> FolioBasket: has one
    Folio --> UserPendingBasket: has many
```

### Auction System

```mermaid
classDiagram
    class Auction {
        +bump: u8
        +id: u64
        +available_at: u64
        +launch_timeout: u64
        +folio: Pubkey
        +sell: Pubkey
        +buy: Pubkey
        +sell_limit: BasketRange
        +buy_limit: BasketRange
        +max_runs: u8
        +closed_for_reruns: u8
        +initial_proposed_price: Prices
        +auction_run_details: AuctionRunDetails[]
    }

    class AuctionRunDetails{
        +start: u64,
        +end: u64,
        +price: Prices
        +sell_limit_spot: u128
        +buy_limit_spot: u128
        +k: u128
    }

    Folio --> Auction: has many
```

### Fee Management

```mermaid
classDiagram
    class FeeRecipients {
        +bump: u8
        +distribution_index: u64
        +folio: Pubkey
        +fee_recipients: FeeRecipient[]
    }

    class FeeDistribution {
        +bump: u8
        +index: u64
        +folio: Pubkey
        +cranker: Pubkey
        +amount_to_distribute: u128
        +fee_recipients_state: FeeRecipient[]
    }

    class DAOFeeConfig {
        +bump: u8
        +fee_recipient: Pubkey
        +default_fee_numerator: u128
        +default_fee_floor: u128
    }

    class FolioFeeConfig {
        +bump: u8
        +fee_numerator: u128
        +fee_floor: u128
    }

    Folio --> FeeRecipients: has one
    FeeRecipients --> FeeDistribution: has many
    DAOFeeConfig --> FolioFeeConfig: configures
    FolioFeeConfig --> Folio: configures
```

### Reward System

```mermaid
classDiagram
    class RewardTokens {
        +bump: u8
        +realm: Pubkey
        +rewards_admin: Pubkey
        +reward_ratio: u128
        +reward_tokens: Pubkey[]
    }

    class RewardInfo {
        +bump: u8
        +realm: Pubkey
        +reward_token: Pubkey
        +payout_last_paid: u64
        +reward_index: u128
        +balance_accounted: u128
        +balance_last_known: u128
        +total_claimed: u128
        +is_disallowed: bool
    }

    class UserRewardInfo {
        +bump: u8
        +realm: Pubkey
        +reward_token: Pubkey
        +last_reward_index: u128
        +accrued_rewards: u128
    }

    RewardTokens --> RewardInfo: has many
    RewardInfo --> UserRewardInfo: has many
```

### Program Registry

```mermaid
classDiagram
    class ProgramRegistrar {
        +bump: u8
        +accepted_programs: Pubkey[]
    }

    ProgramRegistrar --> Folio: registers versions
```

### Core Program Flow

```mermaid
sequenceDiagram
    participant Owner as Folio Owner (DAO)
    participant RebalanceManager as Rebalance Manager
    participant Launcher as Auction Launcher
    participant User
    participant Folio
    participant Rewards
    participant Admin as Reward Admin

    %% Initialization Flow
    rect rgb(106, 106, 116)
        Note over Owner, Folio: Initialization Phase
        Owner->>Folio: init_folio()
        Owner->>Folio: init_or_update_actor(REBALANCE_MANAGER)
        Owner->>Folio: init_or_update_actor(AUCTION_LAUNCHER)
        Owner->>Folio: add_to_basket(initial_tokens)
    end

    %% Auction Flow
    rect rgb(91, 81, 81)
        Note over RebalanceManager, Folio: Auction Phase
        RebalanceManager->>Folio: approve_auction(price_range, limits)
        alt Immediate Launch
            Launcher->>Folio: open_auction()
        else After Delay
            User->>Folio: open_auction_permissionless()
        end
        User->>Folio: bid()
        opt If needed
            Launcher->>Folio: close_auction()
        end
    end

    %% User Operations
    rect rgb(52, 55, 52)
        Note over User, Folio: User Operations
        User->>Folio: add_to_pending_basket()
        User->>Folio: mint_folio_token()
        User->>Folio: burn_folio_token()
        User->>Folio: redeem_from_pending_basket()
    end

    %% Reward Management
    rect rgb(42, 36, 36)
        Note over Admin, Rewards: Reward Management
        Admin->>Rewards: set_rewards_admin()
        Admin->>Rewards: init_or_set_reward_ratio()
        Admin->>Rewards: add_reward_token()
        Admin->>Rewards: remove_reward_token()
        User->>Rewards: accrue_rewards()
        User->>Rewards: claim_rewards()
    end

    %% Fee Management
    rect rgb(32, 36, 36)
        Note over User, Folio: Fee Distribution
        User->>Folio: poke_folio()
        User->>Folio: distribute_fees()
        User->>Folio: crank_fee_distribution()
    end
```
