// scripts/fund_deployer.mjs — kirim gas dari burner ke wallet deployer Pengupunk
import fs from "node:fs";
import { ethers } from "/home/ubuntu/projects/lodepass/node_modules/ethers/lib.esm/index.js";

const BURNER_KEY = "0x" + fs.readFileSync("/home/ubuntu/.burner-wallet/key", "utf8").trim();
const DEPLOYER = "0xaDe347a749764519000fE185b82850bF392b9a53";
const AMOUNT = process.env.AMOUNT || "0.0006";

const p = new ethers.JsonRpcProvider("https://bsc-dataseed.bnbchain.org", 56, { staticNetwork: true });
const w = new ethers.Wallet(BURNER_KEY, p);

const bal = await p.getBalance(w.address);
const fee = await p.getFeeData();
console.log("burner:", w.address, "saldo:", ethers.formatEther(bal), "BNB");
console.log("gasPrice:", fee.gasPrice ? ethers.formatUnits(fee.gasPrice, "gwei") + " gwei" : "?");

const value = ethers.parseEther(AMOUNT);
const gas = 21000n;
const cost = gas * (fee.gasPrice ?? 0n);
if (bal < value + cost) {
  console.log("SALDO KURANG. butuh", ethers.formatEther(value + cost));
  process.exit(1);
}
console.log("kirim:", AMOUNT, "BNB →", DEPLOYER, "· estimasi gas", ethers.formatEther(cost));
if (process.env.DRY !== "1") {
  const tx = await w.sendTransaction({ to: DEPLOYER, value });
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("status:", rc.status, "· blok", rc.blockNumber);
  console.log("deployer saldo:", ethers.formatEther(await p.getBalance(DEPLOYER)));
} else {
  console.log("DRY RUN — tidak dikirim");
}
