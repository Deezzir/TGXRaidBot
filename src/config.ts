import dotenv from 'dotenv';
import { Helius } from 'helius-sdk';
dotenv.config({ path: './.env' });

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
        botTutorial: `Commands to work with a raid:\n
            *Start the raid*
            /raid\n
            *Cancel all raids and actions:*
            /cancel\n`,
        targetGroupID: getEnvvar('TARGET_GROUP_ID') as unknown as number
    },
    solana: {
        helius: new Helius(getEnvvar('HELIUS_API_KEY'))
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
        }
    },
    db: {
        mongodbURI: getEnvvar('MONGODB_URI', 'mongodb://root:example@mongo:27017') as string,
        dbName: getEnvvar('DB_NAME', 'raid-bot') as string
    },
    resourcePath: './resources/'
};
