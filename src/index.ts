import { Telegraf } from 'telegraf';
import { config } from './config';
import { closeDB, connectDB } from './services/db';
import * as common from './common';
import RaidService from './services/raid';

const bot = new Telegraf(config.telegram.botToken);
var raidService: RaidService;

bot.command('start', async (ctx) => {
    common.logInfo('Received /start command');
    if (ctx.chat.type === 'private') {
        ctx.sendMessage('The bot is only available the group.');
    } else {
        const commands = Object.entries(config.telegram.botCommands)
            .map(([cmd, desc]) => `/${cmd} - ${desc}`)
            .join('\n');
        ctx.sendMessage(
            `${config.telegram.botTitle}\n\n${config.telegram.botDescription}\n\nAvailable commands:\n${commands}\n${config.telegram.botTutorial}`
        );
    }
});

bot.command('raid', async (ctx) => {
    common.logInfo('Received /raid command');
    if (ctx.chat.type === 'private') {
        ctx.sendMessage('The bot is only available the group.');
        return;
    }
    if (ctx.chat.id !== config.telegram.targetGroupID) {
        ctx.sendMessage('This command can only be used in the group.');
        return;
    }
    ctx.reply('Starting the raid...');
    await raidService.startRaid();
});

bot.command('cancel', async (ctx) => {
    common.logInfo('Received /cancel command');
    if (ctx.chat.type === 'private') {
        ctx.sendMessage('The bot is only available the group.');
        return;
    }
    if (ctx.chat.id !== config.telegram.targetGroupID) {
        ctx.sendMessage('This command can only be used in the group.');
        return;
    }
    ctx.reply('Cancelling all raids and actions.');
    await raidService.cancelRaid();
});

async function main() {
    common.logInfo('Connecting to the database...');
    await connectDB();
    common.logInfo('Database connected.');

    common.logInfo('Initializing RaidService...');
    raidService = await RaidService.initialize();
    common.logInfo('RaidService initialized.');

    common.logInfo('Starting the bot...');
    bot.launch();
    common.logInfo('Bot started successfully');

    process.once('SIGINT', () => {
        bot.stop('SIGINT');
        closeDB();
    });
    process.once('SIGTERM', () => {
        bot.stop('SIGTERM');
        closeDB();
    });
}

main().catch((err) => {
    common.logError(`Failed to start the bot: ${err}`);
    process.exit(1);
});
