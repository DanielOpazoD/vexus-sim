/** Decode the pinned half-float nodes once, shared by the anatomical readers. */
export const HALF = Float32Array.from({ length: 65536 }, (_, bits) => {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    mantissa = bits & 1023;
  return (
    sign *
    (exponent === 0 ? mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : Infinity) : (1 + mantissa / 1024) * 2 ** (exponent - 15))
  );
});
