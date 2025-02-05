import { BN } from "@coral-xyz/anchor";

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

export function serializeU256(value: number | bigint): number[] {
  const bigIntValue = BigInt(value);
  const mask = BigInt("0xFFFFFFFFFFFFFFFF"); // 64-bit mask

  return [
    Number(bigIntValue & mask),
    Number((bigIntValue >> BigInt(64)) & mask),
    Number((bigIntValue >> BigInt(128)) & mask),
    Number((bigIntValue >> BigInt(192)) & mask),
  ];
}
