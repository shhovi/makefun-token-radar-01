// Token Radar model v2 ("radar-2"): one sealed snapshot in, one ranked board out.
//
// Who is ranked: every protocol that records no token (no market cap, no CoinGecko id, no symbol)
// and is not a wrapped, staked or bridged product of a token that already trades, judged by the
// watchlist's own derivable rules: category is not Bridge, Canonical Bridge, Liquid Staking,
// Liquid Restaking, Restaked BTC or CEX; the name carries no whole word wrapped, staked or
// staking, does not end in a version marker, and does not begin with an exchange's name. The
// snapshot's 40-slug watchlist is a subset of this pool, so coverage is structural, and the pool
// below the $50M floor is the early radar. Protocols whose token already trades are never ranked;
// they are shown apart with the market's own market cap.
//
// Implied value follows only from the snapshot's own figures, one function for every row:
//
//   base       = tvl_usd x 0.30
//   momentum   = 1 + (g >= 0 ? 0.30 : 0.50) x g / 100,  g = clamp(change_7d, -50, 100)
//                (a bleed week counts more than a spike week: spikes mean-revert, bleeds persist)
//   maturity   = 0.55 + 0.45 x (1 - exp(-age_days / 540))
//                (a saturating patience premium for running long with no token; unknown age: 365)
//   breadth    = 1 + 0.04 x min(chains - 1, 5)   (distribution across chains, capped at +20%)
//   implied    = max(1, round(base x momentum x maturity x breadth))
//
// Risk flags and a data-confidence tier are derived from the same figures and shown beside every
// row, so a high rank built on thin data is visibly thin. No protocol name is special-cased.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2';

export const MODEL = {
  base_multiple: 0.3,
  momentum_up: 0.3,
  momentum_down: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_tau_days: 540,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
};

export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  risk_flags: string[];
  confidence: 'high' | 'medium' | 'low';
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  risk_flags: string[];
  confidence: 'high' | 'medium' | 'low';
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: typeof MODEL;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are products of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * A launch candidate: records no token and is not a wrapped, staked or bridged product of one
 * that trades, by every rule the snapshot's ten fields let us apply. The watchlist was drawn
 * with one more record (parentProtocol) the snapshot does not carry; every watchlist slug
 * passes these rules too, which the board's coverage check verifies on each run.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  return !EXCHANGE_HEADS.some((head) => p.name.startsWith(head));
}

/** The three multipliers and the implied value one protocol gets under the model. */
export function impliedValue(p: SnapshotProtocol, asOf: string): { implied: number; growthPct: number; momentum: number; maturity: number; breadth: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw));
  const momentum = 1 + (growthPct >= 0 ? MODEL.momentum_up : MODEL.momentum_down) * (growthPct / 100);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturity = MODEL.maturity_floor + MODEL.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / MODEL.maturity_tau_days));
  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * MODEL.base_multiple * momentum * maturity * breadth));
  return { implied, growthPct, momentum, maturity, breadth, age };
}

/** Risk flags from the protocol's own figures: what could make its rank fragile. */
export function riskFlags(p: SnapshotProtocol, age: number | null): string[] {
  const flags: string[] = [];
  if (age !== null && age < 180) flags.push('young');
  if (p.change_7d !== null && p.change_7d < -10) flags.push('shrinking');
  if (p.change_7d !== null && p.change_7d > 25) flags.push('hot-week');
  if (p.tvl_usd < 10_000_000) flags.push('thin-tvl');
  if (p.change_7d === null) flags.push('growth-unreported');
  if (p.chains.length <= 1) flags.push('single-chain');
  if (age === null) flags.push('age-unknown');
  return flags;
}

/** How much of the model's input is actually reported for this row. */
export function confidenceOf(p: SnapshotProtocol, age: number | null, floorUsd: number): 'high' | 'medium' | 'low' {
  let score = 0;
  if (age !== null) score++;
  if (p.change_7d !== null) score++;
  if (p.chains.length >= 2) score++;
  if (p.tvl_usd >= floorUsd) score++;
  return score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low';
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so both sides of the market see activity.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the LP position open.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small delta-neutral hedge, then close it after a day.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one small position in a liquid market on ${name}, sized so a total loss is acceptable.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the receipt.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for its full term.`;
  if (c.includes('launchpad')) return `Register the farming wallet on ${name} and commit $${capital} to its next sale or staking round if one opens.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its main product and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age, 7-day change). Risk flags change the plan:
 * a young or thin protocol starts with a test deposit, a shrinking one stages its entries, a
 * single-chain one bridges in first. Nothing here is a promise of a token or a reward.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const flags = riskFlags(p, age);
  const testFirst = flags.includes('young') || flags.includes('thin-tvl');
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only farming funds, keep its seed phrase offline, and bookmark ${p.name}'s official site from its own social profile, never from a search ad.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
  ];
  if (flags.includes('single-chain')) {
    steps.push({
      text: `Bridge $${capital} of USDC to ${chain} through a major bridge, since ${p.name} counts its TVL on that chain alone.`,
      cost: 'about $2 to $6 in bridge and gas fees',
      time: '10 minutes plus bridge settlement',
    });
  }
  if (testFirst) {
    steps.push({
      text: `Start with a $10 test deposit into ${p.name} and withdraw it once, so you know the exit works before real capital goes in.`,
      cost: '$10 of capital and about $3 of gas',
      time: '15 minutes',
    });
  }
  steps.push({
    text: actionFor(p, capital, chain),
    cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
    time: '15 minutes to set up',
  });
  if (flags.includes('shrinking')) {
    steps.push({
      text: `TVL fell over the last week, so stage the position in two halves a week apart instead of entering all at once.`,
      cost: 'about $2 of extra gas for the second entry',
      time: '10 minutes, twice',
    });
  }
  steps.push({
    text: `Repeat one qualifying action each week (deposit, borrow, swap, stake or vote) so the wallet is active in at least four distinct weeks.`,
    cost: 'about $2 of gas a week',
    time: '10 minutes a week',
  });
  steps.push({
    text: `Hold the position for at least ${hold} days, and do not move it to a new wallet, so the activity reads as one consistent user.`,
    cost: `the $${capital} stays in the position; exit gas is about $4`,
    time: `${hold} days`,
  });
  steps.push({
    text: `Check ${p.name}'s own points or rewards page monthly and claim only through links it publishes; never pay a fee to claim.`,
    cost: 'no fee to check',
    time: '10 minutes a month',
  });
  steps.push({
    text: `Log the wallet, dates, amounts and transaction hashes in a farm log, and set a calendar reminder for the ${hold}-day review.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  });
  return steps.slice(0, 8);
}

/** The ranked board: every launch candidate, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const pool = snapshot.protocols.filter(isLaunchCandidate);
  const scored = pool.map((p) => ({ p, ...impliedValue(p, snapshot.as_of) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: MODEL.base_multiple,
      growth_pct: s.growthPct,
      momentum_multiplier: round4(s.momentum),
      maturity_multiplier: round4(s.maturity),
      breadth_multiplier: round4(s.breadth),
      age_days: s.age,
    },
    risk_flags: riskFlags(s.p, s.age),
    confidence: confidenceOf(s.p, s.age, snapshot.floor_usd),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap: their value is the market's fact, not a model. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      momentum_multiplier: r.model.momentum_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      risk_flags: r.risk_flags,
      confidence: r.confidence,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Checked on every run before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
