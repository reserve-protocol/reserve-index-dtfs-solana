//! Error codes for the program.
//!
//! Custom error for Anchor programs start at 6000. i.e. here Unauthorized error would be 6000 and
//! InvalidProgramCount would be 6001.

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid program count")]
    InvalidProgramCount,

    #[msg("Program not in registrar")]
    ProgramNotInRegistrar,

    #[msg("Invalid program version")]
    InvalidProgramVersion,

    #[msg("Invalid role")]
    InvalidRole,

    #[msg("Invalid bump")]
    InvalidBump,

    #[msg("Invalid PDA")]
    InvalidPda,

    #[msg("Invalid Actor PDA")]
    InvalidActorPda,

    #[msg("Invalid Token Mint")]
    InvalidTokenMint,

    #[msg("Invalid Program")]
    InvalidProgram,

    #[msg("Invalid Account Data")]
    InvalidAccountData,

    #[msg("Invalid Fee Recipient Count")]
    InvalidFeeRecipientCount,

    #[msg("Invalid Fee Recipient")]
    InvalidFeeRecipient,

    #[msg("TVL Fee Too Low")]
    TVLFeeTooLow,

    #[msg("TVL Fee Too High")]
    TVLFeeTooHigh,

    #[msg("Invalid Fee Recipient Shares")]
    InvalidFeeRecipientPortion,

    #[msg("Invalid Folio Status")]
    InvalidFolioStatus,

    #[msg("Invalid Recipient Token Account")]
    InvalidRecipientTokenAccount,

    #[msg("Invalid Sender Token Account")]
    InvalidSenderTokenAccount,

    #[msg("Invalid Dao Fee Recipient")]
    InvalidDaoFeeRecipient,

    #[msg("Invalid Number of Remaining Accounts")]
    InvalidNumberOfRemainingAccounts,

    #[msg("Missing Remaining Account")]
    MissingRemainingAccount,

    #[msg("Account Not Signer")]
    AccountNotSigner,

    #[msg("Account Not Writable")]
    AccountNotWritable,

    #[msg("Invalid Added Token Mints")]
    InvalidAddedTokenMints,

    #[msg("Invalid Removed Token Mints")]
    InvalidRemovedTokenMints,

    #[msg("Max Number of Tokens Reached")]
    MaxNumberOfTokensReached,

    #[msg("Mint Mismatch")]
    MintMismatch,

    #[msg("Invalid Share Amount Provided")]
    InvalidShareAmountProvided,

    #[msg("Invalid Token Amount")]
    InvalidTokenAmount,

    #[msg("Invalid Folio Token Mint")]
    InvalidFolioTokenMint,

    #[msg("Pending Token Amounts Is Not Empty")]
    PendingBasketIsNotEmpty,

    #[msg("Token Mint Not In Old Folio Basket")]
    TokenMintNotInOldFolioBasket,

    #[msg("Invalid Minting Fee")]
    InvalidMintFee,

    #[msg("Invalid Fee Distribution")]
    InvalidFeeDistribution,

    #[msg("Missing Fee Distribution Index")]
    MissingFeeDistributionIndex,

    #[msg("Invalid Auction Length")]
    InvalidAuctionLength,

    #[msg("Invalid Distribution Index")]
    InvalidDistributionIndex,

    #[msg("Invalid Cranker")]
    InvalidCranker,

    #[msg("Invalid Auction Id")]
    InvalidAuctionId,

    #[msg("Mint Can't Be Equal")]
    MintCantBeEqual,

    #[msg("Invalid Rebalance Limit")]
    InvalidRebalanceLimit,

    #[msg("Invalid Rebalance Limit: All Zero Or All Greater Than Zero")]
    InvalidRebalanceLimitAllZeroOrAllGreaterThanZero,

    #[msg("Invalid Sell Limit")]
    InvalidSellLimit,

    #[msg("Invalid Buy Limit")]
    InvalidBuyLimit,

    #[msg("Invalid Prices")]
    InvalidPrices,

    #[msg("Invalid TTL")]
    InvalidTtl,

    #[msg("Auction Cannot Be Opened")]
    AuctionCannotBeOpened,

    #[msg("Max auction runs limit exceeded.")]
    MaxAuctionRunsLimitExceeded,

    #[msg("Auction Max Runs Reached")]
    AuctionMaxRunsReached,

    #[msg("No running auction found, for the auction")]
    NoRunningAuctionFound,

    #[msg("Auction Timeout")]
    AuctionTimeout,

    #[msg("Auction Collision")]
    AuctionCollision,

    #[msg("Auction Cannot Be Opened Permissionlessly Yet")]
    AuctionCannotBeOpenedPermissionlesslyYet,

    #[msg("Folio Not Rebalancing")]
    FolioNotRebalancing,

    #[msg("Auction Cannot Be Opened Permissionlessly With Deferred Price")]
    AuctionCannotBeOpenedPermissionlesslyWithDeferredPrice,

    #[msg("Auction Not Ongoing")]
    AuctionNotOngoing,

    #[msg("Slippage Exceeded")]
    SlippageExceeded,

    #[msg("Invalid Auction Sell Token Mint")]
    InvalidAuctionSellTokenMint,

    #[msg("Invalid Auction Buy Token Mint")]
    InvalidAuctionBuyTokenMint,

    #[msg("Insufficient Balance")]
    InsufficientBalance,

    #[msg("Excessive Bid")]
    ExcessiveBid,

    #[msg("Insufficient Bid")]
    InsufficientBid,

    #[msg("Invalid Reward Token")]
    InvalidRewardToken,

    #[msg("Unsupported SPL Token")]
    UnsupportedSPLToken,

    #[msg("Disallowed Reward Token")]
    DisallowedRewardToken,

    #[msg("Reward Already Registered")]
    RewardAlreadyRegistered,

    #[msg("No More Room For New Reward Token")]
    NoMoreRoomForNewRewardToken,

    #[msg("Reward Not Registered")]
    RewardNotRegistered,

    #[msg("Invalid Reward Mint")]
    InvalidRewardMint,

    #[msg("Invalid Reward Half Life")]
    InvalidRewardHalfLife,

    #[msg("Invalid Reward Info")]
    InvalidRewardInfo,

    #[msg("Invalid User Reward Info")]
    InvalidUserRewardInfo,

    #[msg("Invalid Governance Account")]
    InvalidGovernanceAccount,

    #[msg("Invalid Community Mint")]
    InvalidCommunityMint,

    #[msg("Invalid Fee Recipient Token Account")]
    InvalidFeeRecipientTokenAccount,

    #[msg("Invalid Token Rewards Token Account")]
    InvalidTokenRewardsTokenAccount,

    #[msg("Invalid Folio Owner")]
    InvalidFolioOwner,

    #[msg("Invalid Account Owner")]
    InvalidAccountOwner,

    #[msg("No Rewards To Claim")]
    NoRewardsToClaim,

    #[msg("Math Overflow")]
    MathOverflow,

    #[msg("Invalid Reward Token Account")]
    InvalidRewardTokenAccount,

    #[msg("Invalid Fee Numerator")]
    InvalidFeeNumerator,

    #[msg("New Folio Not Owned By New Folio Program")]
    NewFolioNotOwnedByNewFolioProgram,

    #[msg("Invalid New Folio")]
    InvalidNewFolio,

    #[msg("Can't Migrate To Same Program")]
    CantMigrateToSameProgram,

    #[msg("Folio Not Migrating")]
    FolioNotMigrating,

    #[msg("Invalid Fee Floor")]
    InvalidFeeFloor,

    #[msg("Invalid Mandate Length")]
    InvalidMandateLength,

    #[msg("Invalid Holding Token Account")]
    InvalidHoldingTokenAccount,

    #[msg("Invalid Callback Program")]
    InvalidCallbackProgram,

    #[msg("Rebalance TTL Exceeded")]
    RebalanceTTLExceeded,

    #[msg("Rebalance auction launcher window is longer than the ttl")]
    RebalanceAuctionLauncherWindowTooLong,

    #[msg("Rebalance Not Open for detail updates")]
    RebalanceNotOpenForDetailUpdates,

    #[msg("Rebalance Token Already Added")]
    RebalanceTokenAlreadyAdded,

    #[msg("Tokens not available for rebalance")]
    TokensNotAvailableForRebalance,

    #[msg("Sell token not surplus")]
    SellTokenNotSurplus,

    #[msg("Buy token not deficit")]
    BuyTokenNotDeficit,

    #[msg("Invalid Rebalance Nonce, Auction Ended")]
    InvalidRebalanceNonceAuctionEnded,

    #[msg("Bid invariant violated")]
    BidInvariantViolated,

    #[msg("Rebalance mints and prices and limits length mismatch")]
    RebalanceMintsAndPricesAndLimitsLengthMismatch,

    #[msg("Minimum amount out not met")]
    MinimumAmountOutNotMet,

    #[msg("Invalid Token Balance")]
    InvalidTokenBalance,
}

/// Check a condition and return an error if it is not met.
///
/// # Arguments
/// * `condition` - The condition to check.
/// * `error` - The error to return if the condition is not met.
#[macro_export]
macro_rules! check_condition {
    ($condition:expr, $error:expr) => {
        if !$condition {
            return Err(error!(ErrorCode::$error));
        }
    };
}
