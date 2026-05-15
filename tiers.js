/**
 * THREAD — Referral Tier System
 * ─────────────────────────────────────────────────────────────────────────────
 * Three tiers based on lifetime converted referrals:
 *
 *   Starter  (0–10 sales)     → $22 per sale (25%)
 *   Hustler  (11–50 sales)    → $25 per sale (28%)
 *   Elite    (51+ sales)      → $27 per sale (30% — capped)
 *
 * Used by:
 *   • checkout.js  → to credit the right commission amount
 *   • dashboard.js → to show user their current tier + progress
 *   • index.html   → marketing copy on the rewards section
 */
(function () {
  'use strict';

  const TIERS = [
    {
      id:        'starter',
      name:      'Starter',
      emoji:     '🌱',
      color:     '#6C63FF',
      gradient:  'linear-gradient(135deg, #8b7cff, #6C63FF)',
      minSales:  0,
      maxSales:  10,
      perSale:   20,
      tagline:   'Just getting started',
      perks: [
        '$20 per referral sale',
        'Cash, gift card, or store credit payouts',
      ],
      unlockReward: null,
    },
    {
      id:        'hustler',
      name:      'Hustler',
      emoji:     '🔥',
      color:     '#ec4899',
      gradient:  'linear-gradient(135deg, #f472b6, #ec4899)',
      minSales:  11,
      maxSales:  50,
      perSale:   25,
      tagline:   'Making moves',
      perks: [
        '$25 per referral sale',
        '🎁 Hustler Drop Box (sticker pack + hangtag)',
        'Early access to new colorways',
      ],
      unlockReward: {
        emoji: '🎁',
        name:  'Hustler Drop Box',
        items: ['THREAD sticker pack', 'Embroidered hangtag', 'Surprise extra'],
      },
    },
    {
      id:        'elite',
      name:      'Elite',
      emoji:     '👑',
      color:     '#facc15',
      gradient:  'linear-gradient(135deg, #facc15, #f59e0b)',
      minSales:  51,
      maxSales:  Infinity,
      perSale:   30,
      tagline:   'Top earner',
      perks: [
        '$30 per referral sale (max payout)',
        '👑 Elite Drop Box (exclusive colorway + premium swag)',
        'First pick on limited drops',
        'Spot on the public leaderboard',
      ],
      unlockReward: {
        emoji: '👑',
        name:  'Elite Drop Box',
        items: ['Exclusive colorway preview', 'Premium THREAD pin set', 'Free hoodie of choice', 'Surprise extra'],
      },
    },
  ];

  /**
   * Returns the tier object for a given number of converted referrals.
   */
  function getTierForReferrals(count) {
    const n = Math.max(0, Number(count) || 0);
    return TIERS.find(t => n >= t.minSales && n <= t.maxSales) || TIERS[0];
  }

  /**
   * Returns the NEXT tier object (or null if already at top).
   */
  function getNextTier(currentTier) {
    const idx = TIERS.findIndex(t => t.id === currentTier.id);
    return idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
  }

  /**
   * How many more sales until next tier (0 if already Elite).
   */
  function salesUntilNext(count) {
    const tier = getTierForReferrals(count);
    const next = getNextTier(tier);
    if (!next) return 0;
    return Math.max(0, next.minSales - count);
  }

  /**
   * Progress (0–1) toward next tier for a progress bar.
   */
  function progressToNext(count) {
    const tier = getTierForReferrals(count);
    const next = getNextTier(tier);
    if (!next) return 1;                       // Already at top
    const range = next.minSales - tier.minSales;
    const into  = count - tier.minSales;
    return Math.max(0, Math.min(1, into / range));
  }

  window.ThreadTiers = {
    TIERS,
    getTierForReferrals,
    getNextTier,
    salesUntilNext,
    progressToNext,
  };

})();
