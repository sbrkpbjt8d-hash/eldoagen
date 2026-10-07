const QUANTITY_SCALE = 1000;

const toQuantityUnits = (value) => {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue)
    ? Math.round((numericValue + Number.EPSILON) * QUANTITY_SCALE)
    : 0;
};

export const roundQuantity = (value) => toQuantityUnits(value) / QUANTITY_SCALE;

export const addQuantities = (first, second) => (
  toQuantityUnits(first) + toQuantityUnits(second)
) / QUANTITY_SCALE;

export const formatQuantity = (value) => roundQuantity(value).toLocaleString('en-US', {
  maximumFractionDigits: 3,
});
