// test/PenguMarket.test.js — list / buy / bid / royalti / tanpa admin
const { expect } = require("chai");
const { ethers } = require("hardhat");

const DELAY = 100;
const PRICE = ethers.parseEther("0.001");

async function deployAll() {
  const [deployer, treasury, alice, bob] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();

  const secret = ethers.keccak256(ethers.toUtf8Bytes("pengupunk-market-test"));
  const commit = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));

  const P = await ethers.getContractFactory("Pengupunk");
  const nft = await P.deploy(await reg.getAddress(), treasury.address, DELAY, commit);

  const M = await ethers.getContractFactory("PenguMarket");
  const market = await M.deploy(await nft.getAddress(), treasury.address);

  await reg.setAgent(alice.address, 1);
  await reg.setAgent(bob.address, 1);

  // alice mint keping pertama (gratis)
  await nft.connect(alice).mint(1, { value: 0 });
  return { nft, market, reg, deployer, treasury, alice, bob };
}

describe("PenguMarket", function () {
  it("list lalu buy: fee 2% + royalti 2,5% ke treasury, sisanya ke penjual", async function () {
    const { nft, market, treasury, alice, bob } = await deployAll();
    await nft.connect(alice).approve(await market.getAddress(), 1);
    await market.connect(alice).list(1, PRICE, 7);

    const l = await market.listing(1);
    expect(l.seller).to.equal(alice.address);
    expect(l.price).to.equal(PRICE);

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const aliceBefore = await ethers.provider.getBalance(alice.address);

    await market.connect(bob).buy(1, { value: PRICE });

    const fee = (PRICE * 200n) / 10000n;
    const royalty = (PRICE * 250n) / 10000n;
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    const aliceAfter = await ethers.provider.getBalance(alice.address);

    expect(treasuryAfter - treasuryBefore).to.equal(fee + royalty);
    expect(aliceAfter - aliceBefore).to.equal(PRICE - fee - royalty);
    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
  });

  it("menolak list tanpa approval", async function () {
    const { market, alice } = await deployAll();
    await expect(market.connect(alice).list(1, PRICE, 7)).to.be.revertedWithCustomError(market, "NotApproved");
  });

  it("menolak list oleh bukan pemilik", async function () {
    const { market, bob } = await deployAll();
    await expect(market.connect(bob).list(1, PRICE, 7)).to.be.revertedWithCustomError(market, "NotOwner");
  });

  it("menolak harga nol dan durasi tidak wajar", async function () {
    const { nft, market, alice } = await deployAll();
    await nft.connect(alice).approve(await market.getAddress(), 1);
    await expect(market.connect(alice).list(1, 0, 7)).to.be.revertedWithCustomError(market, "BadPrice");
    await expect(market.connect(alice).list(1, PRICE, 0)).to.be.revertedWithCustomError(market, "BadExpiry");
  });

  it("menolak bayar kurang / lebih dan membeli keping sendiri", async function () {
    const { nft, market, alice, bob } = await deployAll();
    await nft.connect(alice).approve(await market.getAddress(), 1);
    await market.connect(alice).list(1, PRICE, 7);
    await expect(market.connect(bob).buy(1, { value: PRICE - 1n })).to.be.revertedWithCustomError(market, "WrongPayment");
    await expect(market.connect(alice).buy(1, { value: PRICE })).to.be.revertedWithCustomError(market, "BuyerIsSeller");
    await expect(market.connect(bob).buy(2, { value: PRICE })).to.be.revertedWithCustomError(market, "NotListed");
  });

  it("bid: escrow masuk, bid lebih rendah ditolak, cancel mengembalikan dana", async function () {
    const { market, bob } = await deployAll();
    await market.connect(bob).bid(1, 7, { value: PRICE });
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(PRICE);

    const [, , , , dave] = await ethers.getSigners();
    await expect(market.connect(dave).bid(1, 7, { value: PRICE - 1n })).to.be.revertedWithCustomError(market, "BidTooLow");

    await market.connect(bob).cancelBid(1);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
  });

  it("acceptBid: penjual menerima dana escrow, fee + royalti dipotong", async function () {
    const { nft, market, treasury, alice, bob } = await deployAll();
    await market.connect(bob).bid(1, 7, { value: PRICE });
    await nft.connect(alice).approve(await market.getAddress(), 1);

    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const tx = await market.connect(alice).acceptBid(1);
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;

    const fee = (PRICE * 200n) / 10000n;
    const royalty = (PRICE * 250n) / 10000n;
    expect(await ethers.provider.getBalance(treasury.address) - treasuryBefore).to.equal(fee + royalty);
    expect((await ethers.provider.getBalance(alice.address)) - aliceBefore + gas).to.equal(PRICE - fee - royalty);
    expect(await nft.ownerOf(1)).to.equal(bob.address);
  });

  it("tidak punya owner/pause/withdraw dan fee terkunci 2%", async function () {
    const { market } = await deployAll();
    expect(await market.FEE_BPS()).to.equal(200n);
    expect(market.owner).to.equal(undefined);
    expect(market.withdraw).to.equal(undefined);
    expect(market.pause).to.equal(undefined);
  });
});
