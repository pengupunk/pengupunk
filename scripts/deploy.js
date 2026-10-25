// scripts/deploy.js — deploy Pengupunk ke BSC mainnet, simpan catatan lengkap untuk verifikasi
const fs = require("fs");
const crypto = require("crypto");
const { ethers } = require("hardhat");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID Agent ID (.ai)
const TREASURY = "0x8F3A3882Bfab76538f783c1C63Bf400eBC59CFfc";
const REVEAL_DELAY_BLOCKS = 28800; // ±6 jam di BSC (0,75 dtk/blok)

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address, "·", ethers.formatEther(bal), "BNB");

  // secret & commit: commit dipublikasikan dulu, secret dipakai untuk reveal nanti
  const secretPath = "/home/ubuntu/.pengupunk-secret.json";
  let secret;
  if (fs.existsSync(secretPath)) {
    secret = JSON.parse(fs.readFileSync(secretPath, "utf8")).secret;
  } else {
    secret = "0x" + crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, JSON.stringify({ secret, createdAt: new Date().toISOString() }, null, 1), { mode: 0o600 });
  }
  const commit = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
  console.log("commit:", commit);

  const P = await ethers.getContractFactory("Pengupunk");
  const c = await P.deploy(REGISTRY, TREASURY, REVEAL_DELAY_BLOCKS, commit);
  const tx = c.deploymentTransaction();
  console.log("deploy tx:", tx.hash);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  const rc = await tx.wait();
  console.log("alamat:", addr, "· blok", rc.blockNumber, "· gas", rc.gasUsed.toString());

  const revealBlock = Number(await c.revealBlock());
  const out = {
    chainId: 56,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    treasury: TREASURY,
    registry: REGISTRY,
    contract: addr,
    txHash: tx.hash,
    block: rc.blockNumber,
    gasUsed: rc.gasUsed.toString(),
    revealBlock,
    provenanceCommit: commit,
    args: [REGISTRY, TREASURY, String(REVEAL_DELAY_BLOCKS), commit],
    constants: {
      MAX_SUPPLY: 2222,
      MAX_PER_WALLET: 3,
      PRICE_FIRST: "0.001",
      PRICE_SECOND: "0.0005",
      FREE_QUOTA: 223,
    },
  };
  fs.writeFileSync("/home/ubuntu/projects/pengupunk/deployments/bsc.json", JSON.stringify(out, null, 1));
  console.log("catatan: deployments/bsc.json");
  console.log("revealBlock:", revealBlock, "(±", Math.round((REVEAL_DELAY_BLOCKS * 0.75) / 60), "menit)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
