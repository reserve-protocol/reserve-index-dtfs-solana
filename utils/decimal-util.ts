import { BN } from "@coral-xyz/anchor";

export class DecimalValue {
  static readonly DECIMAL_PLACES = 18;
  static readonly MULTIPLIER = new BN("1000000000000000000"); // 10^18

  static readonly SCALAR = new DecimalValue({
    whole: new BN(0),
    fractional: new BN(1),
  });
  static readonly ZERO = new DecimalValue({
    whole: new BN(0),
    fractional: new BN(0),
  });
  static readonly ONE = new DecimalValue({
    whole: new BN(0),
    fractional: new BN(1),
  });

  static readonly MIN_DAO_MINTING_FEE = new DecimalValue({
    whole: new BN(0),
    fractional: new BN(500000000000000),
  });

  static readonly MAX_FOLIO_FEE = new DecimalValue({
    whole: new BN(0),
    fractional: new BN(21979552668),
  });

  public whole: BN;
  public fractional: BN;

  constructor({ whole, fractional }: { whole: BN; fractional: BN }) {
    const maxFractional = DecimalValue.MULTIPLIER.subn(1);
    this.whole = whole;
    this.fractional = BN.min(fractional, maxFractional);
  }

  static fromBN(value: BN): DecimalValue {
    const whole = value.div(DecimalValue.MULTIPLIER);
    const fractional = value.mod(DecimalValue.MULTIPLIER);
    return new DecimalValue({ whole, fractional });
  }

  toBN(): BN {
    return this.whole.mul(DecimalValue.MULTIPLIER).add(this.fractional);
  }

  lt(other: DecimalValue): boolean {
    return this.toBN().lt(other.toBN());
  }

  gt(other: DecimalValue): boolean {
    return this.toBN().gt(other.toBN());
  }

  lte(other: DecimalValue): boolean {
    return this.toBN().lte(other.toBN());
  }

  gte(other: DecimalValue): boolean {
    return this.toBN().gte(other.toBN());
  }

  eq(other: DecimalValue): boolean {
    return this.toBN().eq(other.toBN());
  }

  sub(other: DecimalValue): DecimalValue {
    const result = this.toBN().sub(other.toBN());
    return DecimalValue.fromBN(result);
  }
}
