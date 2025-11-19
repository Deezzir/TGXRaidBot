import DBService, { IMetrics, IRaid, RaidStateEnum } from './db';
import * as common from '../common';
import { config } from '../config';
import { Telegraf } from 'telegraf';
import SolanaService from './solana';
import { readdirSync } from 'fs';
import { basename, extname } from 'path';
import XService from './x';

interface RaidState {
    active: boolean;
    currentRaid: IRaid | null;
    process: Promise<void> | null;
    currentInterval: number;
    stopRequested: boolean;
    oneShot: boolean;
}

interface RaidPost {
    postURL: string;
    likes: number;
    retweets: number;
    replies: number;
    bookmarks: number;
}

export default class RaidService {
    private state: RaidState;
    private bot: Telegraf;

    private constructor(bot: Telegraf, active = false, raid: IRaid | null = null) {
        this.bot = bot;

        this.state = {
            active,
            currentRaid: raid,
            process: null,
            currentInterval: config.raid.startInterval,
            stopRequested: false,
            oneShot: false
        };

        if (active && raid) {
            this.state.process = this.mainLoop().catch((err) =>
                common.logError(`RaidService mainLoop error (resume): ${err}`)
            );
        }

        common.logInfo(`RaidService initialized. Active: ${this.state.active}`);
    }

    static async initialize(bot: Telegraf): Promise<RaidService> {
        const currentRaid = await DBService.getActiveRaid();
        if (currentRaid) {
            common.logInfo(`Resuming active raid on post: ${currentRaid.postURL}`);
            return new RaidService(bot, true, currentRaid);
        }
        return new RaidService(bot);
    }

    isActive(): boolean {
        return this.state.active;
    }

    async startRaid(post?: RaidPost): Promise<void> {
        if (this.state.active || this.state.process) {
            common.logWarn('RaidService.startRaid called but raid is already running.');
            return;
        }

        if (post) {
            this.state.currentRaid = await this.useExistingPost(post);
            this.state.oneShot = true;
        }

        common.logInfo('RaidService.startRaid: starting main loop.');
        this.state.stopRequested = false;
        this.state.active = true;

        this.state.process = this.mainLoop()
            .catch((err) => {
                common.logError(`RaidService mainLoop error: ${err}`);
            })
            .finally(() => {
                this.state.active = false;
                this.state.process = null;
                this.state.stopRequested = false;
                common.logInfo('RaidService mainLoop finished.');
            });
    }

    async cancelRaid(): Promise<void> {
        common.logInfo('RaidService.cancelRaid: cancelling raid.');

        this.state.stopRequested = true;

        if (this.state.currentRaid) {
            const id = String(this.state.currentRaid._id);
            await DBService.updateRaid(id, {
                state: RaidStateEnum.Cancelled,
                endedAt: new Date()
            });
            common.logInfo(`Raid ${this.state.currentRaid.index} cancelled.`);
        }

        this.state.currentRaid = null;
        this.state.active = false;
    }

    private async mainLoop(): Promise<void> {
        common.logInfo('RaidService.mainLoop: started.');

        while (!this.state.stopRequested) {
            try {
                if (!this.state.currentRaid) {
                    this.state.currentRaid = (await this.createNextRaid()) || (await this.fetchNextRaid());
                    if (!this.state.currentRaid) {
                        common.logWarn('RaidService.mainLoop: no raid created, sleeping and retrying.');
                        await common.sleep(config.raid.errorInterval);
                        continue;
                    }
                }

                await this.countdown(5);
                await this.raidLoop(this.state.currentRaid);
                await this.updateCurrentInterval();
                this.state.currentRaid = null;

                if (this.state.stopRequested) break;
                if (this.state.oneShot) {
                    common.logInfo('RaidService.mainLoop: one-shot raid completed, exiting main loop.');
                    break;
                }

                common.logInfo(`RaidService.mainLoop: sleeping for ${this.state.currentInterval} ms before next raid.`);
                await this.sendTGMessage(
                    `Next block will start in ${Math.ceil(this.state.currentInterval / 1000 / 60)} minutes...`
                );
                await this.cancellableSleep(this.state.currentInterval);
            } catch (error) {
                common.logError(`RaidService.mainLoop iteration error: ${error}`);
                await common.sleep(config.raid.errorInterval);
            }
        }

        common.logInfo('RaidService.mainLoop: exit requested.');
    }

    private async raidLoop(raid: IRaid): Promise<void> {
        if (!raid.postURL) {
            common.logError('RaidService.raidLoop: called with raid without postURL.');
            return;
        }

        if (raid.state !== RaidStateEnum.Active) {
            common.logWarn(`RaidService.raidLoop: raid ${raid.index} is not Active (state=${raid.state}), skipping.`);
            return;
        }

        const raidTimeoutAt = new Date(raid.startedAt.getTime() + config.raid.timeout);
        let completed = false;
        let currentMessageID: number | null = null;
        let currentMetrics: IMetrics | null = null;

        common.logInfo(`RaidService.raidLoop: running raid #${raid.index} for post: ${raid.postURL}.`);

        while (new Date() < raidTimeoutAt && !this.state.stopRequested) {
            try {
                if (currentMessageID) await this.deleteMessage(currentMessageID);
                const postInfo = await XService.getPostInfo(raid.postURL);
                if (postInfo) {
                    currentMetrics = {
                        likes: postInfo.likes,
                        retweets: postInfo.retweets,
                        replies: postInfo.replies,
                        bookmarks: postInfo.bookmarks
                    };

                    currentMessageID = await this.sendRaidStatusMessage(raid, currentMetrics);
                    if (this.hasReachedTarget(raid.targetMetrics, currentMetrics)) {
                        completed = true;
                        break;
                    }
                }
                await common.sleep(config.raid.checkInterval);
            } catch (error) {
                common.logError(`RaidService.raidLoop error for raid #${raid.index}: ${error}`);
                await common.sleep(5000);
            }
        }

        if (currentMessageID && currentMetrics) {
            await this.deleteMessage(currentMessageID);
            const id = await this.sendRaidStatusMessage(raid, currentMetrics, completed, this.state.stopRequested);
            if (id) await this.pinTGMessage(id);
        }

        const id = String(raid._id);
        if (this.state.stopRequested) {
            await DBService.updateRaid(id, {
                state: RaidStateEnum.Cancelled,
                endedAt: new Date()
            });
            common.logInfo(`RaidService.raidLoop: raid ${raid.index} cancelled due to stopRequested.`);
            return;
        }

        if (completed) {
            await DBService.updateRaid(id, {
                state: RaidStateEnum.Completed,
                endedAt: new Date()
            });
            common.logInfo(`RaidService.raidLoop: raid ${raid.index} completed.`);
            await this.sendTGMessage(`<b>Block #${raid.index}</b> has reached target metrics! Executing buy-back...`);
            const tx = await SolanaService.buyBackToken();
            if (tx) {
                common.logInfo(`RaidService.raidLoop: txs: buyBackTX ${tx.buyTX}, addLiqTX: ${tx.addLiqTX}`);
                await this.sendBuyBackMessage(raid.index, tx);
                await DBService.updateRaid(id, { buyBackTX: tx.buyTX, addLiqTX: tx.addLiqTX });
            } else {
                common.logWarn(`RaidService.raidLoop: buyBackToken returned no transaction for raid ${raid.index}.`);
                await this.sendTGMessage(
                    `<b>Block #${raid.index}</b> completed successfully!\n\n` + `However, buy-back transaction failed.`
                );
            }
        } else {
            await DBService.updateRaid(id, {
                state: RaidStateEnum.Expired,
                endedAt: new Date()
            });
            common.logInfo(`RaidService.raidLoop: raid ${raid.index} expired.`);
            await this.sendTGMessage(`<b>Block #${raid.index}</b> has expired without reaching target metrics.`);
        }
    }

    private async sendBuyBackMessage(index: number, tx: { buyTX: string; addLiqTX: string | null }): Promise<void> {
        try {
            const { buyTX, addLiqTX } = tx;

            const payload =
                `<b>Block #${index} completed successfully</b>\n\n` +
                `Buy-back transaction:\n<code>${buyTX}</code>` +
                (addLiqTX ? `\n\nAdd-liquidity transaction:\n<code>${addLiqTX}</code>` : '');

            const buttons = [
                [
                    {
                        text: '🔗 View Buy-back TX',
                        url: `https://solscan.io/tx/${buyTX}`
                    }
                ]
            ];

            if (addLiqTX) {
                buttons[0].push({
                    text: '🔗 View Add-liquidity TX',
                    url: `https://solscan.io/tx/${addLiqTX}`
                });
            }

            const messageID = await this.sendTGMessage(payload, false, 'HTML', {
                inline_keyboard: buttons
            });
            if (messageID) await this.pinTGMessage(messageID);
        } catch (error) {
            common.logError(`RaidService.sendBuyBackMessage: ${error}`);
        }
    }

    private hasReachedTarget(target: IMetrics, current: IMetrics): boolean {
        return (
            current.likes >= Math.floor(target.likes) &&
            current.retweets >= Math.floor(target.retweets) &&
            current.replies >= Math.floor(target.replies) &&
            current.bookmarks >= Math.floor(target.bookmarks)
        );
    }

    private async updateCurrentInterval(): Promise<void> {
        try {
            const raid = await DBService.getLatestRaid();
            if (!raid) return;

            switch (raid.state) {
                case RaidStateEnum.Completed:
                    this.state.currentInterval = Math.max(
                        this.state.currentInterval / config.raid.intervalScalar,
                        config.raid.minInterval
                    );
                    break;
                case RaidStateEnum.Expired:
                    this.state.currentInterval = Math.min(
                        this.state.currentInterval * config.raid.intervalScalar,
                        config.raid.maxInterval
                    );
                    break;
                case RaidStateEnum.Cancelled:
                default:
                    break;
            }

            common.logInfo(`RaidService.updateCurrentInterval: new interval is ${this.state.currentInterval} ms`);
        } catch (error) {
            common.logError(`RaidService.updateCurrentInterval: ${error}`);
        }
    }

    private async getNextTargetMetrics(): Promise<IMetrics> {
        const defaultMetrics: IMetrics = {
            likes: config.raid.startLikes,
            retweets: config.raid.startRetweets,
            replies: config.raid.startReplies,
            bookmarks: config.raid.startBookmarks
        };

        try {
            const raid = await DBService.getLatestRaid();
            if (!raid) return defaultMetrics;

            switch (raid.state) {
                case RaidStateEnum.Completed:
                    return {
                        likes: Math.min(raid.targetMetrics.likes * config.raid.metricsScalar, config.raid.maxLikes),
                        retweets: Math.min(
                            raid.targetMetrics.retweets * config.raid.metricsScalar,
                            config.raid.maxRetweets
                        ),
                        replies: Math.min(
                            raid.targetMetrics.replies * config.raid.metricsScalar,
                            config.raid.maxReplies
                        ),
                        bookmarks: Math.min(
                            raid.targetMetrics.bookmarks * config.raid.metricsScalar,
                            config.raid.maxBookmarks
                        )
                    };
                case RaidStateEnum.Expired:
                    return {
                        likes: Math.max(raid.targetMetrics.likes / config.raid.metricsScalar, config.raid.minLikes),
                        retweets: Math.max(
                            raid.targetMetrics.retweets / config.raid.metricsScalar,
                            config.raid.minRetweets
                        ),
                        replies: Math.max(
                            raid.targetMetrics.replies / config.raid.metricsScalar,
                            config.raid.minReplies
                        ),
                        bookmarks: Math.max(
                            raid.targetMetrics.bookmarks / config.raid.metricsScalar,
                            config.raid.minBookmarks
                        )
                    };

                case RaidStateEnum.Cancelled:
                default:
                    return raid.targetMetrics;
            }
        } catch (error) {
            common.logError(`RaidService.getNextTargetMetrics: ${error}`);
            return defaultMetrics;
        }
    }

    private extractImageSource(
        media: {
            photoUrls: string[];
            videoUrls: string[];
        } | null
    ): string | undefined {
        if (!media) return undefined;
        if (media.photoUrls?.length > 0) return media.photoUrls[0];
        if (media.videoUrls?.length > 0) return undefined; // don't use video for now
        return undefined;
    }

    private async createRaidFromPost(params: {
        postURL: string;
        postImageSource?: string;
        baseMetrics: { likes: number; retweets: number; replies: number; bookmarks: number };
        extraMetrics: { likes: number; retweets: number; replies: number; bookmarks: number };
    }): Promise<IRaid | null> {
        return DBService.createRaid({
            postURL: params.postURL,
            postImageSource: params.postImageSource,
            state: RaidStateEnum.Active,
            startedAt: new Date(),
            targetMetrics: {
                likes: params.baseMetrics.likes + params.extraMetrics.likes,
                retweets: params.baseMetrics.retweets + params.extraMetrics.retweets,
                replies: params.baseMetrics.replies + params.extraMetrics.replies,
                bookmarks: params.baseMetrics.bookmarks + params.extraMetrics.bookmarks
            }
        });
    }

    private async useExistingPost(post: RaidPost): Promise<IRaid | null> {
        try {
            const postInfo = await XService.getPostInfo(post.postURL);
            if (!postInfo) return null;
            const postImageSource = this.extractImageSource(postInfo.media);

            return await this.createRaidFromPost({
                postURL: post.postURL,
                postImageSource,
                baseMetrics: post,
                extraMetrics: postInfo
            });
        } catch (error) {
            common.logError(`RaidService.useExistingPost: ${error}`);
            return null;
        }
    }

    private async fetchNextRaid(): Promise<IRaid | null> {
        try {
            const raidIndex = await DBService.getNextRaidIndex();
            const timeline = await XService.getUserPosts(config.x.username);
            const extraMetrics = await this.getNextTargetMetrics();

            const expectedPayload = `${config.projectName} engagement block #${raidIndex}`;

            for (const postInfo of timeline) {
                if (postInfo.text?.includes(expectedPayload)) {
                    const postImageSource = this.extractImageSource(postInfo.media);

                    const raid = await this.createRaidFromPost({
                        postURL: `https://x.com/${config.x.username}/status/${postInfo.id}`,
                        postImageSource,
                        baseMetrics: postInfo,
                        extraMetrics
                    });

                    if (raid)
                        common.logInfo(
                            `RaidService.fetchNextRaid: Found existing post for raid #${raid.index}: ${raid.postURL}`
                        );

                    return raid;
                }
            }
        } catch (error) {
            common.logError(`RaidService.fetchNextRaid: ${error}`);
        }

        return null;
    }

    private async createNextRaid(): Promise<IRaid | null> {
        try {
            const path = await this.getRandomPicture();
            if (!path) {
                common.logWarn('RaidService.createNextRaid: no available picture to create a new raid.');
                return null;
            }

            const raidIndex = await DBService.getNextRaidIndex();
            const targetMetrics = await this.getNextTargetMetrics();
            const imageBuffer = common.getImageBuffer(path);
            const payload = `${config.projectName} engagement block #${raidIndex}`;
            const mediaID = await XService.uploadMedia(imageBuffer, 'image/png');
            const postID = await XService.createPost(payload, [mediaID]);
            const postURL = `https://x.com/${config.x.username}/status/${postID}`;

            let raid = await DBService.createRaid({
                postImageSource: basename(path),
                targetMetrics,
                state: RaidStateEnum.Active,
                postURL: postURL,
                startedAt: new Date()
            });

            common.logInfo(`RaidService.createNextRaid: Created raid #${raid.index} with post ID: ${postID}`);
            return raid;
        } catch (error) {
            common.logError(`RaidService.createNextRaid: ${error}`);
        }
        return null;
    }

    private async sendRaidStatusMessage(
        raid: IRaid,
        metrics: IMetrics,
        completed: boolean = false,
        stopRequested: boolean = false
    ): Promise<number | null> {
        const expiresSecs = Math.max(
            0,
            Math.floor((raid.startedAt.getTime() + config.raid.timeout - new Date().getTime()) / 1000)
        );
        const statusPayload = stopRequested
            ? '<b>Block cancelled</b>'
            : completed
              ? '<b>Block completed</b>'
              : expiresSecs > 0
                ? `Block expires in <b>${expiresSecs}</b> seconds`
                : '<b>Block expired</b>';
        const likesIndicator = metrics.likes >= Math.floor(raid.targetMetrics.likes) ? '🟩' : '🟥';
        const retweetsIndicator = metrics.retweets >= Math.floor(raid.targetMetrics.retweets) ? '🟩' : '🟥';
        const repliesIndicator = metrics.replies >= Math.floor(raid.targetMetrics.replies) ? '🟩' : '🟥';
        const bookmarksIndicator = metrics.bookmarks >= Math.floor(raid.targetMetrics.bookmarks) ? '🟩' : '🟥';
        const postURL = raid.postURL!;

        const caption =
            `<b>Raid Status - Engagement Block #${raid.index}</b>\n\n` +
            `${likesIndicator} Likes <b>${metrics.likes} | ${Math.floor(raid.targetMetrics.likes)}</b>\n` +
            `${retweetsIndicator} Retweets <b>${metrics.retweets} | ${Math.floor(raid.targetMetrics.retweets)}</b>\n` +
            `${repliesIndicator} Replies <b>${metrics.replies} | ${Math.floor(raid.targetMetrics.replies)}</b>\n` +
            `${bookmarksIndicator} Bookmarks <b>${metrics.bookmarks} | ${Math.floor(raid.targetMetrics.bookmarks)}</b>\n\n` +
            `${statusPayload}\n\n` +
            `${postURL}\n\n` +
            `<b>Buybacks and liquidity adds trigger automatically after a successful raid</b>`;

        try {
            let messageID: number | null = null;
            const inlineKeyboard = [
                [
                    {
                        text: '🔗 View Post on X',
                        url: postURL
                    }
                ]
            ];
            if (!raid.postImageSource) {
                messageID = await this.sendTGMessage(caption, true, 'HTML', {
                    inline_keyboard: inlineKeyboard
                });
            } else if (raid.postImageSource.startsWith('http://') || raid.postImageSource.startsWith('https://')) {
                messageID = await this.sendTGImage(raid.postImageSource, 'url', caption, 'HTML', {
                    inline_keyboard: inlineKeyboard
                });
            } else {
                const imagePath = `${config.resourcePath}/${raid.postImageSource}`;
                messageID = await this.sendTGImage(imagePath, 'path', caption, 'HTML', {
                    inline_keyboard: inlineKeyboard
                });
            }
            if (messageID) await this.pinTGMessage(messageID);
            return messageID;
        } catch (error) {
            common.logError(`RaidService.sendRaidStatusMessage: ${error}`);
            return null;
        }
    }

    private async sendTGImage(
        source: string,
        imageSourceType: 'path' | 'url',
        caption: string,
        parseMode: 'Markdown' | 'HTML' = 'HTML',
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> }
    ): Promise<number | null> {
        try {
            if (imageSourceType === 'url') {
                const message = await this.bot.telegram.sendPhoto(
                    config.telegram.targetGroupID,
                    { url: source },
                    {
                        caption,
                        parse_mode: parseMode,
                        reply_markup
                    }
                );
                return message.message_id;
            } else if (imageSourceType === 'path') {
                const imageBuffer = common.getImageBuffer(source);
                const message = await this.bot.telegram.sendPhoto(
                    config.telegram.targetGroupID,
                    { source: imageBuffer },
                    {
                        caption,
                        parse_mode: parseMode,
                        reply_markup
                    }
                );
                return message.message_id;
            }
        } catch (error) {
            common.logError(`RaidService.sendTGImage: ${error}`);
        }
        return null;
    }

    private async sendTGMessage(
        text: string,
        preview: boolean = false,
        parseMode: 'Markdown' | 'HTML' = 'HTML',
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> }
    ): Promise<number | null> {
        try {
            const message = await this.bot.telegram.sendMessage(config.telegram.targetGroupID, text, {
                link_preview_options: {
                    is_disabled: !preview
                },
                parse_mode: parseMode,
                reply_markup
            });
            return message.message_id;
        } catch (error) {
            common.logError(`RaidService.sendTGMessage: ${error}`);
            return null;
        }
    }

    private async pinTGMessage(messageID: number): Promise<void> {
        try {
            await this.bot.telegram.pinChatMessage(config.telegram.targetGroupID, messageID, {
                disable_notification: false
            });
        } catch (error) {
            common.logError(`RaidService.pinTGMessage: ${error}`);
        }
    }

    private async deleteMessage(messageID: number): Promise<void> {
        try {
            await this.bot.telegram.deleteMessage(config.telegram.targetGroupID, messageID);
        } catch (error) {
            common.logError(`RaidService.deleteMessage: ${error}`);
        }
    }

    private async countdown(seconds: number): Promise<void> {
        try {
            for (let i = seconds; i > 0 && !this.state.stopRequested; i--) {
                const messageID = await this.sendTGMessage(`Starting in ${i} seconds...`);
                await common.sleep(1000);
                if (messageID) await this.deleteMessage(messageID);
            }
        } catch (error) {
            common.logError(`RaidService.countdown: ${error}`);
            throw new Error(`RaidService.countdown failed: ${error}`);
        }
    }

    private async cancellableSleep(ms: number): Promise<void> {
        const checkInterval = 1000;
        const iterations = Math.floor(ms / checkInterval);
        const remainder = ms % checkInterval;

        for (let i = 0; i < iterations; i++) {
            if (this.state.stopRequested) {
                common.logInfo('RaidService.cancellableSleep: sleep interrupted by stop request.');
                return;
            }
            await common.sleep(checkInterval);
        }

        if (remainder > 0 && !this.state.stopRequested) await common.sleep(remainder);
    }

    private async getRandomPicture(): Promise<string | null> {
        try {
            const images = readdirSync(config.resourcePath).filter((file) => extname(file) === '.png');
            const usedImages = await DBService.getUsedPostImageFiles();
            const usedImagesSet = new Set(usedImages);
            const availableImages = images.filter((img) => !usedImagesSet.has(img));
            common.logInfo(
                `RaidService.getRandomPicture: ${availableImages.length}/${images.length} images available.`
            );

            if (availableImages.length === 0) {
                common.logWarn('RaidService.getRandomPicture: no available images left to post.');
                return null;
            }

            const randomIndex = Math.floor(Math.random() * availableImages.length);
            const selectedImage = availableImages[randomIndex];

            return `${config.resourcePath}/${selectedImage}`;
        } catch (error) {
            common.logError(`RaidService.getRandomPicture: ${error}`);
            throw new Error(`RaidService.getRandomPicture failed: ${error}`);
        }
    }
}
