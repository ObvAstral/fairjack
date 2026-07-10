export const mockTokenAbi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

export const fairJackPoolAbi = [
  "function poolBalance() view returns (uint256)",
  "function lockedLiquidity() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function sharesOf(address user) view returns (uint256)",
  "function getAvailableLiquidity() view returns (uint256)",
  "function getSharePrice() view returns (uint256)",
  "function depositToHousePool(uint256 amount)",
  "function withdrawFromHousePool(uint256 shares)",
] as const;
