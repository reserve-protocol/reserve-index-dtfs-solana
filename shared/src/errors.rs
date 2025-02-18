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

    #[msg("Invalid Program")]
    InvalidProgram,

    #[msg("Invalid Account Data")]
    InvalidAccountData,

    #[msg("Invalid Fee Recipient Count")]
    InvalidFeeRecipientCount,

    #[msg("Invalid Fee Recipient")]
    InvalidFeeRecipient,

    #[msg("Invalid Fee Recipient Numerator")]
    InvalidFeeRecipientNumerator,

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

    #[msg("Invalid Auction Delay")]
    InvalidAuctionDelay,

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

    #[msg("Auction Timeout")]
    AuctionTimeout,

    #[msg("Auction Collision")]
    AuctionCollision,

    #[msg("Auction Cannot Be Opened Permissionlessly Yet")]
    AuctionCannotBeOpenedPermissionlesslyYet,

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

    #[msg("Disallowed Reward Token")]
    DisallowedRewardToken,

    #[msg("Reward Already Registered")]
    RewardAlreadyRegistered,

    #[msg("No More Room For New Reward Token")]
    NoMoreRoomForNewRewardToken,

    #[msg("No More Room For New Disallowed Token")]
    NoMoreRoomForNewDisallowedToken,

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

    #[msg("Invalid Fee Recipient Token Account")]
    InvalidFeeRecipientTokenAccount,

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

    #[msg("Can't Migrate To Same Program")]
    CantMigrateToSameProgram,

    #[msg("Invalid Fee Floor")]
    InvalidFeeFloor,

    #[msg("Invalid Mandate Length")]
    InvalidMandateLength,

    #[msg("Invalid Holding Token Account")]
    InvalidHoldingTokenAccount,
}

#[macro_export]
macro_rules! check_condition {
    ($condition:expr, $error:expr) => {
        if !$condition {
            return Err(error!(ErrorCode::$error));
        }
    };
}
