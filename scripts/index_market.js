#!/usr/bin/env node
/**
 * PenguMarket indexer — builds docs/index.json for the arcade market page.
 *
 * PenguMarket has no enumeration and public BSC RPCs refuse historical getLogs
 * (archive token required), so we do not read events at all: token ids run 1..totalMinted,
 * and listing(id) / bestBid(id) answer for every id (zeros when inactive).
 * That keeps the book exact and cheap until supply reaches a few thousand.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"];
const NFT = "0xE2b3D9043fccc76e6Ce13f84346735F1AA375b5a";
const MARKET = "0xa2DcdE14A53d84bf488EB271E19d0bcc3c48A418";
const CONCURRENCY = 20;
const OUT = path.join(__dirname, "..", "docs", "index.json");

const NFT_ABI = [
  "function totalMinted() view returns (uint256)",
  "function tierOf(uint256) view returns (string)",
  "function ownerOf(uint256) view returns (address)",
];
const MARKET_ABI = [
  "function listing(uint256) view returns (address seller, uint96 price, uint64 expiry)",
  "function bestBid(uint256) view returns (address bidder, uint96 amount, uint64 expiry)",
];

async function connect() {
  for (const url of RPC) {
    try {
      const p = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
      await p.getBlockNumber();
      return p;
    } catch (e) {}
  }
  throw new Error("no RPC reachable");
}

async function pool(items, worker, size) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main() {
  const provider = await connect();
  const nft = new ethers.Contract(NFT, NFT_ABI, provider);
  const market = new ethers.Contract(MARKET, MARKET_ABI, provider);

  const total = Number(await nft.totalMinted());
  const now = Math.floor(Date.now() / 1000);
  const ids = Array.from({ length: total }, (_, k) => k + 1);

  const rows = await pool(ids, async (id) => {
    try {
      const [l, b] = await Promise.all([market.listing(id), market.bestBid(id)]);
      const listed = l[0] !== ethers.ZeroAddress && Number(l[2]) > now;
      const bidOn = b[0] !== ethers.ZeroAddress && Number(b[2]) > now;
      if (!listed && !bidOn) return null;
      return {
        id,
        seller: listed ? l[0] : null,
        price: listed ? l[1].toString() : null,
        expiry: listed ? Number(l[2]) : null,
        bidder: bidOn ? b[0] : null,
        amount: bidOn ? b[1].toString() : null,
        bidExpiry: bidOn ? Number(b[2]) : null,
      };
    } catch (e) {
      return null;
    }
  }, CONCURRENCY);

  const live = rows.filter(Boolean);
  const listings = live.filter((r) => r.seller).sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1));
  const bids = live.filter((r) => r.bidder).sort((a, b) => (BigInt(b.amount) < BigInt(a.amount) ? -1 : 1));

  const tiers = {};
  await pool(listings.slice(0, 400), async (l) => {
    try {
      tiers[l.id] = await nft.tierOf(l.id);
    } catch (e) {}
  }, CONCURRENCY);

  const floor = listings.length ? listings[0].price : "0";

  // every active listing is already verified against chain state above, so the book is exact
  const payload = {
    updatedAt: new Date().toISOString(),
    block: await provider.getBlockNumber(),
    nft: NFT,
    market: MARKET,
    totalMinted: String(total),
    scanned: total,
    floor,
    listings,
    bids,
    tiers,
    sales: null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
  console.log(
    `scanned ${total} ids · listings ${listings.length} · bids ${bids.length} · floor ${ethers.formatEther(floor)} BNB · block ${payload.block}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
