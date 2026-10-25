// scripts/render_samples.js — mint lokal sampai penuh, hitung distribusi tier, simpan contoh SVG.
const fs = require("fs");
const { ethers } = require("hardhat");

const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];

async function main() {
  const [d, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  const secret = ethers.keccak256(ethers.toUtf8Bytes("sample-secret-pengupunk"));
  const commit = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
  const P = await ethers.getContractFactory("Pengupunk");
  const c = await P.deploy(await reg.getAddress(), treasury.address, 5, commit);

  fs.mkdirSync("art", { recursive: true });

  let guard = 0;
  while (Number(await c.totalMinted()) < 2222 && guard < 1200) {
    guard++;
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await d.sendTransaction({ to: w.address, value: ethers.parseEther("0.01") });
    await reg.setAgent(w.address, 1);
    const left = 2222 - Number(await c.totalMinted());
    const qty = Math.min(3, left);
    await c.connect(w).mint(qty, { value: ethers.parseEther("0.002") });
  }
  await ethers.provider.send("hardhat_mine", ["0x10"]);
  await c.reveal(secret);

  const total = Number(await c.totalMinted());
  const counts = {};
  const sample = {};
  for (let t = 1; t <= total; t++) {
    const tier = await c.tierOf(t);
    counts[tier] = (counts[tier] || 0) + 1;
    if (!sample[tier]) sample[tier] = t;
  }
  console.log("minted:", total);
  for (const tier of TIERS) {
    const n = counts[tier] || 0;
    console.log(`  ${tier.padEnd(10)} ${n} (${((n / total) * 100).toFixed(2)}%) contoh #${sample[tier]}`);
  }
  console.log("kuota gratis terpakai:", (await c.freeGranted()).toString());

  for (const tier of TIERS) {
    const id = sample[tier];
    if (!id) continue;
    const uri = await c.tokenURI(id);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
    fs.writeFileSync(`art/tier_${tier.toLowerCase()}.svg`, svg);
    fs.writeFileSync(`art/tier_${tier.toLowerCase()}.json`, JSON.stringify(json, null, 1));
  }
  console.log("svg tersimpan di art/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
