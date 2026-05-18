import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BinanceAdapter } from "@/lib/exchange/binance";

// Common crypto name map
const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana",
  XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche",
  DOT: "Polkadot", MATIC: "Polygon", LINK: "Chainlink", UNI: "Uniswap",
  ATOM: "Cosmos", LTC: "Litecoin", NEAR: "NEAR", APT: "Aptos",
  ARB: "Arbitrum", OP: "Optimism", PEPE: "Pepe", SHIB: "Shiba Inu",
  SUI: "Sui", SEI: "Sei", TIA: "Celestia", WIF: "dogwifhat",
  FET: "Fetch.ai", INJ: "Injective", STX: "Stacks", RUNE: "THORChain",
};

// POST /api/exchange/sync — sync all exchange accounts
export async function POST() {
  const accounts = await prisma.exchangeAccount.findMany();

  if (accounts.length === 0) {
    return NextResponse.json({ error: "没有配置交易所账号" }, { status: 400 });
  }

  const results: { account: string; spot: number; futures: number; futuresBalance: number; errors: string[] }[] = [];

  for (const account of accounts) {
    const result = { account: account.name, spot: 0, futures: 0, futuresBalance: 0, errors: [] as string[] };

    // Delete previous synced positions for this account
    await prisma.position.deleteMany({
      where: { exchangeAccountId: account.id },
    });

    if (account.exchange === "binance") {
      const adapter = new BinanceAdapter({
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
      });

      // Sync spot balances
      try {
        const balances = await adapter.getSpotBalances();
        // Only sync non-dust balances (filter out stablecoins too)
        const significant = balances.filter(
          (b) => b.quantity > 0.001 && !["USDT", "BUSD", "USDC", "FDUSD"].includes(b.asset)
        );

        for (const bal of significant) {
          await prisma.position.create({
            data: {
              symbol: bal.asset,
              name: CRYPTO_NAMES[bal.asset] || bal.asset,
              market: "crypto",
              quantity: bal.quantity,
              costPrice: 0, // Spot cost basis unknown from API, use 0
              direction: null,
              exchangeAccountId: account.id,
            },
          });
          result.spot++;
        }
      } catch (err) {
        result.errors.push(`现货同步失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Sync futures positions
      try {
        const positions = await adapter.getFuturesPositions();

        for (const pos of positions) {
          await prisma.position.create({
            data: {
              symbol: pos.baseAsset,
              name: `${CRYPTO_NAMES[pos.baseAsset] || pos.baseAsset} ${pos.direction === "long" ? "多" : "空"}`,
              market: "crypto",
              quantity: pos.quantity,
              costPrice: pos.entryPrice,
              direction: pos.direction,
              leverage: pos.leverage,
              margin: pos.margin,
              liquidationPrice: pos.liquidationPrice,
              unrealizedPnl: pos.unrealizedPnl,
              entryPrice: pos.entryPrice,
              exchangeAccountId: account.id,
            },
          });
          result.futures++;
        }
      } catch (err) {
        result.errors.push(`合约同步失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Fetch futures wallet balance
      try {
        result.futuresBalance = await adapter.getFuturesBalance();
      } catch {}
    } else {
      result.errors.push(`${account.exchange} 暂不支持自动同步`);
    }

    results.push(result);
  }

  return NextResponse.json({ results });
}
