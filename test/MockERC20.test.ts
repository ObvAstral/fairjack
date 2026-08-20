import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("MockERC20", function () {
  async function deployToken() {
    const [owner, spender, recipient] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");

    return { token, owner, spender, recipient };
  }

  it("mints test tokens", async function () {
    const { token, owner } = await deployToken();
    const amount = ethers.parseEther("100");

    await token.mint(owner.address, amount);

    expect(await token.totalSupply()).to.equal(amount);
  });

  it("reports balances", async function () {
    const { token, recipient } = await deployToken();
    const amount = ethers.parseEther("25");

    await token.mint(recipient.address, amount);

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it("approves an allowance", async function () {
    const { token, owner, spender } = await deployToken();
    const amount = ethers.parseEther("10");

    await token.connect(owner).approve(spender.address, amount);

    expect(await token.allowance(owner.address, spender.address)).to.equal(amount);
  });

  it("transfers tokens", async function () {
    const { token, owner, recipient } = await deployToken();
    const amount = ethers.parseEther("8");
    await token.mint(owner.address, amount);

    await token.connect(owner).transfer(recipient.address, amount);

    expect(await token.balanceOf(owner.address)).to.equal(0n);
    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it("transfers tokens using an allowance", async function () {
    const { token, owner, spender, recipient } = await deployToken();
    const amount = ethers.parseEther("12");
    await token.mint(owner.address, amount);
    await token.connect(owner).approve(spender.address, amount);

    await token
      .connect(spender)
      .transferFrom(owner.address, recipient.address, amount);

    expect(await token.balanceOf(owner.address)).to.equal(0n);
    expect(await token.balanceOf(recipient.address)).to.equal(amount);
    expect(await token.allowance(owner.address, spender.address)).to.equal(0n);
  });
});
