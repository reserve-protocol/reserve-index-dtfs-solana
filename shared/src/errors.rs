use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid program count")]
    InvalidProgramCount,

    #[msg("Program not in registrar")]
    ProgramNotInRegistrar,

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

    #[msg("Invalid Fee Per Second")]
    InvalidFeePerSecond,

    #[msg("Invalid Fee Recipient Shares")]
    InvalidFeeRecipientPortion,

    #[msg("Folio Not Initialized")]
    FolioNotInitialized,

    #[msg("Invalid Receiver Token Account")]
    InvalidReceiverTokenAccount,

    #[msg("Invalid Dao Fee Recipient")]
    InvalidDaoFeeRecipient,

    #[msg("Invalid Number of Remaining Accounts")]
    InvalidNumberOfRemainingAccounts,

    #[msg("Invalid Added Token Mints")]
    InvalidAddedTokenMints,

    #[msg("Invalid Removed Token Mints")]
    InvalidRemovedTokenMints,

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

    #[msg("Invalid Minting Fee")]
    InvalidMintingFee,

    #[msg("Invalid Fee Distribution")]
    InvalidFeeDistribution,

    #[msg("Invalid Trade Delay")]
    InvalidTradeDelay,

    #[msg("Invalid Auction Length")]
    InvalidAuctionLength,

    #[msg("Invalid Distribution Index")]
    InvalidDistributionIndex,

    #[msg("Invalid Cranker")]
    InvalidCranker,

    #[msg("Invalid Trade Id")]
    InvalidTradeId,

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

    #[msg("Trade Cannot Be Opened")]
    TradeCannotBeOpened,

    #[msg("Trade Timeout")]
    TradeTimeout,

    #[msg("Trade Collision")]
    TradeCollision,

    #[msg("Trade Cannot Be Opened Permissionlessly Yet")]
    TradeCannotBeOpenedPermissionlesslyYet,

    #[msg("Trade Not Ongoing")]
    TradeNotOngoing,

    #[msg("Slippage Exceeded")]
    SlippageExceeded,

    #[msg("Invalid Trade Sell Token Mint")]
    InvalidTradeSellTokenMint,

    #[msg("Invalid Trade Buy Token Mint")]
    InvalidTradeBuyTokenMint,

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
}

#[macro_export]
macro_rules! check_condition {
    ($condition:expr, $error:expr) => {
        if !$condition {
            return Err(error!(ErrorCode::$error));
        }
    };
}
