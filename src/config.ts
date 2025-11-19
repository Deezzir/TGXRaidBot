import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { Keypair, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';

function getEnvvar(var_name: string, default_value: string = ''): any {
    const variable = process.env[var_name] || default_value;
    if (!variable) {
        console.error(`${var_name} is not set`);
        process.exit(1);
    }
    return variable;
}

export enum Environment {
    Development = 'development',
    Production = 'production'
}

// Config
export const config = {
    env: getEnvvar('NODE_ENV', 'development') as Environment,
    telegram: {
        botToken: getEnvvar('BOT_TOKEN'),
        botTitle: 'Raid Bot',
        botDescription: 'The bot for Twitter raids on Telegram.',
        botCommands: {
            raid: 'Start the raid',
            cancel: 'Cancel all current raids and actions'
        },
        targetGroupID: parseInt(getEnvvar('TARGET_GROUP_ID'))
    },
    solana: {
        heliusAPIKey: getEnvvar('HELIUS_API_KEY'),
        devWalletKeypair: Keypair.fromSecretKey(base58.decode(getEnvvar('DEV_KEYPAIR'))),
        token: new PublicKey(getEnvvar('TOKEN_MINT')),
        buyBackPercent: parseFloat(getEnvvar('BUYBACK_PERCENT', '0.05'))
    },
    raid: {
        checkInterval: parseInt(getEnvvar('RAID_CHECK_INTERVAL', '15')) * 1000,
        timeout: parseInt(getEnvvar('RAID_TIMEOUT', '600')) * 1000,
        startInterval: parseInt(getEnvvar('RAID_START_INTERVAL', '600')) * 1000,
        maxInterval: parseInt(getEnvvar('RAID_MAX_INTERVAL', '1800')) * 1000,
        minInterval: parseInt(getEnvvar('RAID_MIN_INTERVAL', '300')) * 1000,
        intervalScalar: parseFloat(getEnvvar('RAID_INTERVAL_SCALAR', '1.25')),
        metricsScalar: parseFloat(getEnvvar('RAID_METRICS_SCALAR', '1.25')),
        startLikes: parseInt(getEnvvar('RAID_START_LIKES', '6')),
        startRetweets: parseInt(getEnvvar('RAID_START_RETWEETS', '2')),
        startReplies: parseInt(getEnvvar('RAID_START_REPLIES', '1')),
        startBookmarks: parseInt(getEnvvar('RAID_START_BOOKMARKS', '4')),
        minLikes: parseInt(getEnvvar('RAID_MIN_LIKES', '3')),
        minRetweets: parseInt(getEnvvar('RAID_MIN_RETWEETS', '1')),
        minReplies: parseInt(getEnvvar('RAID_MIN_REPLIES', '1')),
        minBookmarks: parseInt(getEnvvar('RAID_MIN_BOOKMARKS', '2')),
        maxLikes: parseInt(getEnvvar('RAID_MAX_LIKES', '28')),
        maxRetweets: parseInt(getEnvvar('RAID_MAX_RETWEETS', '5')),
        maxReplies: parseInt(getEnvvar('RAID_MAX_REPLIES', '19')),
        maxBookmarks: parseInt(getEnvvar('RAID_MAX_BOOKMARKS', '15'))
    },
    x: {
        APIKey: getEnvvar('X_API_KEY'),
        APISecretKey: getEnvvar('X_API_SECRET_KEY'),
        AccessToken: getEnvvar('X_ACCESS_TOKEN'),
        AccessTokenSecret: getEnvvar('X_ACCESS_TOKEN_SECRET'),
        RapidApiURL: 'https://twitter-api45.p.rapidapi.com',
        RapidApiHeaders: {
            'x-rapidapi-key': getEnvvar('X_RAPIDAPI_KEY'),
            'x-rapidapi-host': 'twitter-api45.p.rapidapi.com'
        },
        username: getEnvvar('X_TARGET_USERNAME')
    },
    db: {
        mongodbURI: getEnvvar('MONGODB_URI', 'mongodb://root:example@localhost:27017') as string,
        dbName: getEnvvar('DB_NAME', 'raid-bot') as string
    },
    resourcePath: getEnvvar('RESOURCE_PATH', './resources') as string
};
