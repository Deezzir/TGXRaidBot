import mongoose, { Schema, Document } from 'mongoose';
import * as common from '../common';
import { config, Environment } from '../config';

export interface IRaid extends Document {
    targetMetrics: {
        likes: number;
        retweets: number;
        replies: number;
        bookmarks: number;
    };
    postID: string;
    postImageFileName?: string;
    startedAt: Date;
    endedAt?: Date;
}

const MessageSchema: Schema = new Schema(
    {
        targetMetrics: {
            likes: { type: Number, required: true },
            retweets: { type: Number, required: true },
            replies: { type: Number, required: true },
            bookmarks: { type: Number, required: true }
        },
        postID: { type: String, required: true },
        postImageFileName: { type: String, required: false },
        startedAt: { type: Date, required: true, default: Date.now },
        endedAt: { type: Date, required: false }
    },
    { timestamps: true }
);

const MessageModel = mongoose.model<IRaid>('Raid', MessageSchema);

class DBService {
    async getRaids(): Promise<IRaid[]> {
        try {
            const raids = await MessageModel.find().lean().exec();
            return raids as unknown as IRaid[];
        } catch (error) {
            common.logError(`DBService.getRaids: ${error}`);
            throw new Error(`DBService.getRaids failed: ${error}`);
        }
    }

    async createRaid(raidData: Partial<IRaid>): Promise<IRaid> {
        try {
            const raid = new MessageModel(raidData);
            await raid.save();
            return raid;
        } catch (error) {
            common.logError(`DBService.createRaid: ${error}`);
            throw new Error(`DBService.createRaid failed: ${error}`);
        }
    }

    async getActiveRaid(): Promise<IRaid | null> {
        try {
            const raid = await MessageModel.findOne({ endedAt: { $exists: false } })
                .lean()
                .exec();
            return raid as unknown as IRaid | null;
        } catch (error) {
            common.logError(`DBService.getActiveRaid: ${error}`);
            throw new Error(`DBService.getActiveRaid failed: ${error}`);
        }
    }
}

function getDBName() {
    return config.env === Environment.Development ? config.db.dbName + '-dev' : config.db.dbName;
}

export async function connectDB() {
    try {
        await mongoose.connect(config.db.mongodbURI, {
            dbName: getDBName(),
            autoIndex: config.env !== Environment.Production
        });

        common.logInfo(`MongoDB Connected: ${mongoose.connection.host}:${mongoose.connection.port}`);
    } catch (error) {
        common.logError(`MongoDB connection error: ${error}`);
        process.exit(1);
    }
}

export async function pingDB(): Promise<boolean> {
    try {
        if (mongoose.connection.readyState !== 1) {
            common.logError('MongoDB is not connected');
            return false;
        }
        if (!mongoose.connection.db) {
            common.logError('MongoDB database is not available');
            return false;
        }
        await mongoose.connection.db.admin().ping();
        common.logInfo('MongoDB ping successful');
        return true;
    } catch (error) {
        common.logError(`MongoDB ping failed: ${error}`);
        return false;
    }
}

export async function closeDB() {
    try {
        await mongoose.connection.close();
        common.logInfo('MongoDB connection closed');
    } catch (error) {
        common.logError(`Error closing MongoDB connection: ${error}`);
    }
}

export default new DBService();
