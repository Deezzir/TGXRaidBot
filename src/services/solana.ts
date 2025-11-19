import { getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PumpSdk } from '@pump-fun/pump-sdk';
import { buyQuoteInput, OnlinePumpAmmSdk, PUMP_AMM_PROGRAM_ID, PumpAmmSdk } from '@pump-fun/pump-swap-sdk';
import { config } from '../config';
import { Helius, PriorityLevel } from 'helius-sdk';
import * as common from '../common';
import bs58 from 'bs58';
import BN from 'bn.js';
import {
    AddressLookupTableAccount,
    Commitment,
    ComputeBudgetProgram,
    Finality,
    LAMPORTS_PER_SOL,
    PublicKey,
    RpcResponseAndContext,
    Signer,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction
} from '@solana/web3.js';

type PriorityOptions = {
    accounts?: string[];
    transaction?: {
        instructions: TransactionInstruction[];
        signers: Signer[];
    };
    priority_level?: PriorityLevel;
};

const PUMP_AMM_STATE_HEADER = new Uint8Array([241, 154, 109, 4, 17, 177, 109, 188]);

class SolanaService {
    private helius = new Helius(config.solana.heliusAPIKey);
    private commitment: Commitment = 'confirmed';
    private connection = this.helius.connection;
    private onlinePump = new OnlinePumpSdk(this.connection);
    private offlinePump = new PumpSdk();
    private onlinePumpAMM = new OnlinePumpAmmSdk(this.connection);
    private offlinePumpAMM = new PumpAmmSdk();
    private tokenProgram = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    private slippage = 5; // .5%

    async buyBackToken(): Promise<{ buyTX: string; addLiqTX: string | null } | null> {
        try {
            const claimTX = await this.claimDevRewards();
            if (!claimTX) {
                common.logWarn(`SolanaService.buyBackToken: No rewards to claim.`);
            }
            common.logInfo(`SolanaService.buyBackToken: Claimed dev rewards: ${claimTX}`);

            const buyAmount = (await this.getDevBalance()) * config.solana.buyBackPercent;
            if (buyAmount <= 0) {
                common.logWarn(`SolanaService.buyBackToken: Insufficient balance to buy back tokens.`);
                return null;
            }
            common.logInfo(`SolanaService.buyBackToken: Buying back tokens with ${buyAmount} SOL.`);
            const buyTX = await this.buyToken(buyAmount);
            if (!buyTX) {
                common.logWarn(`SolanaService.buyBackToken: Buy token transaction failed.`);
                return null;
            }

            const liqAmount = await this.calculateAddLiqAmount(buyAmount);
            common.logInfo(`SolanaService.buyBackToken: Adding liquidity with ${liqAmount} SOL.`);
            const addLiqTX = await this.addLiquidity(liqAmount);
            if (!addLiqTX) {
                common.logWarn(`SolanaService.buyBackToken: Add liquidity transaction not completed.`);
                return { buyTX, addLiqTX: null };
            }
            return { buyTX, addLiqTX };
        } catch (error) {
            common.logError(`SolanaService.buyBackToken: ${error}`);
        }
        return null;
    }

    private getMarketCap(quote_reserves: BN, base_reserves: BN, supply: BN, solPriceUSD: number): number {
        const TOKEN_DECIMALS = 6;
        const price_sol =
            Number(quote_reserves) / LAMPORTS_PER_SOL / (Number(base_reserves) / Math.pow(10, TOKEN_DECIMALS));
        const mcap_sol = (price_sol * Number(supply)) / Math.pow(10, TOKEN_DECIMALS);
        return mcap_sol * solPriceUSD;
    }

    private async calculateAddLiqAmount(buyAmount: number) {
        try {
            let mc: number = 0;

            const solPriceUSD = await this.getSolanaPriceUSD();
            const user = config.solana.devWalletKeypair.publicKey;
            const mint = config.solana.token;
            const poolKey = await this.getAMMFromMint(config.solana.token);
            const supply = await this.connection.getTokenSupply(mint);
            if (poolKey) {
                const { pool } = await this.onlinePumpAMM.swapSolanaState(poolKey, user);
                const tokenReserves = await this.getVaultBalance(pool.poolBaseTokenAccount);
                const solReserves = await this.getVaultBalance(pool.poolQuoteTokenAccount);
                mc = this.getMarketCap(solReserves, tokenReserves, new BN(supply.value.amount), solPriceUSD);
            } else {
                const { bondingCurve } = await this.onlinePump.fetchBuyState(mint, user);
                mc = this.getMarketCap(
                    bondingCurve.virtualSolReserves,
                    bondingCurve.virtualTokenReserves,
                    new BN(supply.value.amount),
                    solPriceUSD
                );
            }
            common.logInfo(`SolanaService.calculateAddLiqAmount: Market Cap is $${mc.toLocaleString()}`);
            if (mc < 100_000) {
                return buyAmount * config.solana.addLiqPercent99k;
            } else if (mc >= 100_000 && mc < 1_000_000) {
                return buyAmount * config.solana.addLiqPercent999k;
            } else {
                return buyAmount * config.solana.addLiqPercent1000k;
            }
        } catch (error) {
            common.logError(`SolanaService.calculateAddLiqAmount: ${error}`);
        }

        return buyAmount * config.solana.addLiqPercent99k;
    }

    private async getVaultBalance(account: PublicKey): Promise<BN> {
        try {
            const balance = await this.connection.getTokenAccountBalance(account, this.commitment);
            return new BN(balance.value.amount);
        } catch (error) {
            common.logError(`SolanaService.getVaultBalance: ${error}`);
        }
        return new BN(0);
    }

    private async getSolanaPriceUSD(): Promise<number> {
        return fetch(`https://frontend-api-v3.pump.fun/sol-price`)
            .then((response) => response.json())
            .then((data) => {
                if (!data || data.statusCode !== undefined) return 0.0;
                return data.solPrice;
            })
            .catch((err) => {
                common.logError(`SolanaService.getSolanaPriceUSD: ${err}`);
                return 0.0;
            });
    }

    private async claimDevRewards(): Promise<string | null> {
        try {
            const claimInstructions = await this.onlinePump.collectCoinCreatorFeeInstructions(
                config.solana.devWalletKeypair.publicKey
            );
            if (claimInstructions.length === 0) return null;
            const claimTX = await this.retrySendTX(
                claimInstructions,
                [config.solana.devWalletKeypair],
                PriorityLevel.HIGH
            );
            if (!claimTX) return null;
            return String(claimTX);
        } catch (error) {
            common.logError(`SolanaService.claimDevRewardsInstructions: ${error}`);
        }
        return null;
    }

    private async buyToken(buyAmount: number): Promise<string | null> {
        try {
            const buyInstructions = await this.buyTokenInstructions(buyAmount);
            if (buyInstructions.length === 0) return null;
            const buyTX = await this.retrySendTX(buyInstructions, [config.solana.devWalletKeypair], PriorityLevel.HIGH);
            if (!buyTX) return null;
            return String(buyTX);
        } catch (error) {
            common.logError(`SolanaService.buyToken: ${error}`);
        }
        return null;
    }

    private async buyTokenInstructions(amount: number): Promise<TransactionInstruction[]> {
        if (amount <= 0) return [];

        try {
            const qoute = new BN(amount * 10 ** 9);
            const user = config.solana.devWalletKeypair.publicKey;
            const mint = config.solana.token;
            const global = await this.onlinePump.fetchGlobal();
            const feeConfig = await this.onlinePump.fetchFeeConfig();
            const mintSupply = await this.connection.getTokenSupply(mint);

            const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
                await this.onlinePump.fetchBuyState(mint, user);

            if (!bondingCurve.complete) {
                return await this.offlinePump.buyInstructions({
                    global,
                    bondingCurveAccountInfo,
                    bondingCurve,
                    associatedUserAccountInfo,
                    mint,
                    user,
                    solAmount: qoute,
                    amount: getBuyTokenAmountFromSolAmount({
                        global,
                        bondingCurve,
                        amount: qoute,
                        feeConfig,
                        mintSupply: new BN(mintSupply.value.amount)
                    }),
                    slippage: this.slippage,
                    tokenProgram: this.tokenProgram
                });
            } else {
                const poolKey = await this.getAMMFromMint(mint);
                if (!poolKey) throw new Error('No AMM pool found for the given mint.');
                const swapSolanaState = await this.onlinePumpAMM.swapSolanaState(poolKey, user);
                const { globalConfig, pool, poolBaseAmount, poolQuoteAmount, baseMintAccount, baseMint } =
                    swapSolanaState;

                const { maxQuote, base } = buyQuoteInput({
                    quote: qoute,
                    slippage: this.slippage,
                    baseReserve: poolBaseAmount,
                    quoteReserve: poolQuoteAmount,
                    baseMintAccount,
                    baseMint,
                    coinCreator: pool.coinCreator,
                    creator: pool.creator,
                    feeConfig,
                    globalConfig
                });

                return await this.offlinePumpAMM.buyInstructions(swapSolanaState, base, maxQuote);
            }
        } catch (error) {
            common.logError(`SolanaService.buyTokenInstructions: ${error}`);
        }
        return [];
    }

    private async addLiquidity(amount: number): Promise<string | null> {
        if (amount <= 0) return null;

        try {
            const addLiqInstructions = await this.addLiquidityInstructions(amount);
            if (addLiqInstructions.length === 0) {
                common.logInfo(`SolanaService.buyBackToken: No add liquidity instructions generated.`);
                return null;
            }
            const addLiqTX = await this.retrySendTX(
                addLiqInstructions,
                [config.solana.devWalletKeypair],
                PriorityLevel.HIGH
            );
            if (!addLiqTX) {
                common.logInfo(`SolanaService.buyBackToken: Add liquidity transaction failed.`);
                return null;
            }
            return String(addLiqTX);
        } catch (error) {
            common.logError(`SolanaService.addLiquidityInstructions: ${error}`);
        }
        return null;
    }

    private async addLiquidityInstructions(amount: number): Promise<TransactionInstruction[]> {
        try {
            const quote = new BN(amount * 10 ** 9);
            const user = config.solana.devWalletKeypair.publicKey;
            const mint = config.solana.token;
            const poolKey = await this.getAMMFromMint(mint);
            if (!poolKey) {
                common.logInfo(`SolanaService.addLiquidityInstructions: No AMM pool found for the given mint.`);
                return [];
            }

            const liquiditySolanaState = await this.onlinePumpAMM.liquiditySolanaState(poolKey, user);
            const { lpToken } = this.offlinePumpAMM.depositQuoteInput(liquiditySolanaState, quote, this.slippage);
            return await this.offlinePumpAMM.depositInstructions(liquiditySolanaState, lpToken, this.slippage);
        } catch (error) {
            common.logError(`SolanaService.addLiquidityInstructions: ${error}`);
        }
        return [];
    }

    private async retrySendTX(
        instructions: TransactionInstruction[],
        signers: Signer[],
        priority?: PriorityLevel,
        alts?: AddressLookupTableAccount[],
        retries: number = 5,
        intervalMs: number = 1000
    ): Promise<String | null> {
        while (retries > 0) {
            try {
                return await this.sendTX(instructions, signers, priority, alts);
            } catch (error) {
                common.logError(`SolanaService.retrySendTX attempt failed: ${error}`);
                retries--;
            }
            await common.sleep(intervalMs * (retries + 1));
        }
        return null;
    }

    private async sendTX(
        instructions: TransactionInstruction[],
        signers: Signer[],
        priority?: PriorityLevel,
        alts?: AddressLookupTableAccount[]
    ): Promise<String> {
        const tx_instructions = instructions.filter(Boolean);
        if (instructions.length === 0) throw new Error(`No instructions provided.`);
        if (signers.length === 0) throw new Error(`No signers provided.`);

        const fee = await this.getPriorityFee({
            priority_level: priority,
            transaction: { instructions: tx_instructions, signers }
        });
        tx_instructions.unshift(
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: fee
            }),
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 1_600_000
            })
        );

        const ctx = await this.connection.getLatestBlockhashAndContext(this.commitment);
        const versionedTX = this.createVersionedTX(signers, tx_instructions, ctx, alts);
        const signature = await this.connection.sendTransaction(versionedTX, {
            skipPreflight: false,
            preflightCommitment: this.commitment,
            maxRetries: 0
        });
        await this.checkTransactionStatus(signature, ctx);
        return signature;
    }

    private createVersionedTX(
        signers: Signer[],
        instructions: TransactionInstruction[],
        ctx: RpcResponseAndContext<Readonly<{ blockhash: string; lastValidBlockHeight: number }>>,
        alts?: AddressLookupTableAccount[]
    ): VersionedTransaction {
        if (instructions.length === 0) throw new Error(`No instructions provided.`);
        if (signers.length === 0) throw new Error(`No signers provided.`);

        const versionedTX = new VersionedTransaction(
            new TransactionMessage({
                payerKey: signers[0].publicKey,
                recentBlockhash: ctx.value.blockhash,
                instructions: instructions
            }).compileToV0Message(alts)
        );
        versionedTX.sign(signers);
        return versionedTX;
    }

    private async checkTransactionStatus(
        signature: string,
        context: RpcResponseAndContext<Readonly<{ blockhash: string; lastValidBlockHeight: number }>>,
        finality: Finality = 'confirmed'
    ): Promise<void> {
        const retry_interval = 1000;
        while (true) {
            const { value: status } = await this.connection.getSignatureStatus(signature);

            if (status && status.confirmationStatus === finality) {
                const tx = await this.connection.getTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: finality
                });
                if (tx) {
                    if (tx.meta?.err === null) return;
                    if (tx.meta?.err !== null)
                        throw new Error(`Transaction failed with an error | Signature: ${signature} `);
                }
            }

            const isExpired = await this.isBlockhashExpired(context.value.lastValidBlockHeight);
            if (isExpired) throw new Error('Blockhash has expired.');

            await common.sleep(retry_interval);
        }
    }

    private async isBlockhashExpired(lastValidBlockHeight: number): Promise<boolean> {
        let currentBlockHeight = await this.connection.getBlockHeight(this.commitment);
        return lastValidBlockHeight - currentBlockHeight < 0;
    }

    private async getPriorityFee(priorityOpts: PriorityOptions): Promise<number> {
        let encoded_tx: string | undefined;

        if (priorityOpts.transaction) {
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
            const tx = new Transaction({
                blockhash: blockhash,
                lastValidBlockHeight: lastValidBlockHeight,
                feePayer: priorityOpts.transaction.signers[0].publicKey
            }).add(...priorityOpts.transaction.instructions);
            encoded_tx = bs58.encode(tx.serialize({ verifySignatures: false, requireAllSignatures: false }));
        }

        const response = await this.helius.rpc.getPriorityFeeEstimate({
            transaction: encoded_tx,
            accountKeys: priorityOpts.accounts,
            options: {
                priorityLevel: priorityOpts.priority_level,
                recommended: priorityOpts.priority_level === undefined ? true : undefined
            }
        });
        return Math.floor(response.priorityFeeEstimate || 0);
    }

    private async getAMMFromMint(mint: PublicKey): Promise<PublicKey | null> {
        try {
            const [amm] = await this.connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, {
                filters: [
                    {
                        memcmp: {
                            offset: 43,
                            bytes: mint.toBase58()
                        }
                    },
                    {
                        memcmp: {
                            offset: 0,
                            bytes: bs58.encode(PUMP_AMM_STATE_HEADER)
                        }
                    }
                ],
                commitment: this.commitment
            });
            return amm.pubkey;
        } catch (error) {
            return null;
        }
    }

    private async getDevBalance(): Promise<number> {
        try {
            const balance = await this.connection.getBalance(config.solana.devWalletKeypair.publicKey, this.commitment);
            return balance / LAMPORTS_PER_SOL;
        } catch (error) {
            common.logError(`RaidService.getDevBalance: ${error}`);
            return 0;
        }
    }
}

export default new SolanaService();
