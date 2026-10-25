// scripts/deploy_market.js — deploy PenguMarket dari wallet treasury
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const key = process.env.TREASURY_KEY;
  if (!key) throw new Error("TREASURY_KEY belum di-set");

  const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC || "https://bsc-dataseed.bnbchain.org", 56, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  console.log("deployer:", wallet.address, "·", ethers.formatEther(await provider.getBalance(wallet.address)), "BNB");

  const dep = JSON.parse(fs.readFileSync("deployments/bsc.json", "utf8"));
  const nft = dep.contract;
  const treasury = wallet.address;

  const M = await ethers.getContractFactory("PenguMarket", wallet);
  const market = await M.deploy(nft, treasury);
  await market.waitForDeployment();
  const addr = await market.getAddress();
  const rc = await market.deploymentTransaction().wait();

  console.log("NFT:", nft);
  console.log("market:", addr);
  console.log("tx:", market.deploymentTransaction().hash, "· blok", rc.blockNumber, "· gas", rc.gasUsed.toString());

  const out = { ...dep, market: addr, marketDeployer: wallet.address, marketTx: market.deploymentTransaction().hash, marketBlock: rc.blockNumber };
  fs.writeFileSync("deployments/bsc.json", JSON.stringify(out, null, 2));
  console.log("catat: deployments/bsc.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
