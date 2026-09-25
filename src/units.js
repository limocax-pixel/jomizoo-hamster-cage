// Unit conversion and number formatting. Values are stored in cm / cm² / liters;
// "imperial" only changes how they are shown and entered.
import { CM_PER_IN, CM2_PER_IN2, L_PER_CUFT } from './calc.js';

const formatters = new Map();
function formatter(digits) {
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }));
  }
  return formatters.get(digits);
}

export const isImperial = (units) => units === 'imperial';

export const lenToDisplay = (cm, units) => (isImperial(units) ? cm / CM_PER_IN : cm);
export const lenFromDisplay = (value, units) => (isImperial(units) ? value * CM_PER_IN : value);
export const lenUnit = (units) => (isImperial(units) ? 'in' : 'cm');

export const fmtNumber = (value, digits = 1) => formatter(digits).format(value);

export function fmtLen(cm, units) {
  return `${fmtNumber(lenToDisplay(cm, units), 1)} ${lenUnit(units)}`;
}

/** "40 cm (15.7 in)" — used in static content that serves both audiences. */
export function fmtLenBoth(cm) {
  return `${fmtNumber(cm, 1)} cm (${fmtNumber(cm / CM_PER_IN, 1)} in)`;
}

export function fmtDims(lengthCm, widthCm, units) {
  const l = fmtNumber(lenToDisplay(lengthCm, units), 1);
  const w = fmtNumber(lenToDisplay(widthCm, units), 1);
  return `${l} × ${w} ${lenUnit(units)}`;
}

export function fmtArea(cm2, units) {
  return isImperial(units)
    ? `${fmtNumber(cm2 / CM2_PER_IN2, 0)} sq in`
    : `${fmtNumber(cm2, 0)} cm²`;
}

export function fmtAreaBoth(cm2) {
  return `${fmtNumber(cm2, 0)} cm² (${fmtNumber(cm2 / CM2_PER_IN2, 0)} sq in)`;
}

/** "5,000 cm² / 775 sq in" — for use inside parentheses. */
export function fmtAreaPair(cm2) {
  return `${fmtNumber(cm2, 0)} cm² / ${fmtNumber(cm2 / CM2_PER_IN2, 0)} sq in`;
}

export function fmtLiters(liters) {
  return `${fmtNumber(liters, liters < 10 ? 1 : 0)} L`;
}

export function fmtVolume(liters, units) {
  return isImperial(units)
    ? `${fmtLiters(liters)} (${fmtNumber(liters / L_PER_CUFT, 1)} cu ft)`
    : fmtLiters(liters);
}

export const fmtPercent = (ratio) => `${fmtNumber(ratio * 100, 0)}%`;
