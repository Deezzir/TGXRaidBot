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
        botHandle: 'alpha_raidbot',
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
        buyBackPercent: 0.05
    },
    raid: {
        checkInterval: 15 * 1000,
        timeout: 10 * 60 * 1000, // 10 minutes
        startInterval: 10 * 60 * 1000, // 10 minutes
        maxInterval: 30 * 60 * 1000, // 30 minutes
        minInterval: 5 * 60 * 1000, // 5 minutes
        intervalScalar: 1.25,
        metricsScalar: 1.25,
        startLikes: 6,
        startRetweets: 2,
        startReplies: 1,
        startBookmarks: 4,
        minLikes: 3,
        minRetweets: 1,
        minReplies: 1,
        minBookmarks: 2,
        maxLikes: 28,
        maxRetweets: 5,
        maxReplies: 19,
        maxBookmarks: 15
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
    resourcePath: './resources/'
};
