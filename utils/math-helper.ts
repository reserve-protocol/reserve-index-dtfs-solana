import { BN } from "@coral-xyz/anchor";
import Decimal from "decimal.js";
import { D18, MAX_FOLIO_FEE } from "./dtf-helper";

export async function getEstimatedFeeShares(elapsedTime: BN, totalSupply: BN) {
  const ONE_MINUS_FEE = D18.sub(MAX_FOLIO_FEE);
  const decimalElapsed = new Decimal(elapsedTime.toString());
  const decimalOneMinus = new Decimal(ONE_MINUS_FEE.toString()).div(
    new Decimal(D18.toString())
  );

  const denominator = decimalOneMinus.pow(decimalElapsed);

  const decimalTotal = new Decimal(totalSupply.toString());
  const estimatedFeeShares = decimalTotal.div(denominator).sub(decimalTotal);

  const daoShare = estimatedFeeShares.mul(0.6);
  const recipientShare = estimatedFeeShares.mul(0.4);

  return {
    estimatedFeeShares: new BN(estimatedFeeShares.toFixed(0)),
    daoShare: new BN(daoShare.toFixed(0)),
    recipientShare: new BN(recipientShare.toFixed(0)),
  };
}

export function deserializeU256(value: BN[]): bigint {
  if (value.length !== 4) {
    throw new Error("Invalid U256 value length");
  }

  return (
    BigInt(value[0].toString()) +
    (BigInt(value[1].toString()) << BigInt(64)) +
    (BigInt(value[2].toString()) << BigInt(128)) +
    (BigInt(value[3].toString()) << BigInt(192))
  );
}
