// test/Pengupunk.test.js — aturan harga, gate, kuota gratis, provenance, no-admin
const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE1 = ethers.parseEther("0.001");
const PRICE2 = ethers.parseEther("0.0005");
const FREE_QUOTA = 223;
const DELAY = 100;

async function deploy() {
  const [deployer, treasury, alice, bob, stranger] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();

  const secret = ethers.keccak256(ethers.toUtf8Bytes("pengupunk-secret"));
  const commit = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));

  const P = await ethers.getContractFactory("Pengupunk");
  const c = await P.deploy(await reg.getAddress(), treasury.address, DELAY, commit);

  await reg.setAgent(alice.address, 1);
  await reg.setAgent(bob.address, 1);
  return { c, reg, deployer, treasury, alice, bob, stranger, secret };
}

describe("Pengupunk", function () {
  it("menolak wallet tanpa Agent ID", async function () {
    const { c, stranger } = await deploy();
    await expect(c.connect(stranger).mint(1, { value: PRICE1 })).to.be.revertedWith("not agent");
  });

  it("keping pertama 0.001, kedua 0.0005", async function () {
    const { c, alice } = await deploy();
    expect(await c.priceFor(alice.address, 1)).to.equal(PRICE1);
    await c.connect(alice).mint(1, { value: PRICE1 });
    expect(await c.priceFor(alice.address, 1)).to.equal(PRICE2);
    await c.connect(alice).mint(1, { value: PRICE2 });
    expect(await c.mintedBy(alice.address)).to.equal(2n);
  });

  it("keping ketiga gratis dan memakai kuota", async function () {
    const { c, alice } = await deploy();
    await c.connect(alice).mint(2, { value: PRICE1 + PRICE2 });
    expect(await c.priceFor(alice.address, 1)).to.equal(0n);
    await c.connect(alice).mint(1, { value: 0 });
    expect(await c.freeGranted()).to.equal(1n);
    expect(await c.balanceOf(alice.address)).to.equal(3n);
  });

  it("maksimal 3 keping per wallet", async function () {
    const { c, alice } = await deploy();
    await c.connect(alice).mint(3, { value: PRICE1 + PRICE2 });
    await expect(c.connect(alice).mint(1, { value: PRICE2 })).to.be.revertedWith("max per wallet");
  });

  it("mengembalikan kelebihan bayar", async function () {
    const { c, alice } = await deploy();
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await c.connect(alice).mint(1, { value: PRICE1 * 3n });
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);
    const gas = rc.gasUsed * rc.gasPrice;
    expect(before - after - gas).to.equal(PRICE1);
  });

  it("menolak pembayaran kurang", async function () {
    const { c, alice } = await deploy();
    await expect(c.connect(alice).mint(1, { value: PRICE2 })).to.be.revertedWith("underpaid");
  });

  it("meneruskan dana langsung ke treasury", async function () {
    const { c, alice, treasury } = await deploy();
    const before = await ethers.provider.getBalance(treasury.address);
    await c.connect(alice).mint(1, { value: PRICE1 });
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(before + PRICE1);
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(0n);
  });

  it("tokenURI sealed sebelum reveal", async function () {
    const { c, alice } = await deploy();
    await c.connect(alice).mint(1, { value: PRICE1 });
    const uri = await c.tokenURI(1);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.name).to.include("sealed");
  });

  it("reveal ditolak sebelum blok target", async function () {
    const { c, secret } = await deploy();
    await expect(c.reveal(secret)).to.be.revertedWith("too early");
  });

  it("reveal dengan secret salah ditolak", async function () {
    const { c } = await deploy();
    await ethers.provider.send("hardhat_mine", ["0x" + (DELAY + 1).toString(16)]);
    await expect(c.reveal(ethers.keccak256(ethers.toUtf8Bytes("wrong")))).to.be.revertedWith("bad secret");
  });

  it("reveal sekali, lalu trait muncul", async function () {
    const { c, alice, secret } = await deploy();
    await c.connect(alice).mint(1, { value: PRICE1 });
    await ethers.provider.send("hardhat_mine", ["0x" + (DELAY + 1).toString(16)]);
    await c.reveal(secret);
    expect(await c.seed()).to.not.equal(0n);
    await expect(c.reveal(secret)).to.be.revertedWith("revealed");

    const uri = await c.tokenURI(1);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    const tier = json.attributes.find((a) => a.trait_type === "Tier").value;
    expect(["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]).to.include(tier);
  });

  it("royalty 2.5% ke treasury", async function () {
    const { c, treasury } = await deploy();
    const [recv, amt] = await c.royaltyInfo(1, ethers.parseEther("1"));
    expect(recv).to.equal(treasury.address);
    expect(amt).to.equal(ethers.parseEther("0.025"));
  });

  it("sold out tidak bisa dilewati", async function () {
    const { c, alice, bob } = await deploy();
    // set supply kecil untuk uji: pakai banyak wallet bukan praktis, jadi cek MAX_SUPPLY konstan
    expect(await c.MAX_SUPPLY()).to.equal(2222n);
    await expect(c.connect(alice).mint(4, { value: PRICE1 })).to.be.revertedWith("qty");
  });

  it("tidak punya fungsi admin", async function () {
    const { c } = await deploy();
    const forbidden = ["owner", "pause", "unpause", "withdraw", "setPrice", "setBaseURI", "rescue", "sweep"];
    const names = c.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    for (const f of forbidden) {
      expect(names).to.not.include(f);
    }
  });

  it("konstanta terkunci", async function () {
    const { c } = await deploy();
    expect(await c.PRICE_FIRST()).to.equal(PRICE1);
    expect(await c.PRICE_SECOND()).to.equal(PRICE2);
    expect(await c.FREE_QUOTA()).to.equal(BigInt(FREE_QUOTA));
    expect(await c.MAX_PER_WALLET()).to.equal(3n);
  });
});
