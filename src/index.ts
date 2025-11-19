import { Context, Telegraf } from 'telegraf';
import { config } from './config';
import { closeDB, connectDB } from './services/db';
import * as common from './common';
import RaidService from './services/raid';
import XService from './services/x';
import { ChatMemberAdministrator } from 'telegraf/types';

const bot = new Telegraf(config.telegram.botToken);
var raidService: RaidService;

async function checkMessageSource(ctx: Context): Promise<boolean> {
    if (!ctx.chat || !ctx.from) {
        ctx.sendMessage('Unable to determine chat or user information.');
        return false;
    }
    if (ctx.chat.type === 'private') {
        ctx.sendMessage('The bot is only available the group.');
        return false;
    }
    if (ctx.chat.id !== config.telegram.targetGroupID) {
        ctx.sendMessage('This command can only be used in the group.');
        return false;
    }
    const member = await bot.telegram.getChatMember(ctx.chat.id, ctx.from!.id);
    if (member.status !== 'administrator' && member.status !== 'creator') {
        ctx.sendMessage('Only group administrators can start a raid.');
        return false;
    }
    if (config.telegram.ownerUserID && ctx.from!.id !== config.telegram.ownerUserID) {
        ctx.sendMessage('Only the bot owner can start a raid.');
        return false;
    }
    return true;
}

bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    // @ts-ignore
    if (msg && msg.pinned_message) {
        try {
            await ctx.deleteMessage(msg.message_id);
        } catch (error) {
            common.logError(`Failed to delete pinned message: ${error}`);
        }
    }

    return next();
});

bot.command('start', async (ctx) => {
    common.logInfo('Received /start command');
    if (ctx.chat.type === 'private') {
        ctx.sendMessage('The bot is only available the group.');
    } else {
        const commands = Object.entries(config.telegram.botCommands)
            .map(([cmd, desc]) => `/${cmd} - ${desc}`)
            .join('\n');
        ctx.sendMessage(
            `${config.telegram.botTitle}\n\n${config.telegram.botDescription}\n\nAvailable commands:\n${commands}`
        );
    }
});

bot.command('raid', async (ctx) => {
    common.logInfo('Received /raid command');
    if (!(await checkMessageSource(ctx))) {
        return;
    }
    if (raidService.isActive()) {
        ctx.reply('A raid is already active.');
        return;
    }

    const args = ctx.args;
    if (args.length == 0) {
        ctx.reply('Starting the raid...');
        await raidService.startRaid();
    } else {
        if (args.length != 5) {
            ctx.reply('Invalid number of arguments. Usage: /raid <post_url> <likes> <retweets> <replies> <bookmarks>');
            return;
        }
        const postURL = args[0];
        const likes = parseInt(args[1]);
        const retweets = parseInt(args[2]);
        const replies = parseInt(args[3]);
        const bookmarks = parseInt(args[4]);
        if (!XService.validatePostURL(postURL)) {
            ctx.reply('Invalid post URL. Please provide a valid X (Twitter) post URL.');
            return;
        }
        if (isNaN(likes) || isNaN(retweets) || isNaN(replies) || isNaN(bookmarks)) {
            ctx.reply('Invalid arguments. Likes, retweets, replies, and bookmarks must be numbers.');
            return;
        }
        ctx.reply(
            `Starting the raid on post ${postURL}\n\nLikes: ${likes}, Retweets: ${retweets}, Replies: ${replies}, Bookmarks: ${bookmarks}`
        );
        await raidService.startRaid({ postURL, likes, retweets, replies, bookmarks });
    }
});

bot.command('cancel', async (ctx) => {
    common.logInfo('Received /cancel command');
    if (!(await checkMessageSource(ctx))) {
        return;
    }
    if (!raidService.isActive()) {
        ctx.reply('No active raid to cancel.');
        return;
    }

    ctx.reply('Cancelling all raids and actions.');
    await raidService.cancelRaid();
});

async function checkBotInGroup(): Promise<boolean> {
    const group = config.telegram.targetGroupID;
    const botInfo = await bot.telegram.getMe();

    try {
        const member = await bot.telegram.getChatMember(group, botInfo.id);

        if (member.status !== 'administrator' && member.status !== 'creator') {
            throw new Error(`The Bot is not administrator in the target group: ${group}`);
        }
        const admin = member as ChatMemberAdministrator;
        if (
            !(admin.can_delete_messages && admin.can_change_info && admin.can_restrict_members && admin.can_manage_chat)
        ) {
            throw new Error(`The Bot does not have enough group permissions in the target group: ${group}`);
        }
        return true;
    } catch (err) {
        common.logError(`Failed to validate the Bot in the target group: ${err}`);
    }
    return false;
}

async function checkResourcePath(path: string): Promise<boolean> {
    const fs = await import('fs').then((mod) => mod.promises);
    try {
        const stats = await fs.stat(path);
        if (!stats.isDirectory()) {
            throw new Error(`${path} is not a directory`);
        }
        const files = await fs.readdir(path);
        if (files.length === 0) {
            throw new Error(`${path} is empty`);
        }
        return true;
    } catch (err) {
        common.logError(`Resource path check failed: ${err}`);
        return false;
    }
}

async function main() {
    const validPath = await checkResourcePath(config.resourcePath);
    const validBot = await checkBotInGroup();
    if (!validBot) {
        common.logError(`The Bot is not correctly set up in the target group`);
        process.exit(1);
    }
    if (!validPath) {
        common.logError(`Resource path is not correctly set up: ${config.resourcePath}`);
        process.exit(1);
    }

    common.logInfo('Connecting to the database...');
    await connectDB();

    common.logInfo('Initializing RaidService...');
    raidService = await RaidService.initialize(bot);

    common.logInfo('Starting the bot...');
    bot.launch(() => common.logInfo('Bot started successfully'));

    process.once('SIGINT', () => {
        bot.stop('SIGINT');
        raidService.cancelRaid();
        closeDB();
    });
    process.once('SIGTERM', () => {
        bot.stop('SIGTERM');
        raidService.cancelRaid();
        closeDB();
    });
}

main().catch((err) => {
    common.logError(`Failed to start the bot: ${err}`);
    process.exit(1);
});
