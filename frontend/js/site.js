// What kind of copy of ParkWise this is.
//
// A copy running on someone's own machine has no restrictions. A published
// one refuses settings changes and puts its records back every so often, so
// that a visitor cannot leave the car park looking broken for the next one.
//
// This lives in its own file rather than in app.js so that a screen can ask
// about it without importing the shell that loads that screen.

import { api } from './api.js';

export const siteMode = {
  demo: false,
  resetMinutes: 0,
};

// Asked once, as the shell starts. A server too old to answer is treated as
// an ordinary local copy, which is the safe reading: nothing is restricted
// there either.
export async function loadSiteMode() {
  try {
    const meta = await api.meta();
    siteMode.demo = Boolean(meta.demoMode);
    siteMode.resetMinutes = Number(meta.resetMinutes || 0);
  } catch (problem) {
    siteMode.demo = false;
  }
  return siteMode;
}
