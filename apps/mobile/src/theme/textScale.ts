/**
 * How far Dynamic Type grows each kind of text (`maxFontSizeMultiplier`). Content (titles, meta
 * lines, Settings, tool rows, receipts, the strip) stops at 2×, where it still wraps cleanly.
 */
export const CONTENT_TEXT_SCALE = 2;

/** Home's headers, pills, chips and kickers stop at 1.5×, so they keep their row. */
export const CHROME_TEXT_SCALE = 1.5;

/** The composer's control row (chip, count, ring words, Queue, Approve/Deny) stops at 1.4×. */
export const CONTROL_TEXT_SCALE = 1.4;

/** The tab pill is a fixed 58pt high, so its labels stop at 1.2×, as UITabBar's do. */
export const TAB_TEXT_SCALE = 1.2;

/** The font scale where iOS's accessibility sizes begin: secondary lines wrap instead of truncating. */
export const ACCESSIBILITY_SCALE = 1.6;
